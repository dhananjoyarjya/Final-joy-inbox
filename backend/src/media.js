const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION || "v26.0";
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const MAX_INCOMING_BYTES = 16 * 1024 * 1024;

const SUPPORTED_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "video/mp4",
  "video/3gpp",
  "audio/aac",
  "audio/amr",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"
]);

function getStorageBucket() {
  const bucketName =
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.VITE_FIREBASE_STORAGE_BUCKET;

  if (!bucketName) {
    throw new Error("FIREBASE_STORAGE_BUCKET is not configured.");
  }

  return require("firebase-admin/storage")
    .getStorage()
    .bucket(bucketName);
}

function safeObjectId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 180);
}

function validateMedia(mimeType, size, maxSize = MAX_UPLOAD_BYTES) {
  const normalizedType = String(mimeType || "").split(";")[0].trim().toLowerCase();

  if (!SUPPORTED_MEDIA_TYPES.has(normalizedType)) {
    throw new Error(`Unsupported media type: ${normalizedType || "unknown"}.`);
  }

  if (!Number.isSafeInteger(size) || size <= 0 || size > maxSize) {
    throw new Error(`Media must be between 1 byte and ${Math.floor(maxSize / 1024 / 1024)} MB.`);
  }

  return normalizedType;
}

function validateMediaContent(mimeType, buffer) {
  const startsWith = (...bytes) =>
    bytes.every((byte, index) => buffer[index] === byte);
  const hasText = () => {
    try {
      return !buffer.includes(0) && new TextDecoder("utf-8", { fatal: true }).decode(buffer).length > 0;
    } catch {
      return false;
    }
  };
  const isZip = startsWith(0x50, 0x4b, 0x03, 0x04);
  const isOfficeBinary = startsWith(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
  const signatures = {
    "image/jpeg": () => startsWith(0xff, 0xd8, 0xff),
    "image/png": () => startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    "video/mp4": () => buffer.length > 12 && buffer.toString("ascii", 4, 8) === "ftyp",
    "video/3gpp": () =>
      buffer.length > 12 &&
      buffer.toString("ascii", 4, 8) === "ftyp" &&
      /^(3gp|3g2)/.test(buffer.toString("ascii", 8, 12)),
    "audio/aac": () => startsWith(0xff) && (buffer[1] & 0xf6) === 0xf0,
    "audio/amr": () => buffer.subarray(0, 6).toString("ascii") === "#!AMR\n",
    "audio/mpeg": () =>
      buffer.subarray(0, 3).toString("ascii") === "ID3" ||
      (startsWith(0xff) && (buffer[1] & 0xe0) === 0xe0),
    "audio/mp4": () => buffer.length > 12 && buffer.toString("ascii", 4, 8) === "ftyp",
    "audio/ogg": () => buffer.subarray(0, 4).toString("ascii") === "OggS",
    "application/pdf": () => buffer.subarray(0, 5).toString("ascii") === "%PDF-",
    "text/plain": hasText,
    "application/msword": () => isOfficeBinary,
    "application/vnd.ms-excel": () => isOfficeBinary,
    "application/vnd.ms-powerpoint": () => isOfficeBinary,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": () => isZip,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": () => isZip,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": () => isZip
  };

  if (!signatures[mimeType]?.()) {
    throw new Error("File content does not match its declared media type.");
  }
}

async function saveMessageMedia(chatId, messageId, buffer, mimeType, filename) {
  const safeChatId = safeObjectId(chatId);
  const safeMessageId = safeObjectId(messageId);

  if (!safeChatId || !safeMessageId) {
    throw new Error("A valid chat and message ID are required for media storage.");
  }

  const normalizedType = validateMedia(mimeType, buffer.length, MAX_INCOMING_BYTES);
  validateMediaContent(normalizedType, buffer);
  const storagePath = `messages/${safeChatId}/${safeMessageId}`;
  const file = getStorageBucket().file(storagePath);

  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType: normalizedType,
      metadata: {
        originalName: String(filename || "").slice(0, 180)
      }
    }
  });

  return { storagePath, mimeType: normalizedType, size: buffer.length };
}

