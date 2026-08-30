const test = require("node:test");
const assert = require("node:assert/strict");

const { hotp, verifyTotp } = require("../src/panel/totp");

test("HOTP matches the RFC 4226 test vector", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(hotp(secret, 0), "755224");
  assert.equal(hotp(secret, 1), "287082");
});

test("TOTP accepts the current step and adjacent clock drift only", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  const now = 1_700_000_000_000;
  const counter = Math.floor(now / 1000 / 30);
  assert.equal(verifyTotp(hotp(secret, counter), secret, { now }), true);
  assert.equal(verifyTotp(hotp(secret, counter - 1), secret, { now }), true);
  assert.equal(verifyTotp(hotp(secret, counter - 2), secret, { now }), false);
  assert.equal(verifyTotp("abc123", secret, { now }), false);
});
