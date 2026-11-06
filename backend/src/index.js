const { getFirebaseAdmin, getDb } = require("./firebase");
const {
  getHeader,
  jsonResponse,
  textResponse
} = require("./security");
const {
  verifyWebhook,
  receiveWebhook
} = require("./webhook");
const {
  normalizePhoneNumber,
  sendWhatsAppText
} = require("./whatsapp");

const OWNER_UID = process.env.OWNER_UID;

function getMethod(event) {
  return (
    event.requestContext?.http?.method ||
    event.httpMethod ||
    "GET"
  ).toUpperCase();
}

function getPath(event) {
  return event.rawPath || event.path || "/";
}

function parseBody(event) {
  if (!event.body) {
    return {};
  }

  const body = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;

  return JSON.parse(body);
}

async function authenticateOwner(event) {
  if (!OWNER_UID) {
    throw new Error("OWNER_UID is not configured.");
  }

  const authorization = getHeader(event, "authorization");

  if (!authorization || !authorization.startsWith("Bearer ")) {
    const error = new Error("Authentication required.");
    error.statusCode = 401;
    throw error;
  }

  const idToken = authorization.slice(7).trim();

  if (!idToken) {
    const error = new Error("Firebase ID token is missing.");
    error.statusCode = 401;
    throw error;
  }

  const admin = getFirebaseAdmin();
  const decoded = await admin.auth().verifyIdToken(idToken);

  if (decoded.uid !== OWNER_UID) {
    const error = new Error("You are not authorized.");
    error.statusCode = 403;
    throw error;
  }

  return decoded;
}

async function sendMessage(event) {
  await authenticateOwner(event);

  const body = parseBody(event);

  const to = normalizePhoneNumber(body.to);
  const text = String(body.text || "").trim();
  const chatId = normalizePhoneNumber(body.chatId || to);

  if (!to || !text || !chatId || to !== chatId) {
    return jsonResponse(event, 400, {
      error: "Valid to, chatId and text are required."
    });
  }

  if (text.length > 4096) {
    return jsonResponse(event, 400, {
      error: "Message is too long."
    });
  }

  const result = await sendWhatsAppText(to, text);
  const db = getDb();

  const chatRef = db.collection("chats").doc(chatId);
  const messageRef = chatRef
    .collection("messages")
    .doc(result.messageId);

  const timestamp = new Date();

  await db.runTransaction(async (transaction) => {
    transaction.set(messageRef, {
      messageId: result.messageId,
      chatId,
      direction: "outgoing",
      type: "text",
      text,
      timestamp,
      status: "sent",
      source: body.source === "quick_reply"
        ? "quick_reply"
        : "manual",
      sender: "owner"
    });

    transaction.set(
      chatRef,
      {
        customerPhone: chatId,
        lastMessage: text,
        lastMessageAt: timestamp,
        lastMessageDirection: "outgoing",
        updatedAt: timestamp
      },
      { merge: true }
    );
  });

  return jsonResponse(event, 200, {
    success: true,
    messageId: result.messageId
  });
}

exports.handler = async (event) => {
  const method = getMethod(event);
  const path = getPath(event);

  if (method === "OPTIONS") {
    return jsonResponse(event, 204, {});
  }

  if (method === "GET" && path.endsWith("/webhook")) {
    const result = await verifyWebhook(event);

    return textResponse(
      event,
      result.statusCode,
      result.body
    );
  }

  if (method === "POST" && path.endsWith("/webhook")) {
    const result = await receiveWebhook(event);

    return textResponse(
      event,
      result.statusCode,
      result.body
    );
  }

  if (method === "POST" && path.endsWith("/send")) {
    try {
      return await sendMessage(event);
    } catch (error) {
      console.error("Send message error:", error);

      return jsonResponse(
        event,
        error.statusCode || 500,
        {
          error: error.statusCode
            ? error.message
            : "Message could not be sent."
        }
      );
    }
  }

  return jsonResponse(event, 404, {
    error: "Route not found."
  });
};
