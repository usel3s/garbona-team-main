const { env } = require("../config/env");
const {
  COOKIE_NAME: WORKER_COOKIE,
  verifySignedCookie: verifyWorkerCookie,
  canAccessWorkerPanel,
} = require("./userAuth");
const {
  COOKIE_NAME: ADMIN_COOKIE,
  verifySignedCookie: verifyAdminCookie,
} = require("./auth");
const { getUserByTelegramId } = require("../services/userService");
const { getPanelAdminUserById } = require("../services/panelAdminService");

async function requireWorkerOrAdmin(req, res, next) {
  try {
    if (env.panelAuthDisabled) return next();

    const workerPayload = verifyWorkerCookie(req.cookies?.[WORKER_COOKIE]);
    if (workerPayload?.telegramId) {
      const user = await getUserByTelegramId(workerPayload.telegramId);
      if (user && canAccessWorkerPanel(user)) {
        req.worker = user;
        req.workerTelegramId = String(workerPayload.telegramId);
        return next();
      }
    }

    const adminPayload = verifyAdminCookie(req.cookies?.[ADMIN_COOKIE]);
    if (adminPayload?.adminId) {
      const resolved = await getPanelAdminUserById(adminPayload.adminId, {
        sessionVersion: adminPayload.sessionVersion,
        passwordVersion: adminPayload.passwordVersion,
      });
      if (resolved) {
        req.admin = resolved.user;
        req.adminTelegramId = resolved.telegramId;
        req.panelAdmin = resolved.admin;
        return next();
      }
    }

    return res.status(401).json({ error: "unauthorized" });
  } catch (_) {
    return res.status(500).json({ error: "auth_error" });
  }
}

module.exports = { requireWorkerOrAdmin };
