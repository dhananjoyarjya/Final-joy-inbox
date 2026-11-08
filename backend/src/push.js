const crypto = require("crypto");
const { getDb, getFirebaseAdmin } = require("./firebase");
const { OWNER_UID } = require("./owner");

const DEVICE_COLLECTION = "fcmTokens";
const MAX_MULTICAST_SIZE = 500;

function getDeviceCollection(db, ownerUid = OWNER_UID) {
  return db
    .collection(DEVICE_COLLECTION)
    .doc(ownerUid)
    .collection("devices");
}

async function removeInvalidTokens(collection, responses) {
  const batch = collection.firestore.batch();
  let removed = 0;

  responses.forEach((response, index) => {
    const code = response.error?.code;
    if (
      code === "messaging/invalid-registration-token" ||
      code === "messaging/registration-token-not-registered"
    ) {
      batch.delete(collection.doc(response.deviceId));
      removed += 1;
    }
  });

  if (removed > 0) {
    await batch.commit();
  }
}

async function sendIncomingTextNotification(phone, senderName, text, messageId) {
  const db = getDb();
  const collection = getDeviceCollection(db);
  const snapshot = await collection.get();
  const devices = snapshot.docs
    .map((document) => ({
      deviceId: document.id,
      token: document.get("token")
    }))
    .filter((device) => typeof device.token === "string" && device.token.length > 0);

  if (devices.length === 0) return;

  const admin = getFirebaseAdmin();
  const title = String(senderName || `+${phone}`).slice(0, 100);
  const body = String(text || "New message").replace(/\s+/g, " ").trim().slice(0, 180);
  const data = {
    type: "incoming_whatsapp_text",
    title,
    body,
    chatId: phone,
    messageId
  };

  for (let offset = 0; offset < devices.length; offset += MAX_MULTICAST_SIZE) {
    const group = devices.slice(offset, offset + MAX_MULTICAST_SIZE);
    const result = await admin.messaging().sendEachForMulticast({
      tokens: group.map((device) => device.token),
      data,
      webpush: {
        headers: {
          Urgency: "high",
          TTL: "86400"
        }
      }
    });

    await removeInvalidTokens(
      collection,
      result.responses.map((response, index) => ({
        ...response,
        deviceId: group[index].deviceId
      }))
    );
  }
}

function getDeviceDocument(db, ownerUid, installationId) {
  const deviceId = crypto
    .createHash("sha256")
    .update(installationId)
    .digest("hex");
  return getDeviceCollection(db, ownerUid).doc(deviceId);
}

function isValidInstallationId(value) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isValidFcmToken(value) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 4096 &&
    !/\s/.test(value);
}

module.exports = {
  getDeviceDocument,
  isValidFcmToken,
  isValidInstallationId,
  sendIncomingTextNotification
};
