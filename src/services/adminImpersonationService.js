const crypto = require("crypto");
const AdminImpersonation = require("../models/AdminImpersonation");
const { getUserByTelegramId, isAdminTelegramId } = require("./userService");
const { workerPanelAppUrl } = require("../utils/panelLinks");
const { env } = require("../config/env");
const { logger } = require("../utils/logger");

const TOKEN_TTL_MS = 60 * 1000;
const TOKEN_BYTES = 24;

function canAccessWorkerPanel(user) {
  if (!user || user.isBanned) return false;
  if (isAdminTelegramId(user.telegramId)) return true;
  return Boolean(user.isTeamMember);
}

function isTokenShape(token) {
  return /^[A-Za-z0-9_-]{24,64}$/.test(String(token || ""));
}

function workerOrigin() {
  const base = String(env.panelPublicUrl || "https://garbona.cc").replace(/\/$/, "");
  return base || "https://garbona.cc";
}

function buildExchangeUrl(token) {
  return `${workerOrigin()}/api/user/auth/impersonate?token=${encodeURIComponent(token)}`;
}

async function createImpersonationSession({
  adminTelegramId,
  adminUsername = "",
  targetTelegramId,
}) {
  const targetId = String(targetTelegramId || "").trim();
  if (!/^\d+$/.test(targetId)) {
    throw Object.assign(new Error("Некорректный Telegram ID"), { status: 400 });
  }

  const target = await getUserByTelegramId(targetId);
  if (!target) {
    throw Object.assign(new Error("Участник не найден"), { status: 404 });
  }
  if (!canAccessWorkerPanel(target)) {
    throw Object.assign(
      new Error("У этого участника нет доступа к панели воркера"),
      { status: 403 }
    );
  }

  const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await AdminImpersonation.create({
    token,
    adminTelegramId: String(adminTelegramId || ""),
    adminUsername: String(adminUsername || ""),
    targetTelegramId: targetId,
    expiresAt,
  });

  logger.info(
    `Admin impersonation issued admin=${adminTelegramId} target=${targetId} ttlMs=${TOKEN_TTL_MS}`
  );

  return {
    token,
    expiresAt: expiresAt.toISOString(),
    expiresInSec: Math.floor(TOKEN_TTL_MS / 1000),
    url: buildExchangeUrl(token),
    appUrl: workerPanelAppUrl() || `${workerOrigin()}/app/`,
    target: {
      telegramId: targetId,
      username: target.username || "",
      firstName: target.firstName || "",
    },
  };
}

async function consumeImpersonationToken(token, { ip = "" } = {}) {
  const raw = String(token || "").trim();
  if (!isTokenShape(raw)) {
    return { ok: false, error: "invalid_token" };
  }

  const now = new Date();
  const session = await AdminImpersonation.findOneAndUpdate(
    {
      token: raw,
      consumedAt: null,
      expiresAt: { $gt: now },
    },
    {
      $set: {
        consumedAt: now,
        consumedIp: String(ip || "").slice(0, 64),
      },
    },
    { new: true }
  ).lean();

  if (!session) {
    return { ok: false, error: "invalid_or_expired" };
  }

  const target = await getUserByTelegramId(session.targetTelegramId);
  if (!target || !canAccessWorkerPanel(target)) {
    return { ok: false, error: "target_cannot_access_panel" };
  }

  logger.info(
    `Admin impersonation consumed admin=${session.adminTelegramId} target=${session.targetTelegramId} ip=${ip || "unknown"}`
  );

  return {
    ok: true,
    telegramId: String(session.targetTelegramId),
    adminTelegramId: String(session.adminTelegramId),
  };
}

module.exports = {
  createImpersonationSession,
  consumeImpersonationToken,
  TOKEN_TTL_MS,
};