async function downloadWhatsAppMedia(mediaId, chatId, messageId, filename) {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!accessToken) {
    throw new Error("WhatsApp API credentials are missing.");
  }

  const safeMediaId = safeObjectId(mediaId);
  if (!safeMediaId) throw new Error("WhatsApp media ID is invalid.");

  const metadataResponse = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${safeMediaId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const metadata = await metadataResponse.json();
  if (!metadataResponse.ok || !metadata.url) {
    throw new Error(
      metadata?.error?.message || "WhatsApp media metadata could not be retrieved."
    );
  }

  const declaredSize = Number(metadata.file_size);
  if (Number.isFinite(declaredSize) && declaredSize > MAX_INCOMING_BYTES) {
    throw new Error("Incoming media exceeds the configured 16 MB retrieval limit.");
  }

  const response = await fetch(metadata.url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) throw new Error("WhatsApp media download failed.");

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_INCOMING_BYTES) {
    throw new Error("Incoming media exceeds the configured 16 MB retrieval limit.");
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_INCOMING_BYTES) {
    throw new Error("Incoming media exceeds the configured 16 MB retrieval limit.");
  }

  const mimeType = validateMedia(
    metadata.mime_type || response.headers.get("content-type"),
    buffer.length,
    MAX_INCOMING_BYTES
  );
  validateMediaContent(mimeType, buffer);
  const stored = await saveMessageMedia(
    chatId,
    messageId,
    buffer,
    mimeType,
    filename
  );

  return {
    ...stored,
    mediaId: safeMediaId,
    sha256: String(metadata.sha256 || "").slice(0, 128)
  };
}

async function deleteMessageMedia(storagePath) {
  if (
    typeof storagePath !== "string" ||
    !/^messages\/\d{6,20}\/[a-zA-Z0-9_-]{1,180}$/.test(storagePath)
  ) {
    return;
  }
  await getStorageBucket().file(storagePath).delete({ ignoreNotFound: true });
}

async function getSignedMediaUrl(storagePath) {
  if (
    typeof storagePath !== "string" ||
    !/^messages\/\d{6,20}\/[a-zA-Z0-9_-]{1,180}$/.test(storagePath)
  ) {
    throw new Error("Media reference is invalid.");
  }
  const file = getStorageBucket().file(storagePath);
  const [exists] = await file.exists();
  if (!exists) return null;

  const expiresAt = Date.now() + 5 * 60 * 1000;
  const [url] = await file.getSignedUrl({
    action: "read",
    expires: expiresAt
  });

  return { url, expiresAt };
}

async function uploadWhatsAppMedia(buffer, mimeType, filename) {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.PHONE_NUMBER_ID;
  if (!accessToken || !phoneNumberId) {
    throw new Error("WhatsApp API credentials are missing.");
  }

  const normalizedType = validateMedia(mimeType, buffer.length);
  validateMediaContent(normalizedType, buffer);
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append(
    "file",
    new Blob([buffer], { type: normalizedType }),
    String(filename || "attachment").replace(/[\\/\r\n]/g, "_").slice(0, 180)
  );

  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/media`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form
    }
  );
  const result = await response.json();
  if (!response.ok || !result.id) {
    throw new Error(result?.error?.message || "WhatsApp media upload failed.");
  }

  return { mediaId: result.id, mimeType: normalizedType };
}

module.exports = {
  MAX_UPLOAD_BYTES,
  SUPPORTED_MEDIA_TYPES,
  downloadWhatsAppMedia,
  deleteMessageMedia,
  getSignedMediaUrl,
  saveMessageMedia,
  uploadWhatsAppMedia,
  validateMedia
};
