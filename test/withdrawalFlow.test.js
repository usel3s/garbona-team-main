const assert = require("node:assert/strict");
const test = require("node:test");

const {
  validateWalletAddress,
  normalizePayoutUrl,
  buildChannelMessageHtml,
  buildAdminPayoutApprovalHtml,
  getMinWithdrawalUsd,
} = require("../src/services/withdrawalService");
const { allocatePayoutFunding } = require("../src/services/memberFinanceService");
const { adminPayoutUrl } = require("../src/utils/panelLinks");
const { payoutModerationKeyboard } = require("../src/keyboards/common");
const { payoutAlert } = require("../src/services/workerAlertsService");

test("link payout methods never require worker wallet details", () => {
  assert.equal(getMinWithdrawalUsd(), 1);
  assert.deepEqual(validateWalletAddress("xRocketr", ""), { ok: true, address: "" });
  assert.deepEqual(validateWalletAddress("cryptobot", "ignored"), { ok: true, address: "" });
  assert.equal(validateWalletAddress("usdt_trc20", "").ok, false);
});

test("payout links only accept HTTP(S) URLs", () => {
  assert.equal(normalizePayoutUrl("https://t.me/CryptoBot?start=abc"), "https://t.me/CryptoBot?start=abc");
  assert.equal(normalizePayoutUrl("javascript:alert(1)"), null);
  assert.equal(normalizePayoutUrl("not-a-url"), null);
});

test("channel card is a short panel notification without secrets", () => {
  const request = {
    _id: "64f000000000000000000001",
    telegramId: "123456789",
    username: "worker",
    amountUsd: 16.69,
    method: "cryptobot",
    walletAddress: "",
  };
  const channel = buildChannelMessageHtml(request);
  const admin = buildAdminPayoutApprovalHtml(request);
  assert.match(channel, /@worker/);
  assert.match(channel, /\$16\.69/);
  assert.match(channel, /CryptoBot/);
  assert.match(channel, /#00000001/);
  assert.match(channel, /Откройте заявку на панели/);
  assert.doesNotMatch(channel, /Комиссия/);
  assert.doesNotMatch(channel, /Реквизиты не требуются/);
  assert.doesNotMatch(channel, /123456789/);
  assert.doesNotMatch(channel, /Принять/);
  assert.doesNotMatch(channel, /Отклонить/);
  assert.match(admin, /ссылку на чек/);
});

test("admin payout URL uses the full request id", () => {
  const id = "64f000000000000000000001";
  const url = adminPayoutUrl(id);
  assert.match(url, /\/payouts\/64f000000000000000000001$/);
  assert.doesNotMatch(url, /16\.69|username|token|wallet/i);
  assert.match(adminPayoutUrl("bad"), /#payouts$/);
});

test("moderation keyboard is a single panel URL button", () => {
  const kb = payoutModerationKeyboard("64f000000000000000000001");
  const rows = kb.reply_markup.inline_keyboard;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].length, 1);
  assert.match(rows[0][0].text, /Открыть заявку/);
  assert.match(rows[0][0].url, /\/payouts\/64f000000000000000000001$/);
  assert.equal(rows[0][0].callback_data, undefined);
});

test("solana payout requires a base58 wallet", () => {
  assert.equal(validateWalletAddress("solana", "").ok, false);
  assert.equal(validateWalletAddress("solana", "TXYZ").ok, false);
  assert.deepEqual(
    validateWalletAddress("solana", "So11111111111111111111111111111111111111112"),
    { ok: true, address: "So11111111111111111111111111111111111111112" }
  );
});

test("lolz payout accepts a nick or profile URL", () => {
  assert.equal(validateWalletAddress("lolz", "").ok, false);
  assert.equal(validateWalletAddress("lolz", "ab").ok, false);
  assert.deepEqual(validateWalletAddress("lolz", "@Cool_Nick"), {
    ok: true,
    address: "Cool_Nick",
  });
  assert.deepEqual(
    validateWalletAddress("lolz", "https://lolz.live/members/Cool_Nick/"),
    { ok: true, address: "Cool_Nick" }
  );
  assert.deepEqual(
    validateWalletAddress("lolz", "https://lzt.live/users/Cool_Nick"),
    { ok: true, address: "Cool_Nick" }
  );
});

test("channel card does not leak lolz requisites", () => {
  const request = {
    _id: "64f000000000000000000003",
    telegramId: "123456789",
    username: "worker",
    amountUsd: 20,
    method: "lolz",
    walletAddress: "Cool_Nick",
  };
  const channel = buildChannelMessageHtml(request);
  const admin = buildAdminPayoutApprovalHtml(request);
  assert.match(channel, /Lolz/);
  assert.match(channel, /#00000003/);
  assert.doesNotMatch(channel, /Ник:/);
  assert.doesNotMatch(channel, /Cool_Nick/);
  assert.doesNotMatch(channel, /Реквизиты не требуются/);
  assert.doesNotMatch(channel, /Кошелёк:/);
  assert.match(admin, /Ник:/);
  assert.doesNotMatch(admin, /Кошелёк:/);
});

test("FIFO funding maps logs that built the payout amount", () => {
  const t = (n) => new Date(`2026-08-01T0${n}:00:00Z`);
  const credits = [
    { id: "a", amountUsd: 5, createdAt: t(1), sourceId: "12345", label: "выполнение лога #12345" },
    { id: "b", amountUsd: 3.5, createdAt: t(2), sourceId: "12351", label: "выполнение лога #12351" },
    { id: "c", amountUsd: 8.19, createdAt: t(3), sourceId: "12364", label: "выполнение лога #12364" },
  ];
  const trail = allocatePayoutFunding(credits, [], 16.69, t(4));
  assert.equal(trail.coveredUsd, 16.69);
  assert.equal(trail.missingUsd, 0);
  assert.deepEqual(
    trail.funding.map((row) => [row.sourceId, row.appliedUsd]),
    [
      ["12345", 5],
      ["12351", 3.5],
      ["12364", 8.19],
    ]
  );
});

test("FIFO funding consumes earlier approved withdrawals first", () => {
  const t = (n) => new Date(`2026-08-01T0${n}:00:00Z`);
  const credits = [
    { id: "a", amountUsd: 10, createdAt: t(1), sourceId: "100", label: "выполнение лога #100" },
    { id: "b", amountUsd: 8, createdAt: t(3), sourceId: "200", label: "выполнение лога #200" },
  ];
  const outs = [{ id: "w1", amountUsd: 6, createdAt: t(2) }];
  const trail = allocatePayoutFunding(credits, outs, 8, t(4));
  assert.equal(trail.coveredUsd, 8);
  assert.equal(trail.missingUsd, 0);
  assert.deepEqual(
    trail.funding.map((row) => [row.sourceId, row.appliedUsd]),
    [
      ["100", 4],
      ["200", 4],
    ]
  );
});

test("approved payout produces an actionable personal panel alert", () => {
  const alert = payoutAlert({
    _id: "64f000000000000000000002",
    amountUsd: 25,
    method: "xRocketr",
    payoutUrl: "https://t.me/xrocket?start=check",
    updatedAt: new Date("2026-08-22T19:00:00Z"),
  });
  assert.equal(alert.id, "payout:64f000000000000000000002");
  assert.equal(alert.linkType, "url");
  assert.equal(alert.linkUrl, "https://t.me/xrocket?start=check");
  assert.match(alert.message, /активировать чек/);
});
