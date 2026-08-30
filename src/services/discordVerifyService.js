const crypto = require("crypto");
const User = require("../models/User");
const DiscordVerifySession = require("../models/DiscordVerifySession");
const { env } = require("../config/env");
const { workerPanelAppUrl } = require("../utils/panelLinks");

const START_PREFIX = "dsc_";
const TOKEN_BYTES = 16;
const TOKEN_TTL_MS = 10 * 60 * 1000;

class DiscordVerifyError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "DiscordVerifyError";
    this.code = code;
    this.status = status;
  }
}

function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

function isTokenShape(token) {
  return /^[A-Za-z0-9_-]{16,64}$/.test(String(token || ""));
}

function parseTelegramStartPayload(payload) {
  const raw = String(payload || "").trim();
  if (!raw.startsWith(START_PREFIX)) return "";
  const token = raw.slice(START_PREFIX.length);
  return isTokenShape(token) ? token : "";
}

function buildTelegramStartUrl(botUsername, token) {
  const username = String(botUsername || "").replace(/^@/, "").trim();
  if (!username || !isTokenShape(token)) return "";
  return `https://t.me/${username}?start=${START_PREFIX}${token}`;
}

function buildPanelVerifyUrl(panelPublicUrl, token) {
  const base = String(panelPublicUrl || workerPanelAppUrl() || "")
    .replace(/\/$/, "");
  if (!base || !isTokenShape(token)) return "";
  const appBase = /\/app$/i.test(base) ? base : `${base}/app`;
  return `${appBase}/discord?token=${encodeURIComponent(token)}`;
}

function discordAvatarUrl(discordId, avatarHash, { size = 256 } = {}) {
  const id = String(discordId || "").trim();
  const hash = String(avatarHash || "").trim();
  if (!id) return "";
  if (hash) {
    const ext = hash.startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/avatars/${id}/${hash}.${ext}?size=${size}`;
  }
  const index = Number(BigInt(id) >> 22n) % 6;
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

function displayDiscordName(sessionOrUser) {
  return (
    String(sessionOrUser?.discordGlobalName || "").trim() ||
    String(sessionOrUser?.discordUsername || "").trim() ||
    "Discord"
  );
}

function buildNickname(user) {
  const username = String(user?.username || "").trim();
  const firstName = String(user?.firstName || "").trim();
  const customId = String(user?.customId || "").trim();
  const base = username || firstName || customId || "Garbona";
  return base.slice(0, 32);
}

function sessionIsOpen(session) {
  if (!session || session.consumedAt) return false;
  const expires = session.expiresAt ? new Date(session.expiresAt).getTime() : 0;
  return expires > Date.now();
}

function canVerifyUser(user) {
  if (!user || user.isBanned) return false;
  if (env.adminIds.includes(String(user.telegramId))) return true;
  return Boolean(user.isTeamMember);
}

function assertCanVerify(user) {
  if (!user) {
    throw new DiscordVerifyError("not_found", "Аккаунт Garbona не найден.", 404);
  }
  if (user.isBanned) {
    throw new DiscordVerifyError("banned", "Аккаунт заблокирован.", 403);
  }
  if (!canVerifyUser(user)) {
    throw new DiscordVerifyError(
      "not_team_member",
      "Верификация доступна только участникам команды.",
      403
    );
  }
}

function serializeSessionPublic(session) {
  if (!session) return null;
  return {
    token: session.token,
    status: session.consumedAt ? "consumed" : sessionIsOpen(session) ? "pending" : "expired",
    expiresAt: session.expiresAt,
    discord: {
      id: session.discordId,
      username: session.discordUsername || "",
      globalName: session.discordGlobalName || "",
      displayName: displayDiscordName(session),
      avatarUrl: session.discordAvatarUrl || "",
    },
  };
}

async function createVerifySession(input) {
  const discordId = String(input.discordId || "").trim();
  if (!/^\d{5,32}$/.test(discordId)) {
    throw new DiscordVerifyError("invalid_discord", "Некорректный Discord аккаунт.");
  }

  await DiscordVerifySession.updateMany(
    { discordId, consumedAt: null },
    { $set: { consumedAt: new Date(), method: "" } }
  );

  const token = generateToken();
  const session = await DiscordVerifySession.create({
    token,
    discordId,
    discordUsername: String(input.discordUsername || "").trim(),
    discordGlobalName: String(input.discordGlobalName || "").trim(),
    discordAvatarUrl: String(input.discordAvatarUrl || "").trim(),
    guildId: String(input.guildId || env.discordGuildId || "").trim(),
    applicationId: String(input.applicationId || "").trim(),
    interactionToken: String(input.interactionToken || "").trim(),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
  });
  return session;
}

async function getOpenSession(token) {
  if (!isTokenShape(token)) return null;
  const session = await DiscordVerifySession.findOne({ token: String(token) });
  if (!sessionIsOpen(session)) return null;
  return session;
}

async function getPublicSession(token) {
  if (!isTokenShape(token)) return null;
  const session = await DiscordVerifySession.findOne({ token: String(token) });
  if (!session) return null;
  return serializeSessionPublic(session);
}

async function findUserByDiscordId(discordId) {
  const id = String(discordId || "").trim();
  if (!id) return null;
  return User.findOne({ discordId: id });
}

async function completeVerification({ token, user, method }) {
  const session = await getOpenSession(token);
  if (!session) {
    const existing = isTokenShape(token)
      ? await DiscordVerifySession.findOne({ token: String(token) })
      : null;
    if (existing?.consumedAt) {
      throw new DiscordVerifyError("consumed", "Эта ссылка уже использована.", 409);
    }
    throw new DiscordVerifyError("expired", "Ссылка устарела. Нажми «Подтвердить» в Discord ещё раз.");
  }

  assertCanVerify(user);

  const taken = await User.findOne({
    discordId: session.discordId,
    telegramId: { $ne: String(user.telegramId) },
  });
  if (taken) {
    throw new DiscordVerifyError(
      "discord_taken",
      "Этот Discord уже привязан к другому аккаунту Garbona.",
      409
    );
  }

  const previousDiscordId = String(user.discordId || "").trim();

  user.discordId = session.discordId;
  user.discordUsername = session.discordUsername || user.discordUsername || "";
  user.discordVerifiedAt = new Date();
  try {
    await user.save();
  } catch (error) {
    if (error?.code === 11000) {
      throw new DiscordVerifyError(
        "discord_taken",
        "Этот Discord уже привязан к другому аккаунту Garbona.",
        409
      );
    }
    throw error;
  }

  session.consumedAt = new Date();
  session.consumedByTelegramId = String(user.telegramId);
  session.method = method === "panel" ? "panel" : "telegram";
  await session.save();

  return { user, session, previousDiscordId };
}

module.exports = {
  START_PREFIX,
  TOKEN_TTL_MS,
  DiscordVerifyError,
  generateToken,
  isTokenShape,
  parseTelegramStartPayload,
  buildTelegramStartUrl,
  buildPanelVerifyUrl,
  discordAvatarUrl,
  displayDiscordName,
  buildNickname,
  sessionIsOpen,
  canVerifyUser,
  assertCanVerify,
  serializeSessionPublic,
  createVerifySession,
  getOpenSession,
  getPublicSession,
  findUserByDiscordId,
  completeVerification,
};
