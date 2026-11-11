import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeChatMessages } from "../src/services/messageReconciliation.ts";

test("reconciles an optimistic send with its Firestore message ID", () => {
  const optimistic = {
    id: "client-1",
    messageId: "wamid.1",
    clientMessageId: "client-1",
    chatId: "15551230000",
    direction: "outgoing",
    type: "text",
    text: "Hello",
    timestamp: new Date(),
    status: "sending"
  };
  const persisted = {
    id: "wamid.1",
    messageId: "wamid.1",
    chatId: "15551230000",
    direction: "outgoing",
    type: "text",
    text: "Hello",
    timestamp: new Date(),
    status: "sent"
  };

  const merged = mergeChatMessages([optimistic], [persisted]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, "sent");
  assert.equal(merged[0].clientMessageId, "client-1");
});

test("keeps distinct outgoing and incoming messages even when their text matches", () => {
  const outgoing = {
    id: "outgoing-1",
    messageId: "wamid.outgoing",
    chatId: "15551230000",
    direction: "outgoing",
    type: "text",
    text: "Hello",
    timestamp: new Date(),
    status: "sent"
  };
  const incoming = {
    id: "incoming-1",
    messageId: "wamid.incoming",
    chatId: "15551230000",
    direction: "incoming",
    type: "text",
    text: "Hello",
    timestamp: new Date(),
    status: "received"
  };

  assert.equal(mergeChatMessages([outgoing], [incoming]).length, 2);
});

test("keeps separate outgoing messages with different server IDs", () => {
  const first = {
    id: "wamid.1",
    messageId: "wamid.1",
    chatId: "15551230000",
    direction: "outgoing",
    type: "text",
    text: "Hello",
    timestamp: new Date(),
    status: "sent"
  };
  const second = { ...first, id: "wamid.2", messageId: "wamid.2" };

  assert.equal(mergeChatMessages([first, second]).length, 2);
});
