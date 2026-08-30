const assert = require("node:assert/strict");
const test = require("node:test");

const {
  START_PREFIX,
  isTokenShape,
  parseTelegramStartPayload,
  buildTelegramStartUrl,
  buildPanelVerifyUrl,
  discordAvatarUrl,
  displayDiscordName,
  buildNickname,
  sessionIsOpen,
  canVerifyUser,
} = require("../src/services/discordVerifyService");

test("parses Telegram Discord start payloads", () => {
  const token = "abcdefghijklmnopqrstuv";
  assert.equal(parseTelegramStartPayload(`${START_PREFIX}${token}`), token);
  assert.equal(parseTelegramStartPayload("payout_abc"), "");
  assert.equal(parseTelegramStartPayload("dsc_???"), "");
  assert.equal(isTokenShape(token), true);
  assert.equal(isTokenShape("short"), false);
});

test("builds Telegram and panel verification URLs", () => {
  const token = "abcdefghijklmnopqrstuv";
  assert.equal(
    buildTelegramStartUrl("@Garbonabot", token),
    `https://t.me/Garbonabot?start=dsc_${token}`
  );
  assert.equal(
    buildPanelVerifyUrl("https://garbona.cc", token),
    `https://garbona.cc/app/discord?token=${token}`
  );
  assert.equal(
    buildPanelVerifyUrl("https://garbona.cc/app", token),
    `https://garbona.cc/app/discord?token=${token}`
  );
});

test("builds Discord avatar and nickname helpers", () => {
  assert.match(discordAvatarUrl("123", "abc"), /cdn\.discordapp\.com\/avatars\/123\/abc\.png/);
  assert.match(discordAvatarUrl("123", "a_abc"), /\.gif\?size=256$/);
  assert.equal(displayDiscordName({ discordGlobalName: "Ann", discordUsername: "ann" }), "Ann");
  assert.equal(buildNickname({ username: "worker", firstName: "Ivan" }), "worker");
  assert.equal(buildNickname({ firstName: "Иван" }), "Иван");
});

test("treats only open unconsumed sessions as valid", () => {
  assert.equal(sessionIsOpen(null), false);
  assert.equal(
    sessionIsOpen({ consumedAt: null, expiresAt: new Date(Date.now() + 60_000) }),
    true
  );
  assert.equal(
    sessionIsOpen({ consumedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }),
    false
  );
  assert.equal(
    sessionIsOpen({ consumedAt: null, expiresAt: new Date(Date.now() - 1000) }),
    false
  );
});

test("only team members and admins can verify", () => {
  assert.equal(canVerifyUser({ isTeamMember: true, isBanned: false, telegramId: "1" }), true);
  assert.equal(canVerifyUser({ isTeamMember: false, isBanned: false, telegramId: "1" }), false);
  assert.equal(canVerifyUser({ isTeamMember: true, isBanned: true, telegramId: "1" }), false);
});
