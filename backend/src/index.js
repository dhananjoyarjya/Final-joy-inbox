
const crypto = require("crypto");
const { getFirebaseAdmin, getDb } = require("./firebase");
const {
  getHeader,
  jsonResponse,
  textResponse,
  emptyResponse
} = require("./security");
const {
  verifyWebhook,
  receiveWebhook
} = require("./webhook");
const {
  normalizePhoneNumber,
  sendWhatsAppText,
  sendWhatsAppMedia,
  checkWhatsAppConnection
} = require("./whatsapp");
const {
  MAX_UPLOAD_BYTES,
  deleteMessageMedia,
  getSignedMediaUrl,
  saveMessageMedia,
  uploadWhatsAppMedia,
  validateMedia
} = require("./media");
const { OWNER_UID } = require("./owner");
const {
  getDeviceDocument,
  isValidFcmToken,
  isValidInstallationId
} = require("./push");

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
  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(idToken);
  } catch (error) {
    const authenticationError = new Error("Firebase ID token is invalid or expired.");
    authenticationError.statusCode = 401;
    throw authenticationError;
  }

  if (decoded.uid !== OWNER_UID) {
    const error = new Error("You are not authorized.");
    error.statusCode = 403;
    throw error;
  }

  return decoded;
}

async function registerFcmToken(event) {
  const owner = await authenticateOwner(event);
  let body;
  try {
    body = parseBody(event);
  } catch {
    return jsonResponse(event, 400, { error: "A valid JSON request body is required." });
  }

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    !isValidFcmToken(body.token) ||
    !isValidInstallationId(body.installationId)
  ) {
    return jsonResponse(event, 400, {
      error: "A valid FCM token and installation ID are required."
    });
  }

  const deviceRef = getDeviceDocument(getDb(), owner.uid, body.installationId);
  await deviceRef.set({
    token: body.token,
    updatedAt: new Date()
  });

  return jsonResponse(event, 200, { success: true });
}

async function removeFcmToken(event) {
  const owner = await authenticateOwner(event);
  let body;
  try {
    body = parseBody(event);
  } catch {
    return jsonResponse(event, 400, { error: "A valid JSON request body is required." });
  }

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    !isValidInstallationId(body.installationId)
  ) {
    return jsonResponse(event, 400, {
      error: "A valid installation ID is required."
    });
  }

  await getDeviceDocument(getDb(), owner.uid, body.installationId).delete();
  return jsonResponse(event, 200, { success: true });
}

