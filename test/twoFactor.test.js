const test = require("node:test");
const assert = require("node:assert/strict");

const { hotp } = require("../src/panel/totp");
const {
  authenticatorSetup,
  findRecoveryCodeIndex,
  generateRecoveryCodes,
  hashRecoveryCodes,
  normalizeRecoveryCode,
  randomBase32,
  signSetupToken,
  verifySecondFactor,
  verifySetupToken,
} = require("../src/panel/twoFactor");

test("2FA setup produces an authenticator URI and local SVG QR", () => {
  const setup = authenticatorSetup("worker");
  assert.match(setup.secret, /^[A-Z2-7]{32}$/);
  assert.match(setup.uri, /^otpauth:\/\/totp\/Garbona%3Aworker\?/);
  assert.match(setup.uri, new RegExp(`secret=${setup.secret}`));
  assert.match(setup.qrSvg, /^<svg/);
  assert.doesNotMatch(setup.qrSvg, /<script/i);
});

test("signed setup token is scoped to user and expires", () => {
  const secret = randomBase32();
  const now = 1_700_000_000_000;
  const token = signSetupToken({ telegramId: "100", secret, now });
  assert.equal(verifySetupToken(token, "100", now + 1_000)?.secret, secret);
  assert.equal(verifySetupToken(token, "200", now + 1_000), null);
  assert.equal(verifySetupToken(token, "100", now + 11 * 60_000), null);
});

test("recovery codes are unique, normalized and verified only by hash", () => {
  const codes = generateRecoveryCodes();
  const hashes = hashRecoveryCodes(codes);
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  assert.ok(hashes.every((hash) => /^[0-9a-f]{64}$/.test(hash)));
  assert.equal(findRecoveryCodeIndex(codes[3].toLowerCase().replaceAll("-", " "), hashes), 3);
  assert.equal(findRecoveryCodeIndex("AAAA-BBBB-CCCC", hashes), -1);
  assert.equal(normalizeRecoveryCode(codes[0]).length, 12);
});

test("second factor accepts TOTP and recovery codes", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  const recoveryCodes = generateRecoveryCodes();
  const recoveryHashes = hashRecoveryCodes(recoveryCodes);
  const counter = Math.floor(Date.now() / 1000 / 30);
  assert.equal(verifySecondFactor(hotp(secret, counter), secret, recoveryHashes).kind, "totp");
  const recovered = verifySecondFactor(recoveryCodes[4], secret, recoveryHashes);
  assert.equal(recovered.kind, "recovery");
  assert.equal(recovered.recoveryIndex, 4);
});
