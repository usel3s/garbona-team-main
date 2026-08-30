const crypto = require("crypto");
const { env } = require("../config/env");

const PREFIX = "enc:v1:";

function encryptionKey() {
  const raw = String(env.panelCredentialsKey || "");
  if (raw.length < 32) {
    throw new Error("PANEL_CREDENTIALS_KEY must be at least 32 characters long");
  }
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

function encryptSecret(value) {
  const plaintext = String(value || "");
  if (!plaintext) return "";
  if (plaintext.startsWith(PREFIX)) return plaintext;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

function decryptSecret(value) {
  const raw = String(value || "");
  if (!raw || !raw.startsWith(PREFIX)) return raw; // legacy value; migrated on boot
  const parts = raw.slice(PREFIX.length).split(".");
  if (parts.length !== 3) throw new Error("Invalid encrypted secret format");
  const [iv, tag, ciphertext] = parts.map((item) => Buffer.from(item, "base64url"));
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch (_) {
    throw new Error("Unable to decrypt panel credential; check PANEL_CREDENTIALS_KEY");
  }
}

function isEncryptedSecret(value) {
  return String(value || "").startsWith(PREFIX);
}

module.exports = { encryptSecret, decryptSecret, isEncryptedSecret };
