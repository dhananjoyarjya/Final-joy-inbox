
const { getDb } = require("./firebase");
const { verifyMetaSignature, getRawBody } = require("./security");
const { normalizePhoneNumber, sendWhatsAppText } = require("./whatsapp");
const { downloadWhatsAppMedia } = require("./media");
const { OWNER_UID } = require("./owner");
const { sendIncomingTextNotification } = require("./push");

function getVerifyToken() {
  return (
    process.env.WHATSAPP_VERIFY_TOKEN ||
    process.env.VERIFY_TOKEN
  );
}

function getQueryParameters(event) {
  if (event.queryStringParameters) {
    return event.queryStringParameters;
  }

  const params = new URLSearchParams(
    event.rawQueryString || ""
  );

  return Object.fromEntries(params.entries());
}

function shouldSuppressInbound(deletionSnapshot, timestamp) {
  if (!deletionSnapshot.exists) return false;
  const deletion = deletionSnapshot.data() || {};
  if (deletion.deleting === true) return true;

  const deletedAtValue = deletion.deletedAt;
  if (!deletedAtValue) return false;
  const deletedAt = deletedAtValue?.toDate
    ? deletedAtValue.toDate()
    : deletedAtValue instanceof Date
      ? deletedAtValue
      : new Date(deletedAtValue);
  return !Number.isNaN(deletedAt.getTime()) && timestamp.getTime() <= deletedAt.getTime();
}

async function verifyWebhook(event) {
  const params = getQueryParameters(event);

  const mode = params["hub.mode"];
  const token = params["hub.verify_token"];
  const challenge = params["hub.challenge"];

  const verifyToken = getVerifyToken();

  if (!verifyToken) {
    return {
      statusCode: 500,
      body: "Webhook verify token is not configured."
    };
  }

  if (mode === "subscribe" && token === verifyToken) {
    return {
      statusCode: 200,
      body: challenge || ""
    };
  }

  return {
    statusCode: 403,
    body: "Webhook verification failed."
  };
}

async function saveIncomingMessage(message, contactName) {
  const db = getDb();

  const phone = normalizePhoneNumber(message.from);
  const messageId = message.id;

  if (!phone || !messageId) {
    return false;
  }

  const timestamp = message.timestamp
    ? new Date(Number(message.timestamp) * 1000)
    : new Date();
  const deletedChatRef = db.collection("deletedChats").doc(phone);
  const deletionSnapshot = await deletedChatRef.get();
  if (shouldSuppressInbound(deletionSnapshot, timestamp)) return false;

  const mediaMessage = message[message.type] || {};
  const text =
    message.type === "text"
      ? String(message.text?.body || "")
      : String(
          mediaMessage.caption ||
          mediaMessage.title ||
          (message.type === "location" && message.location
            ? `${message.location.latitude}, ${message.location.longitude}`
            : `${message.type || "Unsupported"} message`)
        );
  const mediaId = mediaMessage.id || "";
  let media = null;
  let mediaError = "";

  if (mediaId) {
    try {
      media = await downloadWhatsAppMedia(
        mediaId,
        phone,
        messageId,
        mediaMessage.filename
      );
    } catch (error) {
      mediaError =
        error instanceof Error ? error.message : "Media could not be retrieved.";
      console.error("Incoming media retrieval failed:", mediaError);
    }
  }

  const chatRef = db.collection("chats").doc(phone);

  const messageRef = chatRef
    .collection("messages")
    .doc(messageId);

  if ((await messageRef.get()).exists) {
    return false;
  }

  let created = false;
  await db.runTransaction(async (transaction) => {
    created = false;
    const existingMessage = await transaction.get(messageRef);

    if (existingMessage.exists) {
      return;
    }

    const currentDeletion = await transaction.get(deletedChatRef);
    if (shouldSuppressInbound(currentDeletion, timestamp)) return;

    created = true;

    const chatSnapshot = await transaction.get(chatRef);

    const previousUnread = chatSnapshot.exists
      ? Number(chatSnapshot.data().unreadCount || 0)
      : 0;

    transaction.set(messageRef, {
      messageId,
      chatId: phone,
      direction: "incoming",
      type: String(message.type || "unknown"),
      text,
      timestamp,
      status: "received",
      source: "whatsapp",
      sender: phone,
      mediaId: media?.mediaId || mediaId || null,
      mediaStoragePath: media?.storagePath || null,
      mediaMimeType: media?.mimeType || mediaMessage.mime_type || null,
      mediaSize: media?.size || Number(mediaMessage.file_size) || null,
      mediaFilename: String(mediaMessage.filename || "").slice(0, 180) || null,
      mediaSha256: media?.sha256 || null,
      mediaDownloadError: mediaError || null
    });

    transaction.set(
      chatRef,
      {
        customerPhone: phone,
        customerName: contactName || phone,
        lastMessage: text,
        lastMessageAt: timestamp,
        lastMessageDirection: "incoming",
        unreadCount: previousUnread + 1,
        pinned: chatSnapshot.exists
          ? Boolean(chatSnapshot.data().pinned)
          : false,
        archived: chatSnapshot.exists
          ? Boolean(chatSnapshot.data().archived)
          : false,
        updatedAt: new Date()
      },
      { merge: true }
    );
  });

  if (!created) return false;

  try {
    const contactRef = db
      .collection("users")
      .doc(OWNER_UID)
      .collection("contacts")
      .doc(phone);
    await db.runTransaction(async (transaction) => {
      const contactSnapshot = await transaction.get(contactRef);
      const contact = {
        phone: `+${phone}`,
        phoneId: phone,
        source: contactSnapshot.exists
          ? contactSnapshot.data().source || "whatsapp"
          : "whatsapp",
        lastSeenAt: new Date(),
        updatedAt: new Date()
      };
      if (!contactSnapshot.exists) {
        contact.name = contactName || `+${phone}`;
        contact.email = "";
        contact.notes = "";
        contact.createdAt = new Date();
      }
      transaction.set(contactRef, contact, { merge: true });
    });
  } catch (error) {
    console.error("WhatsApp contact sync failed:", error);
  }

  return created;
}

