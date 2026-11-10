const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  getReplyMessageFields,
  resolveReplyContext
} = require("../src/replies");
const {
  sendWhatsAppMedia,
  sendWhatsAppText
} = require("../src/whatsapp");

function createDb(message) {
  return {
    collection: (collectionName) => {
      assert.equal(collectionName, "chats");
      return {
        doc: (chatId) => {
          assert.equal(chatId, "+15551230000");
          return {
            collection: (subcollectionName) => {
              assert.equal(subcollectionName, "messages");
              return {
                doc: (documentId) => ({
                  get: async () => ({
                    exists: documentId === "firestore-original-id",
                    id: "firestore-original-id",
                    data: () => message
                  })
                })
              };
            }
          };
        }
      };
    }
  };
}

test("reply resolution persists authoritative quote metadata and sends WhatsApp context", async (t) => {
  const originalFetch = global.fetch;
  const originalToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const originalPhoneNumberId = process.env.PHONE_NUMBER_ID;
  process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
  process.env.PHONE_NUMBER_ID = "test-phone-number";
  t.after(() => {
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.WHATSAPP_ACCESS_TOKEN;
    else process.env.WHATSAPP_ACCESS_TOKEN = originalToken;
    if (originalPhoneNumberId === undefined) delete process.env.PHONE_NUMBER_ID;
    else process.env.PHONE_NUMBER_ID = originalPhoneNumberId;
  });

  for (const direction of ["incoming", "outgoing"]) {
    const requestBody = {
      replyToMessageId: "firestore-original-id",
      contextMessageId: "firestore-original-id",
      replyToMessageText: "untrusted client text",
      replyToMessageType: "unknown",
      replyToMessageSender: "untrusted sender"
    };
    const reply = await resolveReplyContext(
      createDb({
        messageId: "wa-original-id",
        direction,
        type: "text",
        text: "original text",
        sender: "+15551230000"
      }),
      "+15551230000",
      requestBody
    );

    assert.deepEqual(getReplyMessageFields(reply), {
      replyToMessageId: "firestore-original-id",
      replyToMessageText: "original text",
      replyToMessageSender: direction === "outgoing" ? "You" : "+15551230000",
      replyToMessageType: "text"
    });

    let sentPayload;
    global.fetch = async (_url, options) => {
      sentPayload = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({ messages: [{ id: "wa-reply-id" }] })
      };
    };
    await sendWhatsAppText(
      "+15551230000",
      "reply text",
      reply.contextMessageId
    );
    assert.equal(sentPayload.context.message_id, "wa-original-id");

    await sendWhatsAppMedia(
      "+15551230000",
      "image",
      "uploaded-media-id",
      "",
      "",
      reply.contextMessageId
    );
    assert.equal(sentPayload.context.message_id, "wa-original-id");
  }
});

test("reply resolution uses the Firestore document ID when legacy records omit messageId", async () => {
  const reply = await resolveReplyContext(
    createDb({
      direction: "incoming",
      type: "image",
      text: ""
    }),
    "+15551230000",
    { replyToMessageId: "firestore-original-id" }
  );

  assert.equal(reply.messageDocumentId, "firestore-original-id");
  assert.equal(reply.contextMessageId, "firestore-original-id");
  assert.deepEqual(getReplyMessageFields(reply), {
    replyToMessageId: "firestore-original-id",
    replyToMessageText: "",
    replyToMessageSender: "+15551230000",
    replyToMessageType: "image"
  });
});

test("messages without a reply reference keep normal send behavior", async () => {
  const reply = await resolveReplyContext(createDb({}), "+15551230000", {});

  assert.equal(reply, null);
  assert.deepEqual(getReplyMessageFields(reply), {});
});
