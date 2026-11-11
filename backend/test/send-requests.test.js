const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  claimSendRequest,
  markSendRequestFailed
} = require("../src/sendRequests");

function createDb() {
  const records = new Map();
  let transactionQueue = Promise.resolve();
  return {
    collection: (collectionName) => {
      assert.equal(collectionName, "chats");
      return {
        doc: (chatId) => ({
          collection: (subcollectionName) => {
            assert.equal(subcollectionName, "sendRequests");
            return {
              doc: (requestId) => ({
                key: `${chatId}/${requestId}`,
                set: async (data, options) => {
                  const previous = records.get(`${chatId}/${requestId}`) || {};
                  records.set(`${chatId}/${requestId}`, options?.merge
                    ? { ...previous, ...data }
                    : data);
                }
              })
            };
          }
        })
      };
    },
    runTransaction: async (callback) => {
      const transaction = transactionQueue.then(() => callback({
        get: async (ref) => {
          const data = records.get(ref.key);
          return { exists: Boolean(data), data: () => data };
        },
        create: (ref, data) => records.set(ref.key, data),
        set: (ref, data, options) => {
          const previous = records.get(ref.key) || {};
          records.set(ref.key, options?.merge ? { ...previous, ...data } : data);
        }
      }));
      transactionQueue = transaction.catch(() => {});
      return transaction;
    },
    records
  };
}

test("send request claims prevent duplicate sends and return completed receipts", async () => {
  const db = createDb();
  const first = await claimSendRequest(db, "15551230000", "request-1", "payload-hash");
  assert.equal(first.state, "claimed");

  const duplicate = await claimSendRequest(db, "15551230000", "request-1", "payload-hash");
  assert.equal(duplicate.state, "pending");

  await first.ref.set({ status: "completed", messageId: "wamid.1" }, { merge: true });
  const completed = await claimSendRequest(db, "15551230000", "request-1", "payload-hash");
  assert.equal(completed.state, "completed");
  assert.equal(completed.messageId, "wamid.1");
});

test("concurrent send requests with one client ID have only one sender", async () => {
  const db = createDb();
  const claims = await Promise.all([
    claimSendRequest(db, "15551230000", "request-1", "payload-hash"),
    claimSendRequest(db, "15551230000", "request-1", "payload-hash")
  ]);

  assert.equal(claims.filter((claim) => claim.state === "claimed").length, 1);
  assert.equal(claims.filter((claim) => claim.state === "pending").length, 1);
});

test("send request IDs cannot be reused for a different payload", async () => {
  const db = createDb();
  await claimSendRequest(db, "15551230000", "request-1", "payload-a");

  await assert.rejects(
    claimSendRequest(db, "15551230000", "request-1", "payload-b"),
    { statusCode: 409, retryable: false }
  );
});

test("uncertain sends stay claimed while definitive failures can be retried", async () => {
  const db = createDb();
  const first = await claimSendRequest(db, "15551230000", "request-1", "payload-hash");

  await markSendRequestFailed(first.ref, new Error("network timeout"));
  const uncertainRetry = await claimSendRequest(db, "15551230000", "request-1", "payload-hash");
  assert.equal(uncertainRetry.state, "pending");

  const rejected = new Error("WhatsApp rejected the request.");
  rejected.definitive = true;
  await markSendRequestFailed(first.ref, rejected);
  const safeRetry = await claimSendRequest(db, "15551230000", "request-1", "payload-hash");
  assert.equal(safeRetry.state, "claimed");
});
