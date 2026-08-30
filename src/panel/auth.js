const crypto = require("crypto");
const { env } = require("../config/env");
const { getUserByTelegramId, ensureUser } = require("../services/userService");
const {
  authenticatePanelAdmin,
  getPanelAdminUserById,
  markPanelAdminLogin,
} = require("../services/panelAdminService");
const {
  inspectLoginAttempt,
  registerLoginFailure,
  registerLoginSuccess,
  sleep,
} = require("./loginGuard");
const { logger } = require("../utils/logger");

const COOKIE_NAME = "garbona_panel";
const SESSION_MS = 12 * 60 * 60 * 1000;

function cookieSecure() {
  return (
    String(env.panelPublicUrl || "").startsWith("https") ||
    String(env.adminPanelUrl || "").startsWith("https")
  );
}

function cookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: cookieSecure(),
    maxAge: maxAgeMs,
    path: "/",
  };
}

function signPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", env.panelCookieSecret)
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

function verifySignedCookie(token) {
  const raw = String(token || "");
  if (raw.length > 4096) return null;
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;
  const expected = crypto
    .createHmac("sha256", env.panelCookieSecret)
    .update(body)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload?.exp || Date.now() > Number(payload.exp)) return null;
    if (!payload.adminId) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function setSessionCookie(res, session) {
  const maxAge = SESSION_MS;
  const token = signPayload({
    adminId: String(session.adminId || ""),
    telegramId: String(session.telegramId || ""),
    username: String(session.username || ""),
    sessionVersion: Number(session.sessionVersion || 1),
    passwordVersion: String(session.passwordVersion || ""),
    sid: crypto.randomBytes(16).toString("hex"),
    exp: Date.now() + maxAge,
  });
  res.cookie(COOKIE_NAME, token, cookieOptions(maxAge));
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "strict",
    secure: cookieSecure(),
    path: "/",
  });
}

async function resolveDevAdmin() {
  const telegramId = String(env.adminIds[0] || "").trim();
  if (!telegramId) {
    throw new Error("PANEL_AUTH_DISABLED requires ADMIN_IDS");
  }
  let user = await getUserByTelegramId(telegramId);
  if (!user) {
    user = await ensureUser({
      id: telegramId,
      username: "",
      first_name: "Admin",
    });
  }
  return { user, telegramId };
}

async function loginWithPassword(username, password, meta = {}) {
  const ip = String(meta.ip || "unknown");
  const gate = inspectLoginAttempt(ip, username);
  if (!gate.ok) {
    await sleep(400 + Math.floor(Math.random() * 200));
    return {
      ok: false,
      error: gate.error,
      retryAfterSec: gate.retryAfterSec,
    };
  }

  const result = await authenticatePanelAdmin(username, password);
  if (!result.ok) {
    const fail = registerLoginFailure(ip, username);
    await sleep(fail.delayMs);
    logger.warn(`Admin login failed ip=${ip} user=${String(username || "").slice(0, 32)}`);
    return {
      ok: false,
      error: "invalid_credentials",
      retryAfterSec: fail.retryAfterSec || 0,
    };
  }

  registerLoginSuccess(ip, username);
  await markPanelAdminLogin(result.admin._id, ip);
  logger.info(`Admin login ok ip=${ip} user=${result.admin.username}`);
  return result;
}

async function requireAdmin(req, res, next) {
  try {
    if (env.panelAuthDisabled) {
      const { user, telegramId } = await resolveDevAdmin();
      req.admin = user;
      req.adminTelegramId = telegramId;
      req.panelAdmin = null;
      return next();
    }

    const payload = verifySignedCookie(req.cookies?.[COOKIE_NAME]);
    if (!payload?.adminId) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const resolved = await getPanelAdminUserById(payload.adminId, {
      sessionVersion: payload.sessionVersion,
      passwordVersion: payload.passwordVersion,
    });
    if (!resolved) {
      clearSessionCookie(res);
      return res.status(401).json({ error: "unauthorized" });
    }

    req.admin = resolved.user;
    req.adminTelegramId = resolved.telegramId;
    req.panelAdmin = resolved.admin;
    return next();
  } catch (_) {
    return res.status(500).json({ error: "auth_error" });
  }
}

module.exports = {
  COOKIE_NAME,
  setSessionCookie,
  clearSessionCookie,
  requireAdmin,
  verifySignedCookie,
  loginWithPassword,
};