async function sendMessage(event) {
  await authenticateOwner(event);

  const body = parseBody(event);

  const to = normalizePhoneNumber(body.to);
  const messageText = String(body.text || "").trim();
  const chatId = normalizePhoneNumber(body.chatId || to);

  if (!to || !messageText || !chatId || to !== chatId) {
    return jsonResponse(event, 400, {
      error: "Valid to, chatId and text are required."
    });
  }

  if (messageText.length > 4096) {
    return jsonResponse(event, 400, {
      error: "Message is too long."
    });
  }
  const db = getDb();
  const contextMessageId = body.contextMessageId;
  let contextMessageData = null;
  if (
    contextMessageId !== undefined &&
    (typeof contextMessageId !== "string" ||
      !/^[A-Za-z0-9._:-]{1,256}$/.test(contextMessageId))
  ) {
    return jsonResponse(event, 400, { error: "A valid reply message ID is required." });
  }
  if (contextMessageId) {
    const contextSnapshot = await db
      .collection("chats")
      .doc(chatId)
      .collection("messages")
      .doc(contextMessageId)
      .get();
    if (!contextSnapshot.exists) {
      return jsonResponse(event, 404, { error: "The message being replied to was not found." });
    }
    contextMessageData = contextSnapshot.data();
  }

  const result = await sendWhatsAppText(to, messageText, contextMessageId);

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
      text: messageText,
      timestamp,
      status: "sent",
      source: body.source === "quick_reply"
        ? "quick_reply"
        : "manual",
      ...(contextMessageId ? {
        replyToMessageId: contextMessageId,
        replyToMessageText: String(contextMessageData.text || ""),
        replyToMessageSender: contextMessageData.direction === "outgoing"
          ? "You"
          : String(contextMessageData.sender || chatId),
        replyToMessageType: String(contextMessageData.type || "unknown")
      } : {}),
      sender: "owner"
    });

    transaction.set(
      chatRef,
      {
        customerPhone: chatId,
        lastMessage: messageText,
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

async function updateChatState(event) {
  await authenticateOwner(event);

  const body = parseBody(event);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse(event, 400, {
      error: "A chat state object is required."
    });
  }

  const chatId = normalizePhoneNumber(body.chatId);
  const fields = ["pinned", "archived", "markRead"];

  if (
    typeof body.chatId !== "string" ||
    !/^\+?\d{6,20}$/.test(body.chatId) ||
    !chatId
  ) {
    return jsonResponse(event, 400, {
      error: "A valid chatId is required."
    });
  }

  const updates = {};

  for (const field of fields) {
    if (Object.hasOwn(body, field)) {
      if (typeof body[field] !== "boolean") {
        return jsonResponse(event, 400, {
          error: `${field} must be a boolean.`
        });
      }

      if (field === "markRead") {
        if (body.markRead) {
          updates.unreadCount = 0;
          updates.lastReadAt = new Date();
        }
      } else {
        updates[field] = body[field];
      }
    }
  }

  if (Object.keys(body).some((field) => !["chatId", ...fields].includes(field))) {
    return jsonResponse(event, 400, {
      error: "Unsupported chat state field."
    });
  }

  if (Object.keys(updates).length === 0) {
    return jsonResponse(event, 400, {
      error: "At least one chat state update is required."
    });
  }

  const chatRef = getDb().collection("chats").doc(chatId);
  const snapshot = await chatRef.get();

  if (!snapshot.exists) {
    return jsonResponse(event, 404, {
      error: "Conversation was not found."
    });
  }

  await chatRef.update({
    ...updates,
    updatedAt: new Date()
  });

  return jsonResponse(event, 200, { success: true });
}

async function updateMessageState(event) {
  await authenticateOwner(event);

  const body = parseBody(event);
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 3 ||
    typeof body.chatId !== "string" ||
    !/^\d{6,20}$/.test(body.chatId) ||
    typeof body.messageId !== "string" ||
    !/^[A-Za-z0-9._:-]{1,256}$/.test(body.messageId) ||
    typeof body.pinned !== "boolean"
  ) {
    return jsonResponse(event, 400, {
      error: "Valid chatId, messageId, and pinned fields are required."
    });
  }

  const messageRef = getDb()
    .collection("chats")
    .doc(body.chatId)
    .collection("messages")
    .doc(body.messageId);
  const snapshot = await messageRef.get();
  if (!snapshot.exists) {
    return jsonResponse(event, 404, { error: "Message was not found." });
  }

  await messageRef.update({
    pinned: body.pinned,
    pinnedAt: body.pinned ? new Date() : null,
    updatedAt: new Date()
  });
  return jsonResponse(event, 200, { success: true });
}

async function deleteMessages(event) {
  await authenticateOwner(event);

  const body = parseBody(event);
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 2 ||
    typeof body.chatId !== "string" ||
    !/^\d{6,20}$/.test(body.chatId) ||
    !Array.isArray(body.messageIds) ||
    body.messageIds.length < 1 ||
    body.messageIds.length > 50 ||
    body.messageIds.some(
      (messageId) =>
        typeof messageId !== "string" ||
        !/^[A-Za-z0-9._:-]{1,256}$/.test(messageId)
    ) ||
    new Set(body.messageIds).size !== body.messageIds.length
  ) {
    return jsonResponse(event, 400, {
      error: "Provide a valid chat ID and 1 to 50 unique message IDs."
    });
  }

  const db = getDb();
  const chatRef = db.collection("chats").doc(body.chatId);
  const messageRefs = body.messageIds.map((messageId) =>
    chatRef.collection("messages").doc(messageId)
  );
  const mediaPaths = await db.runTransaction(async (transaction) => {
    const chatSnapshot = await transaction.get(chatRef);
    if (!chatSnapshot.exists) {
      const error = new Error("Conversation was not found.");
      error.statusCode = 404;
      throw error;
    }

    const snapshots = await Promise.all(messageRefs.map((messageRef) => transaction.get(messageRef)));
    if (snapshots.some((snapshot) => !snapshot.exists)) {
      const error = new Error("One or more selected messages were not found in this conversation.");
      error.statusCode = 404;
      throw error;
    }

    const paths = [];
    snapshots.forEach((snapshot, index) => {
      const storagePath = snapshot.data().mediaStoragePath;
      if (typeof storagePath === "string") paths.push(storagePath);
      transaction.delete(messageRefs[index]);
    });
    return paths;
  });

  for (const storagePath of mediaPaths) {
    try {
      await deleteMessageMedia(storagePath);
    } catch (cleanupError) {
      console.error("Deleted message media cleanup failed:", cleanupError);
    }
  }

  return jsonResponse(event, 200, {
    success: true,
    deletedMessageIds: body.messageIds
  });
}

