const crypto = require("crypto");
const { env } = require("../config/env");
const { isAdminTelegramId, getUserByTelegramId, ensureUser } = require("../services/userService");

const COOKIE_NAME = "garbona_app";
const MAX_AUTH_AGE_SEC = 3600;

function cookieSecure() {
  return String(env.panelPublicUrl || "").startsWith("https");
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
    .update(`app:${body}`)
    .digest("base64url");
  return `${body}.${sig}`;
}

function verifySignedCookie(token) {
  const raw = String(token || "");
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;
  const expected = crypto
    .createHmac("sha256", env.panelCookieSecret)
    .update(`app:${body}`)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload?.telegramId || !payload?.exp || Date.now() > Number(payload.exp)) {
      return null;
    }
    return payload;
  } catch (_) {
    return null;
  }
}

function safeEqualHex(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (!/^[0-9a-f]+$/i.test(left) || !/^[0-9a-f]+$/i.test(right)) return false;
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function verifyWorkerTelegramLogin(data) {
  const hash = String(data?.hash || "");
  if (!hash || !env.botToken) return { ok: false, error: "invalid_payload" };

  const fields = { ...data };
  delete fields.hash;
  const checkString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("\n");

  const secretKey = crypto.createHash("sha256").update(env.botToken).digest();
  const hmac = crypto.createHmac("sha256", secretKey).update(checkString).digest("hex");
  if (!safeEqualHex(hmac, hash)) return { ok: false, error: "bad_hash" };

  const authDate = Number(data.auth_date || 0);
  if (!authDate || Date.now() / 1000 - authDate > MAX_AUTH_AGE_SEC) {
    return { ok: false, error: "expired" };
  }

  const telegramId = String(data.id || "");
  if (!telegramId) return { ok: false, error: "missing_id" };

  return {
    ok: true,
    user: {
      telegramId,
      username: String(data.username || ""),
      firstName: String(data.first_name || ""),
      lastName: String(data.last_name || ""),
      photoUrl: String(data.photo_url || ""),
    },
  };
}

/**
 * Telegram Mini App initData verification.
 * @see https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
function verifyWorkerTelegramWebApp(initData) {
  const raw = String(initData || "").trim();
  if (!raw || !env.botToken) return { ok: false, error: "invalid_payload" };

  let params;
  try {
    params = new URLSearchParams(raw);
  } catch (_) {
    return { ok: false, error: "invalid_payload" };
  }

  const hash = String(params.get("hash") || "");
  if (!hash) return { ok: false, error: "invalid_payload" };

  const pairs = [];
  for (const [key, value] of params.entries()) {
    if (key === "hash") continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const checkString = pairs.join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(env.botToken).digest();
  const hmac = crypto.createHmac("sha256", secretKey).update(checkString).digest("hex");
  if (!safeEqualHex(hmac, hash)) return { ok: false, error: "bad_hash" };

  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Date.now() / 1000 - authDate > MAX_AUTH_AGE_SEC) {
    return { ok: false, error: "expired" };
  }

  let userPayload = null;
  try {
    userPayload = JSON.parse(String(params.get("user") || "{}"));
  } catch (_) {
    return { ok: false, error: "invalid_payload" };
  }

  const telegramId = String(userPayload?.id || "");
  if (!telegramId) return { ok: false, error: "missing_id" };

  return {
    ok: true,
    user: {
      telegramId,
      username: String(userPayload.username || ""),
      firstName: String(userPayload.first_name || ""),
      lastName: String(userPayload.last_name || ""),
      photoUrl: String(userPayload.photo_url || ""),
    },
  };
}

function setWorkerSessionCookie(res, telegramId) {
  const maxAge = 7 * 24 * 60 * 60 * 1000;
  const token = signPayload({
    telegramId: String(telegramId),
    exp: Date.now() + maxAge,
  });
  res.cookie(COOKIE_NAME, token, cookieOptions(maxAge));
}

function clearWorkerSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "strict",
    secure: cookieSecure(),
    path: "/",
  });
}

function canAccessWorkerPanel(user) {
  if (!user || user.isBanned) return false;
  if (isAdminTelegramId(user.telegramId)) return true;
  return Boolean(user.isTeamMember);
}

async function resolveDevWorker() {
  const telegramId = String(env.panelDevTelegramId || env.adminIds[0] || "").trim();
  if (!telegramId) {
    throw new Error("PANEL_AUTH_DISABLED requires PANEL_DEV_TELEGRAM_ID or ADMIN_IDS");
  }
  let user = await getUserByTelegramId(telegramId);
  if (!user) {
    user = await ensureUser({
      id: telegramId,
      username: "",
      first_name: "Worker",
    });
  }
  return { user, telegramId };
}

async function requireWorker(req, res, next) {
  try {
    if (env.panelAuthDisabled) {
      const { user, telegramId } = await resolveDevWorker();
      req.worker = user;
      req.workerTelegramId = telegramId;
      return next();
    }

    const payload = verifySignedCookie(req.cookies?.[COOKIE_NAME]);
    if (!payload) {
      return res.status(401).json({ error: "unauthorized" });
    }
    let user = await getUserByTelegramId(payload.telegramId);
    if (!user) {
      return res.status(401).json({ error: "unauthorized" });
    }
    if (!canAccessWorkerPanel(user)) {
      return res.status(403).json({ error: "not_team_member" });
    }
    req.worker = user;
    req.workerTelegramId = String(payload.telegramId);
    return next();
  } catch (error) {
    return res.status(500).json({ error: "auth_error" });
  }
}

module.exports = {
  COOKIE_NAME,
  verifyWorkerTelegramLogin,
  verifyWorkerTelegramWebApp,
  setWorkerSessionCookie,
  clearWorkerSessionCookie,
  requireWorker,
  canAccessWorkerPanel,
  verifySignedCookie,
};
