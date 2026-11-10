function getSendRequestRef(db, chatId, clientMessageId) {
  return db
    .collection("chats")
    .doc(chatId)
    .collection("sendRequests")
    .doc(clientMessageId);
}

async function claimSendRequest(db, chatId, clientMessageId, payloadHash) {
  const ref = getSendRequestRef(db, chatId, clientMessageId);
  const result = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) {
      const request = snapshot.data();
      if (request.payloadHash !== payloadHash) {
        const error = new Error("This send ID was already used for a different message.");
        error.statusCode = 409;
        error.retryable = false;
        throw error;
      }
      if (request.status === "completed") {
        return { state: "completed", messageId: request.messageId };
      }
      if (request.status !== "failed") {
        return { state: "pending" };
      }
      transaction.set(ref, {
        status: "processing",
        attempts: Number(request.attempts || 0) + 1,
        updatedAt: new Date()
      }, { merge: true });
      return { state: "claimed" };
    }

    transaction.create(ref, {
      payloadHash,
      status: "processing",
      attempts: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    return { state: "claimed" };
  });
  return { ...result, ref };
}

async function markSendRequestFailed(ref, error) {
  if (!error?.definitive) return;
  await ref.set({
    status: "failed",
    error: String(error.message || "Message could not be sent.").slice(0, 300),
    updatedAt: new Date()
  }, { merge: true });
}

module.exports = {
  claimSendRequest,
  getSendRequestRef,
  markSendRequestFailed
};