async function deleteChats(event) {
  await authenticateOwner(event);

  const body = parseBody(event);
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !Array.isArray(body.chatIds) ||
    body.chatIds.length < 1 ||
    body.chatIds.length > 50 ||
    body.chatIds.some((chatId) => typeof chatId !== "string" || !/^\d{6,20}$/.test(chatId)) ||
    new Set(body.chatIds).size !== body.chatIds.length
  ) {
    return jsonResponse(event, 400, {
      error: "Provide 1 to 50 unique valid chat IDs."
    });
  }

  const db = getDb();
  const deletedChatIds = [];
  const errors = [];

  for (const chatId of body.chatIds) {
    try {
      const deletionRef = db.collection("deletedChats").doc(chatId);
      await deletionRef.set({
        deletedAt: new Date(),
        deletedBy: OWNER_UID,
        deleting: true
      });

      const chatRef = db.collection("chats").doc(chatId);
      await db.recursiveDelete(chatRef.collection("messages"));
      await chatRef.delete();
      await deletionRef.set({
        deletedAt: new Date(),
        deletedBy: OWNER_UID,
        deleting: false
      });
      deletedChatIds.push(chatId);
    } catch (error) {
      console.error(`Chat deletion failed for ${chatId}:`, error);
      errors.push({ chatId, error: "Conversation could not be deleted." });
    }
  }

  return jsonResponse(event, errors.length ? 207 : 200, {
    deletedChatIds,
    errors
  });
}

