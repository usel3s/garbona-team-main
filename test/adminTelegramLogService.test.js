const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildPrivateCaption,
  buildTeamCaption,
  buildLocalTelegramImage,
  sendPhotoWithRetry,
} = require("../src/services/adminTelegramLogService");

const account = {
  id: "819957",
  username: "steam_login",
  password: "must-not-leak",
  status: "MaFile",
  statusLabel: "MaFile",
  isMaFile: true,
  steamInfo: { balanceUsd: 41.71, nickname: "Steam User" },
  inventory: { price: { tradable: 310.32 } },
};

test("private Telegram caption is personalized and contains no credentials", () => {
  const caption = buildPrivateCaption(account);
  assert.match(caption, /Найден новый MaFile/);
  assert.match(caption, /\$352\.03/);
  assert.doesNotMatch(caption, /must-not-leak/);
});

test("team Telegram caption links the worker and contains no credentials", () => {
  const caption = buildTeamCaption(account, {
    telegramId: "32858235",
    user: { firstName: "Worker", username: "worker_name" },
  });
  assert.match(caption, /tg:\/\/user\?id=32858235/);
  assert.match(caption, /Новый MaFile/);
  assert.doesNotMatch(caption, /must-not-leak/);
});

test("Telegram photo send retries temporary 502 responses", async () => {
  let calls = 0;
  const telegram = {
    async sendPhoto() {
      calls += 1;
      if (calls < 3) {
        const error = new Error("Bad Gateway");
        error.response = { error_code: 502, description: "Bad Gateway" };
        throw error;
      }
      return { message_id: 42 };
    },
  };

  const result = await sendPhotoWithRetry(
    telegram,
    {
      chatId: "-1001",
      imageBuffer: Buffer.from("png"),
      filename: "card.png",
      extra: {},
    },
    { sleep: async () => {} }
  );

  assert.equal(calls, 3);
  assert.equal(result.message_id, 42);
});

test("Telegram photo send does not retry permanent permission errors", async () => {
  let calls = 0;
  const telegram = {
    async sendPhoto() {
      calls += 1;
      const error = new Error("Forbidden");
      error.response = { error_code: 403, description: "Forbidden" };
      throw error;
    },
  };

  await assert.rejects(
    sendPhotoWithRetry(
      telegram,
      {
        chatId: "-1001",
        imageBuffer: Buffer.from("png"),
        filename: "card.png",
        extra: {},
      },
      { sleep: async () => {} }
    ),
    /Forbidden/
  );
  assert.equal(calls, 1);
});

test("local Telegram image builds MaFile card from snapshot without external APIs", async () => {
  const localLog = {
    sourceId: "825312",
    logKind: "mafile",
    balanceUsd: 12.5,
    inventoryUsd: 88.2,
    totalProfit: 100.7,
    mafileSnapshot: {
      mafileTime: "2026-08-24T01:00:00.000Z",
      games: [{ name: "Counter-Strike 2", playtime: 120 }],
      items: [
        { name: "AK-47 | Redline", price: 42.1, icon: "https://example.com/icon.png" },
      ],
    },
  };
  const account = {
    id: "825312",
    status: "MaFile",
    isMaFile: true,
    steamInfo: { balanceUsd: 12.5 },
    inventory: { price: { total: 88.2 } },
  };

  const { imageBuffer, account: cardAccount } = await buildLocalTelegramImage(account, localLog);
  assert.ok(Buffer.isBuffer(imageBuffer));
  assert.ok(imageBuffer.length > 1000);
  assert.equal(cardAccount.id, "825312");
});

test("local Telegram image builds log card from local account data", async () => {
  const localLog = {
    sourceId: "825313",
    logKind: "valid",
    accountUsername: "steam_user",
    balanceUsd: 5,
    inventoryUsd: 15,
    mafileSnapshot: {
      games: [{ name: "Dota 2", playtime: 50 }],
    },
  };
  const account = {
    id: "825313",
    status: "Ok",
    steamInfo: { nickname: "steam_user", balanceUsd: 5 },
    inventory: { price: { total: 15 } },
  };

  const { imageBuffer } = await buildLocalTelegramImage(account, localLog);
  assert.ok(Buffer.isBuffer(imageBuffer));
  assert.ok(imageBuffer.length > 1000);
});
