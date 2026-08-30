const assert = require("node:assert/strict");
const test = require("node:test");

const {
  normalizeMafileStatus,
  mafileStatusLabel,
  buildMafileChannelCaption,
} = require("../src/services/mafileStatusService");

test("normalizes and labels MaFile processing statuses", () => {
  assert.equal(normalizeMafileStatus("withdrawn"), "withdrawn");
  assert.equal(normalizeMafileStatus("unknown"), "pending");
  assert.equal(mafileStatusLabel("pending"), "В ожидании снятия");
  assert.equal(mafileStatusLabel("withdrawn", 241.48), "Успешно снят ($241.48)");
  assert.equal(
    mafileStatusLabel("withdrawn", 241.48, { workerShare: 193.18, workerPercent: 80 }),
    "Успешно снят ($241.48) · воркеру 80% $193.18"
  );
  assert.equal(mafileStatusLabel("invalid"), "Невалид");
});

test("skipCredit flag parses admin body values", () => {
  const { parseSkipCredit } = require("../src/services/mafileStatusService");
  assert.equal(parseSkipCredit(true), true);
  assert.equal(parseSkipCredit("1"), true);
  assert.equal(parseSkipCredit("true"), true);
  assert.equal(parseSkipCredit(false), false);
  assert.equal(parseSkipCredit(""), false);
});

test("builds clickable premium-emoji MaFile caption", () => {
  const caption = buildMafileChannelCaption({
    ownerTelegramId: "32858235",
    user: { firstName: "Иван", username: "ivan", isAnonymous: false },
    sourceId: "827348",
    total: 352.03,
    balanceUsd: 300,
    inventoryUsd: 52.03,
    status: "withdrawn",
    withdrawnAmount: 241.48,
  });
  assert.match(caption, /MaFile у ivan/);
  assert.match(caption, /\[ID: 32858235\]/);
  assert.match(caption, /Стоимость инвентаря: <b>\$52\.03<\/b>/);
  assert.match(caption, /└  Статус: <b>Успешно снят<\/b>/);
  assert.doesNotMatch(caption, /Тип:/);
  assert.doesNotMatch(caption, /tg-emoji/);
});