async function sendMediaMessage(event) {
  await authenticateOwner(event);
  const body = parseBody(event);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse(event, 400, { error: "A media message object is required." });
  }

  const to = normalizePhoneNumber(body.to);
  const chatId = normalizePhoneNumber(body.chatId);
  if (
    typeof body.to !== "string" ||
    typeof body.chatId !== "string" ||
    !/^\+?\d{6,20}$/.test(body.to) ||
    !/^\+?\d{6,20}$/.test(body.chatId) ||
    !to ||
    to !== chatId
  ) {
    return jsonResponse(event, 400, { error: "Valid matching to and chatId values are required." });
  }

  const contextMessageId = body.contextMessageId;
  let contextMessageData = null;
  if (
    contextMessageId !== undefined &&
    (typeof contextMessageId !== "string" ||
      !/^[A-Za-z0-9._:-]{1,256}$/.test(contextMessageId))
  ) {
    return jsonResponse(event, 400, { error: "A valid reply message ID is required." });
  }
  if (contextMessageId) {
    const contextSnapshot = await getDb()
      .collection("chats")
      .doc(chatId)
      .collection("messages")
      .doc(contextMessageId)
      .get();
    if (!contextSnapshot.exists) {
      return jsonResponse(event, 404, { error: "The message being replied to was not found." });
    }
    contextMessageData = contextSnapshot.data();
  }

  const encoded = String(body.fileBase64 || "");
  const maxEncodedLength = Math.ceil(MAX_UPLOAD_BYTES / 3) * 4;
  if (
    !encoded ||
    encoded.length > maxEncodedLength ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  ) {
    return jsonResponse(event, 400, { error: "Media payload is invalid or exceeds 3 MB." });
  }

  const buffer = Buffer.from(encoded, "base64");
  if (buffer.toString("base64") !== encoded) {
    return jsonResponse(event, 400, { error: "Media payload is not valid base64." });
  }

  let mimeType;
  try {
    mimeType = validateMedia(body.mimeType, buffer.length, MAX_UPLOAD_BYTES);
  } catch (error) {
    return jsonResponse(event, 400, { error: error.message });
  }

  const type = mimeType.startsWith("image/")
    ? "image"
    : mimeType.startsWith("video/")
      ? "video"
      : mimeType.startsWith("audio/")
        ? "audio"
        : "document";
  if (body.type !== type) {
    return jsonResponse(event, 400, { error: "File type does not match the selected attachment type." });
  }

  const caption = String(body.caption || "").trim();
  const filename = String(body.filename || "attachment")
    .replace(/[\\/\r\n]/g, "_")
    .slice(0, 180);
  if (caption.length > 1024) {
    return jsonResponse(event, 400, { error: "Caption is too long (maximum 1024 characters)." });
  }
  if (type === "audio" && caption) {
    return jsonResponse(event, 400, { error: "WhatsApp audio messages do not support captions." });
  }

  const uploaded = await uploadWhatsAppMedia(buffer, mimeType, filename);
  const storageId = crypto.randomUUID();
  const stored = await saveMessageMedia(chatId, storageId, buffer, mimeType, filename);
  let result;

  try {
    result = await sendWhatsAppMedia(
      to,
      type,
      uploaded.mediaId,
      caption,
      filename,
      contextMessageId
    );
  } catch (error) {
    await deleteMessageMedia(stored.storagePath).catch((cleanupError) => {
      console.error("Failed to remove unsent media object:", cleanupError);
    });
    throw error;
  }

  const db = getDb();
  const chatRef = db.collection("chats").doc(chatId);
  const messageRef = chatRef.collection("messages").doc(result.messageId);
  const timestamp = new Date();
  const preview = caption || `${type[0].toUpperCase()}${type.slice(1)}`;

  await db.runTransaction(async (transaction) => {
    transaction.set(messageRef, {
      messageId: result.messageId,
      chatId,
      direction: "outgoing",
      type,
      text: caption,
      timestamp,
      status: "sent",
      source: body.source === "quick_reply" ? "quick_reply" : "manual",
      sender: "owner",
      ...(contextMessageId ? {
        replyToMessageId: contextMessageId,
        replyToMessageText: String(contextMessageData.text || ""),
        replyToMessageSender: contextMessageData.direction === "outgoing"
          ? "You"
          : String(contextMessageData.sender || chatId),
        replyToMessageType: String(contextMessageData.type || "unknown")
      } : {}),
      mediaId: uploaded.mediaId,
      mediaStoragePath: stored.storagePath,
      mediaMimeType: stored.mimeType,
      mediaSize: stored.size,
      mediaFilename: filename
    });
    transaction.set(
      chatRef,
      {
        customerPhone: chatId,
        lastMessage: preview,
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

async function retrieveMessageMedia(event) {
  await authenticateOwner(event);
  const params = event.queryStringParameters || {};
  const chatId = normalizePhoneNumber(params.chatId);
  const messageId = String(params.messageId || "");
  if (
    !/^\d{6,20}$/.test(chatId) ||
    !/^[a-zA-Z0-9_-]{1,180}$/.test(messageId)
  ) {
    return jsonResponse(event, 400, { error: "Valid chatId and messageId are required." });
  }

  const messageRef = getDb()
    .collection("chats")
    .doc(chatId)
    .collection("messages")
    .doc(messageId);
  const snapshot = await messageRef.get();
  if (!snapshot.exists || !snapshot.data().mediaStoragePath) {
    return jsonResponse(event, 404, { error: "Media is not available for this message." });
  }

  const media = await getSignedMediaUrl(snapshot.data().mediaStoragePath);
  if (!media) {
    return jsonResponse(event, 404, { error: "Stored media could not be found." });
  }
  return jsonResponse(event, 200, media);
}

async function getConnectionStatus(event) {
  await authenticateOwner(event);
  const whatsapp = await checkWhatsAppConnection();
  let firestore;
  try {
    await getDb().collection("chats").limit(1).get();
    firestore = { connected: true };
  } catch (error) {
    console.error("Firestore diagnostics failed:", error);
    firestore = {
      connected: false,
      error: String(error.message || "Firestore access check failed.").slice(0, 200)
    };
  }
  return jsonResponse(event, 200, {
    whatsapp,
    firestore,
    mediaStorage: {
      configured: Boolean(
        process.env.FIREBASE_STORAGE_BUCKET ||
        process.env.VITE_FIREBASE_STORAGE_BUCKET
      )
    },
    checkedAt: new Date().toISOString()
  });
}

async function getGreetingSettings(event) {
  const owner = await authenticateOwner(event);
  const snapshot = await getDb()
    .collection("users")
    .doc(owner.uid)
    .collection("settings")
    .doc("greeting")
    .get();
  const data = snapshot.exists ? snapshot.data() : {};
  return jsonResponse(event, 200, {
    enabled: Boolean(data.enabled),
    text: String(data.text || ""),
    trigger: "first_inbound"
  });
}

async function saveGreetingSettings(event) {
  const owner = await authenticateOwner(event);
  const body = parseBody(event);
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    typeof body.enabled !== "boolean" ||
    typeof body.text !== "string"
  ) {
    return jsonResponse(event, 400, {
      error: "Greeting enabled state and text are required."
    });
  }

  const text = body.text.trim();
  if (text.length > 1024 || (body.enabled && !text)) {
    return jsonResponse(event, 400, {
      error: "Enabled greetings require text of at most 1024 characters."
    });
  }

  await getDb()
    .collection("users")
    .doc(owner.uid)
    .collection("settings")
    .doc("greeting")
    .set({
      enabled: body.enabled,
      text,
      trigger: "first_inbound",
      updatedAt: new Date()
    }, { merge: true });

  return jsonResponse(event, 200, {
    success: true,
    enabled: body.enabled,
    text,
    trigger: "first_inbound"
  });
}

exports.handler = async (event) => {
  const method = getMethod(event);
  const path = getPath(event);

  if (method === "OPTIONS") {
    return emptyResponse(event, 204);
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
            : error.message || "Message could not be sent."
        }
      );
    }
  }

  if (method === "POST" && path.endsWith("/fcm-tokens/register")) {
    try {
      return await registerFcmToken(event);
    } catch (error) {
      console.error("Register FCM token error:", error);
      return jsonResponse(event, error.statusCode || 500, {
        error: error.statusCode
          ? error.message
          : "Push notification registration could not be completed."
      });
    }
  }

  if (method === "POST" && path.endsWith("/fcm-tokens/remove")) {
    try {
      return await removeFcmToken(event);
    } catch (error) {
      console.error("Remove FCM token error:", error);
      return jsonResponse(event, error.statusCode || 500, {
        error: error.statusCode
          ? error.message
          : "Push notification registration could not be removed."
      });
    }
  }

  if (method === "POST" && path.endsWith("/chat-state")) {
    try {
      return await updateChatState(event);
    } catch (error) {
      console.error("Update chat state error:", error);

      return jsonResponse(
        event,
        error.statusCode || 500,
        {
          error: error.statusCode
            ? error.message
            : "Conversation could not be updated."
        }
      );
    }
  }

  if (method === "POST" && path.endsWith("/message-state")) {
    try {
      return await updateMessageState(event);
    } catch (error) {
      console.error("Update message state error:", error);
      return jsonResponse(event, error.statusCode || 500, {
        error: error.statusCode ? error.message : "Message could not be updated."
      });
    }
  }

  if (method === "POST" && path.endsWith("/delete-messages")) {
    try {
      return await deleteMessages(event);
    } catch (error) {
      console.error("Delete messages error:", error);
      return jsonResponse(event, error.statusCode || 500, {
        error: error.statusCode ? error.message : "Messages could not be deleted."
      });
    }
  }

  if (method === "POST" && path.endsWith("/delete-chats")) {
    try {
      return await deleteChats(event);
    } catch (error) {
      console.error("Delete chats error:", error);
      return jsonResponse(event, error.statusCode || 500, {
        error: error.statusCode
          ? error.message
          : "Selected conversations could not be deleted."
      });
    }
  }

  if (method === "POST" && path.endsWith("/send-media")) {
    try {
      return await sendMediaMessage(event);
    } catch (error) {
      console.error("Send media message error:", error);
      return jsonResponse(event, error.statusCode || 500, {
        error: error.statusCode
          ? error.message
          : error.message || "Media message could not be sent."
      });
    }
  }

  if (method === "GET" && path.endsWith("/media")) {
    try {
      return await retrieveMessageMedia(event);
    } catch (error) {
      console.error("Retrieve media error:", error);
      return jsonResponse(event, error.statusCode || 500, {
        error: error.statusCode
          ? error.message
          : "Media could not be retrieved."
      });
    }
  }

  if (method === "GET" && path.endsWith("/status")) {
    try {
      return await getConnectionStatus(event);
    } catch (error) {
      console.error("Connection diagnostics failed:", error);
      return jsonResponse(event, error.statusCode || 500, {
        error: error.statusCode
          ? error.message
          : "Connection diagnostics could not be completed."
      });
    }
  }

  if (method === "GET" && path.endsWith("/greeting-settings")) {
    try {
      return await getGreetingSettings(event);
    } catch (error) {
      console.error("Load greeting settings failed:", error);
      return jsonResponse(event, error.statusCode || 500, {
        error: error.statusCode
          ? error.message
          : "Greeting settings could not be loaded."
      });
    }
  }

  if (method === "POST" && path.endsWith("/greeting-settings")) {
    try {
      return await saveGreetingSettings(event);
    } catch (error) {
      console.error("Save greeting settings failed:", error);
      return jsonResponse(event, error.statusCode || 500, {
        error: error.statusCode
          ? error.message
          : "Greeting settings could not be saved."
      });
    }
  }

  return jsonResponse(event, 404, {
    error: "Route not found."
  });
};
