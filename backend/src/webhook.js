const { getDb } = require("./firebase");
const { verifyMetaSignature, getRawBody } = require("./security");
const { normalizePhoneNumber } = require("./whatsapp");

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
    return;
  }

  // This first version stores text messages only.
  if (message.type !== "text" || !message.text?.body) {
    return;
  }

  const text = message.text.body;
  const chatRef = db.collection("chats").doc(phone);
  const messageRef = chatRef
    .collection("messages")
    .doc(messageId);

  await db.runTransaction(async (transaction) => {
    const existingMessage = await transaction.get(messageRef);

    if (existingMessage.exists) {
      return;
    }

    const chatSnapshot = await transaction.get(chatRef);

    const previousUnread = chatSnapshot.exists
      ? Number(chatSnapshot.data().unreadCount || 0)
      : 0;

    const timestamp = message.timestamp
      ? new Date(Number(message.timestamp) * 1000)
      : new Date();

    transaction.set(
      messageRef,
      {
        messageId,
        chatId: phone,
        direction: "incoming",
        type: "text",
        text,
        timestamp,
        status: "received",
        source: "whatsapp",
        sender: phone
      }
    );

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
  const db = getDb();

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

        await saveIncomingMessage(message, contactName);
      }

      for (const status of value.statuses || []) {
        await updateMessageStatus(status);
      }
    }
  }
}

async function receiveWebhook(event) {
  if (!verifyMetaSignature(event)) {
    return {
      statusCode: 401,
      body: "Invalid webhook signature."
    };
  }

  let payload;

  try {
    payload = JSON.parse(getRawBody(event).toString("utf8"));
  } catch {
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
