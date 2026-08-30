const crypto = require("crypto");

const CODE_PATTERN = /^\d{6}$/;
const STEP_SECONDS = 30;

function normalizeBase32(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/=+$/g, "")
    .replace(/[\s-]+/g, "");
}

function decodeBase32(value) {
  const input = normalizeBase32(value);
  if (!input || !/^[A-Z2-7]+$/.test(input)) return null;

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of input) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  }

  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return bytes.length ? Buffer.from(bytes) : null;
}

function hotp(secret, counter) {
  const key = decodeBase32(secret);
  if (!key) return "";

  const value = Buffer.alloc(8);
  value.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", key).update(value).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

function verifyTotp(code, secret, options = {}) {
  const candidate = String(code || "").replace(/\s+/g, "");
  if (!CODE_PATTERN.test(candidate)) return false;

  const now = Number(options.now || Date.now());
  const window = Math.max(0, Math.min(2, Number(options.window ?? 1)));
  const counter = Math.floor(now / 1000 / STEP_SECONDS);
  const received = Buffer.from(candidate, "utf8");

  for (let drift = -window; drift <= window; drift += 1) {
    const expected = hotp(secret, counter + drift);
    if (!expected) return false;
    const wanted = Buffer.from(expected, "utf8");
    if (received.length === wanted.length && crypto.timingSafeEqual(received, wanted)) {
      return true;
    }
  }
  return false;
}

module.exports = { decodeBase32, hotp, verifyTotp };
