const crypto = require("crypto");

const MIN_LENGTH = 8;
const MAX_LENGTH = 128;
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Fixed dummy hash so missing-user checks take similar time. */
const DUMMY_PASSWORD_HASH =
  "00000000000000000000000000000000:" +
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function hashAppPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64, SCRYPT_PARAMS).toString("hex");
  return `${salt}:${hash}`;
}

function verifyAppPassword(password, stored) {
  const raw = String(stored || "");
  const [salt, hash] = raw.split(":");
  if (!salt || !hash || !/^[0-9a-f]+$/i.test(salt) || !/^[0-9a-f]+$/i.test(hash)) {
    return false;
  }
  let derived;
  try {
    derived = crypto.scryptSync(String(password), salt, 64, SCRYPT_PARAMS).toString("hex");
  } catch (_) {
    return false;
  }
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(derived, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function verifyAppPasswordSafe(password, stored) {
  const candidate = stored && String(stored).includes(":") ? stored : DUMMY_PASSWORD_HASH;
  return verifyAppPassword(password, candidate) && Boolean(stored && String(stored).includes(":"));
}

function validateUsername(username) {
  const value = String(username || "").trim().toLowerCase();
  if (!USERNAME_RE.test(value)) {
    return { ok: false, error: "invalid_username" };
  }
  return { ok: true, username: value };
}

function validateNewPassword(password) {
  const value = String(password || "");
  if (value.length < MIN_LENGTH) {
    return { ok: false, error: `Пароль должен быть не короче ${MIN_LENGTH} символов` };
  }
  if (value.length > MAX_LENGTH) {
    return { ok: false, error: `Пароль слишком длинный` };
  }
  return { ok: true };
}

function validateLoginPassword(password) {
  const value = String(password || "");
  if (!value || value.length > MAX_LENGTH) {
    return { ok: false, error: "invalid_credentials" };
  }
  return { ok: true };
}

function appLoginOf(user) {
  return String(user?.username || user?.telegramId || "").trim();
}

function passwordVersion(stored) {
  return String(stored || "").slice(0, 24);
}

module.exports = {
  MIN_LENGTH,
  MAX_LENGTH,
  DUMMY_PASSWORD_HASH,
  hashAppPassword,
  verifyAppPassword,
  verifyAppPasswordSafe,
  validateUsername,
  validateNewPassword,
  validateLoginPassword,
  appLoginOf,
  passwordVersion,
};
