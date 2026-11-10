const MESSAGE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/;

async function resolveReplyContext(db, chatId, body) {
  const hasReplyId = body.replyToMessageId !== undefined;
  const hasLegacyContextId = body.contextMessageId !== undefined;
  if (!hasReplyId && !hasLegacyContextId) return null;

  const requestedId = hasReplyId
    ? body.replyToMessageId
    : body.contextMessageId;
  if (
    typeof requestedId !== "string" ||
    !MESSAGE_ID_PATTERN.test(requestedId) ||
    (hasReplyId &&
      hasLegacyContextId &&
      body.replyToMessageId !== body.contextMessageId)
  ) {
    const error = new Error("A valid reply message ID is required.");
    error.statusCode = 400;
    throw error;
  }

  const snapshot = await db
    .collection("chats")
    .doc(chatId)
    .collection("messages")
    .doc(requestedId)
    .get();
  if (!snapshot.exists) {
    const error = new Error("The message being replied to was not found.");
    error.statusCode = 404;
    throw error;
  }

  const message = snapshot.data();
  const whatsappMessageId = message.messageId || snapshot.id;
  if (
    typeof whatsappMessageId !== "string" ||
    !MESSAGE_ID_PATTERN.test(whatsappMessageId)
  ) {
    throw new Error("The original message has no valid WhatsApp message ID.");
  }

  return {
    messageDocumentId: snapshot.id,
    contextMessageId: whatsappMessageId,
    text: String(message.text || ""),
    sender: message.direction === "outgoing"
      ? "You"
      : String(message.sender || chatId),
    type: String(message.type || "unknown")
  };
}

function getReplyMessageFields(replyContext) {
  if (!replyContext) return {};
  return {
    replyToMessageId: replyContext.messageDocumentId,
    replyToMessageText: replyContext.text,
    replyToMessageSender: replyContext.sender,
    replyToMessageType: replyContext.type
  };
}

module.exports = {
  resolveReplyContext,
  getReplyMessageFields
};
