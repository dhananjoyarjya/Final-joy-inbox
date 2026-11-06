
const crypto = require("node:crypto");
const admin = require("firebase-admin");

const GRAPH_VERSION = "v26.0";

const {
  FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY,
  META_APP_SECRET,
  VERIFY_TOKEN,
  WHATSAPP_ACCESS_TOKEN,
  PHONE_NUMBER_ID,
  OWNER_UID
} = process.env;

// Firebase Admin initialization
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n")
    })
  });
}

const db = admin.firestore();

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

function response(statusCode, data) {
  return {
    statusCode,
    headers,
    body: JSON.stringify(data)
  };
}

function getRawBody(event) {
  if (!event.body) return "";

  if (event.isBase64Encoded) {
    return Buffer.from(event.body, "base64").toString("utf8");
  }

  return event.body;
}

// Verify Meta webhook signature
function verifySignature(rawBody, signature) {
  if (!META_APP_SECRET || !signature) return false;

  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", META_APP_SECRET)
      .update(rawBody)
      .digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);

  return a.length === b.length &&
    crypto.timingSafeEqual(a, b);
}

// Verify Firebase owner
async function verifyOwner(event) {
  const auth = event.headers?.authorization ||
    event.headers?.Authorization;

  if (!auth?.startsWith("Bearer ")) {
    throw new Error("Unauthorized");
  }

  const token = auth.slice(7);
  const decoded = await admin.auth().verifyIdToken(token);

  if (!OWNER_UID || decoded.uid !== OWNER_UID) {
    throw new Error("Forbidden");
  }

  return decoded;
}

// WhatsApp webhook verification
function verifyWebhook(event) {
  const params = event.queryStringParameters || {};

  if (
    params["hub.mode"] === "subscribe" &&
    params["hub.verify_token"] === VERIFY_TOKEN &&
    params["hub.challenge"]
  ) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/plain" },
      body: params["hub.challenge"]
    };
  }

  return response(403, { error: "Webhook verification failed" });
}

// Save incoming text message
async function saveIncomingMessage(message, contactName) {
  if (!message.id || !message.from) return;

  // We only save text messages, not customer media.
  if (message.type !== "text" || !message.text?.body) return;

  const chatId = message.from;
  const messageId = message.id;

  const chatRef = db.collection("chats").doc(chatId);
  const messageRef = chatRef.collection("messages").doc(messageId);

  const batch = db.batch();

  batch.set(messageRef, {
    messageId,
    chatId,
    from: chatId,
    contactName: contactName || chatId,
    direction: "incoming",
    type: "text",
    text: message.text.body,
    timestamp: admin.firestore.Timestamp.fromMillis(
      Number(message.timestamp || Math.floor(Date.now() / 1000)) * 1000
    ),
    status: "received"
  }, { merge: true });

  batch.set(chatRef, {
    contactName: contactName || chatId,
    phoneNumber: chatId,
    lastMessage: message.text.body,
    lastMessageType: "text",
    lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  await batch.commit();
}

// Update outgoing delivery status
async function updateMessageStatus(status) {
  if (!status.id || !status.recipient_id) return;

  const ref = db
    .collection("chats")
    .doc(status.recipient_id)
    .collection("messages")
    .doc(status.id);

  const doc = await ref.get();

  if (doc.exists && doc.data().direction === "outgoing") {
    await ref.update({
      status: status.status,
      statusUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
}

// Process incoming Meta webhook
async function processWebhook(payload) {
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};

      const contacts = value.contacts || [];
      const messages = value.messages || [];
      const statuses = value.statuses || [];

      for (const message of messages) {
        const contact = contacts.find(
          item => item.wa_id === message.from
        );

        const contactName = contact?.profile?.name || message.from;

        await saveIncomingMessage(message, contactName);
      }

      for (const status of statuses) {
        await updateMessageStatus(status);
      }
    }
  }
}

// Send WhatsApp text message
async function sendMessage(body) {
  const to = String(body.to || "").replace(/\D/g, "");
  const text = String(body.text || "").trim();

  if (!/^[1-9]\d{7,14}$/.test(to)) {
    throw new Error("Invalid recipient phone number");
  }

  if (!text || text.length > 4096) {
    throw new Error("Message must contain 1-4096 characters");
  }

  if (!WHATSAPP_ACCESS_TOKEN || !PHONE_NUMBER_ID) {
    throw new Error("WhatsApp configuration missing");
  }

  const url =
    `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;

  const apiResponse = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: {
        preview_url: false,
        body: text
      }
    })
  });

  const result = await apiResponse.json();

  if (!apiResponse.ok) {
    throw new Error(
      result.error?.message || "WhatsApp API request failed"
    );
  }

  const messageId = result.messages?.[0]?.id;

  if (!messageId) {
    throw new Error("WhatsApp did not return a message ID");
  }

  const chatRef = db.collection("chats").doc(to);
  const messageRef = chatRef.collection("messages").doc(messageId);

  const batch = db.batch();

  batch.set(messageRef, {
    messageId,
    chatId: to,
    from: PHONE_NUMBER_ID,
    direction: "outgoing",
    source: body.source === "quick_reply" ? "quick_reply" : "manual",
    type: "text",
    text,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    status: "sent"
  });

  batch.set(chatRef, {
    phoneNumber: to,
    lastMessage: text,
    lastMessageType: "text",
    lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  await batch.commit();

  return {
    success: true,
    messageId,
    status: "sent"
  };
}

// AWS Lambda entry point
exports.handler = async (event) => {
  const method = event.requestContext?.http?.method ||
    event.httpMethod;

  const path = event.rawPath || event.path || "/";

  if (method === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  try {
    if (method === "GET" && path.endsWith("/webhook")) {
      return verifyWebhook(event);
    }

    if (method === "POST" && path.endsWith("/webhook")) {
      const rawBody = getRawBody(event);

      const signature =
        event.headers?.["x-hub-signature-256"] ||
        event.headers?.["X-Hub-Signature-256"];

      if (!verifySignature(rawBody, signature)) {
        return response(401, { error: "Invalid webhook signature" });
      }

      const payload = JSON.parse(rawBody);
      await processWebhook(payload);

      return response(200, { success: true });
    }

    if (method === "POST" && path.endsWith("/send")) {
      await verifyOwner(event);

      const body = JSON.parse(getRawBody(event));
      const result = await sendMessage(body);

      return response(200, result);
    }

    return response(404, { error: "Route not found" });

  } catch (error) {
    console.error("Joy Inbox error:", error);

    const message = error.message || "Internal server error";

    const status = message === "Unauthorized" ? 401 :
      message === "Forbidden" ? 403 :
      message.includes("configuration missing") ? 500 : 400;

    return response(status, { error: message });
  }
};
      
