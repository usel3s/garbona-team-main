const crypto = require("crypto");
const { renderSVG } = require("uqr");
const { env } = require("../config/env");
const { verifyTotp } = require("./totp");

const SETUP_TTL_MS = 10 * 60 * 1000;
const RECOVERY_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const RECOVERY_COUNT = 10;

function randomBase32(bytes = 20) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const buffer = crypto.randomBytes(bytes);
  let bits = "";
  for (const byte of buffer) bits += byte.toString(2).padStart(8, "0");
  let output = "";
  for (let offset = 0; offset + 5 <= bits.length; offset += 5) {
    output += alphabet[Number.parseInt(bits.slice(offset, offset + 5), 2)];
  }
  return output;
}

function normalizeRecoveryCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function generateRecoveryCodes(count = RECOVERY_COUNT) {
  return Array.from({ length: count }, () => {
    let raw = "";
    for (let index = 0; index < 12; index += 1) {
      raw += RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)];
    }
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
  });
}

function recoveryHash(code) {
  return crypto
    .createHmac("sha256", env.panelCookieSecret)
    .update(`recovery:${normalizeRecoveryCode(code)}`)
    .digest("hex");
}

function hashRecoveryCodes(codes) {
  return codes.map(recoveryHash);
}

function findRecoveryCodeIndex(code, hashes) {
  const candidate = Buffer.from(recoveryHash(code), "hex");
  let found = -1;
  (Array.isArray(hashes) ? hashes : []).forEach((hash, index) => {
    if (!/^[0-9a-f]{64}$/i.test(String(hash || ""))) return;
    const expected = Buffer.from(String(hash), "hex");
    if (candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected)) {
      found = index;
    }
  });
  return found;
}

function signSetupToken({ telegramId, secret, now = Date.now() }) {
  const body = Buffer.from(JSON.stringify({ telegramId: String(telegramId), secret, exp: now + SETUP_TTL_MS })).toString("base64url");
  const signature = crypto.createHmac("sha256", env.panelCookieSecret).update(`2fa:${body}`).digest("base64url");
  return `${body}.${signature}`;
}

function verifySetupToken(token, telegramId, now = Date.now()) {
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature) return null;
  const expected = crypto.createHmac("sha256", env.panelCookieSecret).update(`2fa:${body}`).digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (String(payload.telegramId) !== String(telegramId) || Number(payload.exp) < now) return null;
    if (!/^[A-Z2-7]{16,64}$/.test(String(payload.secret || ""))) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function authenticatorSetup(login) {
  const secret = randomBase32();
  const account = String(login || "Garbona user").replace(/^@/, "").trim() || "Garbona user";
  const label = encodeURIComponent(`Garbona:${account}`);
  const uri = `otpauth://totp/${label}?secret=${secret}&issuer=Garbona&algorithm=SHA1&digits=6&period=30`;
  const qrSvg = renderSVG(uri, { ecc: "M", border: 3, pixelSize: 6, blackColor: "#111111", whiteColor: "#ffffff" });
  return { secret, uri, qrSvg };
}

function verifySecondFactor(code, secret, recoveryHashes) {
  if (verifyTotp(code, secret)) return { ok: true, kind: "totp", recoveryIndex: -1 };
  const recoveryIndex = findRecoveryCodeIndex(code, recoveryHashes);
  return recoveryIndex >= 0
    ? { ok: true, kind: "recovery", recoveryIndex }
    : { ok: false, kind: "", recoveryIndex: -1 };
}

module.exports = {
  authenticatorSetup,
  findRecoveryCodeIndex,
  generateRecoveryCodes,
  hashRecoveryCodes,
  normalizeRecoveryCode,
  randomBase32,
  signSetupToken,
  verifySecondFactor,
  verifySetupToken,
};