async function maybeSendGreeting(phone, inboundMessage) {
  const db = getDb();
  const settingsSnapshot = await db
    .collection("users")
    .doc(OWNER_UID)
    .collection("settings")
    .doc("greeting")
    .get();
  const settings = settingsSnapshot.exists ? settingsSnapshot.data() : {};
  const greetingText = String(settings.text || "").trim();
  if (!settings.enabled || !greetingText || greetingText.length > 1024) return;

  const chatRef = db.collection("chats").doc(phone);
  const inboundTime = Number(inboundMessage.timestamp)
    ? new Date(Number(inboundMessage.timestamp) * 1000)
    : new Date();
  const isWithinServiceWindow =
    inboundTime.getTime() <= Date.now() + 5 * 60 * 1000 &&
    Date.now() - inboundTime.getTime() < 24 * 60 * 60 * 1000;

  const claimed = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(chatRef);
    if (!snapshot.exists || snapshot.data().greetingAttemptedFor) return false;
    const deletionSnapshot = await transaction.get(db.collection("deletedChats").doc(phone));
    if (shouldSuppressInbound(deletionSnapshot, inboundTime)) return false;

    transaction.set(chatRef, {
      greetingAttemptedFor: inboundMessage.id,
      greetingStatus: isWithinServiceWindow ? "sending" : "outside_service_window",
      greetingAttemptedAt: new Date(),
      greetingLastError: isWithinServiceWindow
        ? null
        : "Greeting was not sent: the inbound message is outside the 24-hour service window."
    }, { merge: true });
    return true;
  });
  if (!claimed || !isWithinServiceWindow) return;

  try {
    const result = await sendWhatsAppText(phone, greetingText);
    const timestamp = new Date();
    await db.runTransaction(async (transaction) => {
      const currentChat = await transaction.get(chatRef);
      if (currentChat.data()?.greetingAttemptedFor !== inboundMessage.id) return;
      const messageRef = chatRef.collection("messages").doc(result.messageId);
      transaction.set(messageRef, {
        messageId: result.messageId,
        chatId: phone,
        direction: "outgoing",
        type: "text",
        text: greetingText,
        timestamp,
        status: "sent",
        source: "greeting",
        sender: "owner"
      });
      transaction.set(chatRef, {
        greetingStatus: "sent",
        greetingSentAt: timestamp,
        greetingLastError: null,
        lastMessage: greetingText,
        lastMessageAt: timestamp,
        lastMessageDirection: "outgoing",
        updatedAt: timestamp
      }, { merge: true });
    });
  } catch (error) {
    const message = String(error?.message || "Greeting could not be sent.").slice(0, 300);
    console.error("Greeting send failed:", message);
    await chatRef.set({
      greetingStatus: "failed",
      greetingLastError: message,
      greetingFailedAt: new Date()
    }, { merge: true });
  }
}

async function updateMessageStatus(status) {
  const db = getDb();

  const messageId = status.id;
  const recipient = normalizePhoneNumber(status.recipient_id);

  if (!messageId || !recipient) {
    return;
  }

  const messageRef = db
    .collection("chats")
    .doc(recipient)
    .collection("messages")
    .doc(messageId);

  const snapshot = await messageRef.get();

  if (!snapshot.exists) {
    return;
  }

  await messageRef.set(
    {
      status: status.status || "unknown",
      statusUpdatedAt: new Date()
    },
    { merge: true }
  );
}

async function processWebhookPayload(payload) {
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};

      const contacts = value.contacts || [];
      const messages = value.messages || [];

      for (const message of messages) {
        const contact = contacts.find(
          (item) => item.wa_id === message.from
        );

        const contactName =
          contact?.profile?.name || message.from;

        const created = await saveIncomingMessage(message, contactName);
        if (created) {
          if (message.type === "text") {
            try {
              await sendIncomingTextNotification(
                normalizePhoneNumber(message.from),
                contactName,
                message.text?.body,
                message.id
              );
            } catch (error) {
              console.error("Incoming message push notification failed:", error);
            }
          }

          await maybeSendGreeting(
            normalizePhoneNumber(message.from),
            message
          );
        }
      }

      for (const status of value.statuses || []) {
        await updateMessageStatus(status);
      }
    }
  }
}

async function receiveWebhook(event) {
  // Handle signature verification errors safely.
  try {
    if (!verifyMetaSignature(event)) {
      return {
        statusCode: 401,
        body: "Invalid webhook signature."
      };
    }
  } catch (error) {
    console.error(
      "Webhook signature verification failed:",
      error
    );

    return {
      statusCode: 500,
      body: "Webhook signature verification failed."
    };
  }

  let payload;

  try {
    const rawBody = getRawBody(event).toString("utf8");

    payload = JSON.parse(rawBody);

    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload)
    ) {
      throw new Error("Invalid webhook payload.");
    }
  } catch (error) {
    console.error("Webhook payload parsing failed:", error);

    return {
      statusCode: 400,
      body: "Invalid JSON payload."
    };
  }

  try {
    await processWebhookPayload(payload);

    return {
      statusCode: 200,
      body: "EVENT_RECEIVED"
    };
  } catch (error) {
    console.error("Webhook processing failed:", error);

    return {
      statusCode: 500,
      body: "Webhook processing failed."
    };
  }
}

module.exports = {
  verifyWebhook,
  receiveWebhook
};
