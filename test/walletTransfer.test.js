const assert = require("node:assert/strict");
const test = require("node:test");

const {
  normalizeAmountUsd,
  serializeTransferForUser,
} = require("../src/services/walletTransferService");

test("normalizeAmountUsd rounds to cents and rejects tiny values", () => {
  assert.equal(normalizeAmountUsd(1.239), 1.24);
  assert.equal(normalizeAmountUsd("10"), 10);
  assert.throws(() => normalizeAmountUsd(0), /0\.01/);
  assert.throws(() => normalizeAmountUsd(-5), /0\.01/);
  assert.throws(() => normalizeAmountUsd("abc"), /0\.01/);
});

test("serializeTransferForUser marks direction relative to viewer", () => {
  const row = {
    _id: "abc",
    createdAt: new Date("2026-08-16T12:00:00.000Z"),
    amountUsd: 12.5,
    fromTelegramId: "111",
    fromUsername: "alice",
    toTelegramId: "222",
    toUsername: "bob",
  };
  assert.deepEqual(serializeTransferForUser(row, "111"), {
    id: "abc",
    createdAt: row.createdAt,
    amountUsd: 12.5,
    direction: "out",
    peerTelegramId: "222",
    peerUsername: "bob",
    type: "transfer",
  });
  assert.equal(serializeTransferForUser(row, "222").direction, "in");
  assert.equal(serializeTransferForUser(row, "222").peerUsername, "alice");
});
