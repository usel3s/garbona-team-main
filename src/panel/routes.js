const express = require("express");
const ProfitTransaction = require("../models/ProfitTransaction");
const User = require("../models/User");
const WithdrawalRequest = require("../models/WithdrawalRequest");
const Application = require("../models/Application");
const SteamLog = require("../models/SteamLog");
const {
  setSessionCookie,
  clearSessionCookie,
  requireAdmin,
  loginWithPassword,
} = require("./auth");
const {
  serializeMember,
  serializeApplication,
  serializePayout,
  accountFromSteamLog,
} = require("./serializers");
const { buildWorkspaces } = require("./workspaces");
const { resolveWorkerPhotoUrl, telegramUserpicUrl } = require("../utils/profilePhoto");
const {
  getUserByTelegramId,
  searchTeamMembers,
  listTeamMembers,
  listCurators,
  listCallers,
  setTeamMember,
  setBan,
  setCurator,
  setCaller,
  setModerator,
  setProfitPercent,
  addWalletBalanceUsd,
  findUserByQuery,
} = require("../services/userService");
const {
  getGlobalWorkerPercent,
  setGlobalWorkerPercent,
  getDisplayCurrency,
  setDisplayCurrency,
  getUsdRubRate,
  setUsdRubRate,
  getWithdrawalFees,
  setWithdrawalFees,
} = require("../services/settingsService");
const { getCurrencyContext, formatDisplayAmount } = require("../services/currencyService");

function formatAutoSaleStatsDisplay(stats, currencyCtx) {
  const workerShareTotalUsd = Number(
    stats.workerShareTotalUsd ?? stats.workerShareUsd ?? 0
  );
  const workerShareOnHoldUsd = Number(stats.workerShareOnHoldUsd ?? stats.heldUsd ?? 0);
  const workerShareReleasedUsd = Number(
    stats.workerShareReleasedUsd ?? stats.releasedUsd ?? 0
  );
  const teamShareUsd = Number(stats.teamShareUsd ?? stats.teamShareReleasedUsd ?? 0);
  const teamShareGrossUsd = Number(stats.teamShareGrossUsd ?? teamShareUsd);
  const teamShareDebitedUsd = Number(stats.teamShareDebitedUsd ?? 0);
  const onSaleUsd = Number(stats.onSaleUsd ?? 0);
  const uproject = stats.uprojectFinance || null;
  const uprojectFinance = uproject
    ? {
        ...uproject,
        balanceDisplay: formatDisplayAmount(uproject.balanceUsd, currencyCtx),
        paidChargesDisplay: formatDisplayAmount(uproject.paidChargesUsd, currencyCtx),
        paidRefillsDisplay: formatDisplayAmount(uproject.paidRefillsUsd, currencyCtx),
        canceledChargesDisplay: formatDisplayAmount(uproject.canceledChargesUsd, currencyCtx),
        ledgerMismatchUsd: Number(
          (teamShareDebitedUsd - Number(uproject.paidChargesUsd || 0)).toFixed(2)
        ),
        ledgerMismatchDisplay: formatDisplayAmount(
          teamShareDebitedUsd - Number(uproject.paidChargesUsd || 0),
          currencyCtx
        ),
      }
    : null;
  return {
    ...stats,
    workerShareTotalUsd,
    workerShareOnHoldUsd,
    workerShareReleasedUsd,
    teamShareUsd,
    teamShareGrossUsd,
    teamShareDebitedUsd,
    onSaleUsd,
    uprojectFinance,
    heldDisplay: formatDisplayAmount(workerShareOnHoldUsd, currencyCtx),
    frozenBalancesDisplay: formatDisplayAmount(stats.frozenBalancesUsd, currencyCtx),
    workerShareDisplay: formatDisplayAmount(workerShareReleasedUsd, currencyCtx),
    workerShareTotalDisplay: formatDisplayAmount(workerShareTotalUsd, currencyCtx),
    workerShareOnHoldDisplay: formatDisplayAmount(workerShareOnHoldUsd, currencyCtx),
    workerShareReleasedDisplay: formatDisplayAmount(workerShareReleasedUsd, currencyCtx),
    teamShareDisplay: formatDisplayAmount(teamShareUsd, currencyCtx),
    teamShareGrossDisplay: formatDisplayAmount(teamShareGrossUsd, currencyCtx),
    teamShareDebitedDisplay: formatDisplayAmount(teamShareDebitedUsd, currencyCtx),
    teamShareOnHoldDisplay: formatDisplayAmount(stats.teamShareOnHoldUsd, currencyCtx),
    releasedDisplay: formatDisplayAmount(workerShareReleasedUsd, currencyCtx),
    grossSoldDisplay: formatDisplayAmount(stats.grossSoldUsd, currencyCtx),
    releasedGrossDisplay: formatDisplayAmount(stats.releasedGrossUsd, currencyCtx),
    heldGrossDisplay: formatDisplayAmount(stats.heldGrossUsd, currencyCtx),
    onSaleDisplay: formatDisplayAmount(onSaleUsd, currencyCtx),
    lztOnSaleDisplay: formatDisplayAmount(stats.lztOnSaleUsd, currencyCtx),
    onSaleOtherDisplay: formatDisplayAmount(stats.onSaleOtherUsd, currencyCtx),
    activeGuaranteeGrossDisplay: formatDisplayAmount(
      stats.activeGuaranteeGrossUsd,
      currencyCtx
    ),
    activeGuaranteeWorkerShareDisplay: formatDisplayAmount(
      stats.activeGuaranteeWorkerShareUsd,
      currencyCtx
    ),
    activeGuaranteeTeamShareDisplay: formatDisplayAmount(
      stats.activeGuaranteeTeamShareUsd,
      currencyCtx
    ),
    periodGrossSoldDisplay: formatDisplayAmount(stats.periodGrossSoldUsd, currencyCtx),
    periodReleasedGrossDisplay: formatDisplayAmount(stats.periodReleasedGrossUsd, currencyCtx),
    periodWorkerShareReleasedDisplay: formatDisplayAmount(
      stats.periodWorkerShareReleasedUsd,
      currencyCtx
    ),
    periodTeamShareGrossDisplay: formatDisplayAmount(stats.periodTeamShareGrossUsd, currencyCtx),
    periodTeamShareDebitedDisplay: formatDisplayAmount(stats.periodTeamShareDebitedUsd, currencyCtx),
    periodTeamShareDisplay: formatDisplayAmount(stats.periodTeamShareUsd, currencyCtx),
    activeGuarantee12hGrossDisplay: formatDisplayAmount(
      stats.activeGuarantee12hGrossUsd,
      currencyCtx
    ),
    activeGuarantee12hWorkerShareDisplay: formatDisplayAmount(
      stats.activeGuarantee12hWorkerShareUsd,
      currencyCtx
    ),
    activeGuarantee12hTeamShareDisplay: formatDisplayAmount(
      stats.activeGuarantee12hTeamShareUsd,
      currencyCtx
    ),
  };
}

const { getAdminDashboardStats } = require("../services/adminStatsService");
const {
  getAdsDashboard,
  createCampaign,
  deleteCampaign,
  setCampaignStatus,
  listCampaignCohortMembers,
  resolveCampaignLabel,
} = require("../services/adCampaignService");
const { getTopWorkers } = require("../services/topService");
const { addProfitToUserByTelegramId, profitStatsFilter } = require("../services/profitService");
const {
  listMemberFinanceHistory,
  recordApprovedWithdrawal,
  getPayoutAdminDetail,
} = require("../services/memberFinanceService");
const {
  listApplications,
  getApplicationById,
  decideApplication,
} = require("../services/applicationService");
const { getForm, addFormQuestion, removeFormQuestion } = require("../services/formService");
const {
  ensureWorkerPanelAccount,
  recreateWorkerPanelAccount,
  bindWorkerPanelAccount,
} = require("../services/panelAccountService");
const { createImpersonationSession } = require("../services/adminImpersonationService");
const {
  listDomains,
  listAdminDomains,
  listAdminSiteAnalytics,
  getDomainDetail,
  previewAddDomain,
  addDomain,
  removeDomain,
  listTemplates,
  createAdminTemplate,
  listTemplateVisibility,
  enableTemplateById,
  renameTemplateById,
  disableTemplateById,
  createLink,
  listWorkers,
  listTeamReferrals,
  updateTeamReferral,
  deleteTeamReferral,
  updateWorkerLink,
} = require("../services/adminSitesService");
const { getWorkerOverview } = require("../services/workerDashboardService");
const {
  WORKER_STEAM_SETTINGS_VERSION,
  syncWorkerSteamSettings,
  syncAllWorkerSteamSettings,
} = require("../services/workerSteamSettingsService");
const { updateCuratorSettings } = require("../services/curatorService");
const { updateCallerSettings } = require("../services/callerService");
const {
  setAwaitingPayoutLink,
  completePayoutWithLink,
  rejectPayout,
  notifyApprovedPayout,
  notifyRejectedPayout,
  addPayoutComment,
} = require("../services/withdrawalService");
const { getBroadcastRecipients, runBroadcast } = require("../services/broadcastService");
const { seedManualsThread } = require("../services/manualsThreadService");
const { publishLaunchAnnounce } = require("../services/launchAnnounceService");
const { publishChangelog } = require("../services/changelogService");
const { announceAutosaleFeature } = require("../services/autosaleAnnounceService");
const { announceDiscordServer } = require("../services/discordAnnounceService");
const { announceWorkerPercentChange } = require("../services/workerPercentAnnounceService");
const { publishOrRefreshDynamicPin } = require("../services/dynamicPinService");
const { createPanelNotification } = require("../services/panelNotificationService");
const { fetchSteamAccountById, listSteamAccountsForAdmin } = require("../services/steamLogAdminService");
const { sendFakeSteamProfit, sendFakeSteamLog, upsertSteamLogFromAccount } = require("../services/steamMonitorService");
const {
  listMafileLogs,
  listPendingMafilesForOwner,
  getMafileStatusStats,
  parseSkipCredit,
  updateMafileStatus,
} = require("../services/mafileStatusService");
const {
  listAutoSaleLogs,
  getAutoSaleStats,
  getFreshLztOnSaleStats,
  refreshActiveGuaranteeHolds,
  resolveAutoSaleStatsPeriod,
  adminAutoSaleAction,
  syncExistingAutoSalesFromUproject,
} = require("../services/autoLogSaleService");
const {
  listTeamShareOperations,
  exportAllTeamShareOperations,
  exportFlaggedTeamShareOperations,
  createTeamShareDebit,
  cancelTeamShareDebit,
  getTeamShareLastExportTime,
  markTeamShareExportSuccess,
  formatTeamShareDateTime,
} = require("../services/teamShareLedgerService");
const {
  syncUprojectTeamShareDebits,
  parseTeamShareSince,
  getUprojectFinanceSnapshot,
} = require("../services/uprojectTeamShareService");
const { grantBranchCreateAccess } = require("../services/branchService");
const {
  getAdminFinanceOverview,
  listAdminFinanceTransactions,
} = require("../services/adminFinanceService");
const {
  listControlledAccounts,
  getControlledAccount,
  getCachedControlledAccount,
  getSteamStats,
  getSteamAccountGames,
  getAccountInventory,
  getAccountEmail,
  downloadSteamAccount,
  getSteamTwoFactorCode,
  getSteamTwoFactorConfirmations,
  actOnSteamTwoFactorConfirmation,
  exportSteamAccounts,
  changeAccountStatus,
  changeAccountTags,
  runAccountTask,
  getSteamTasks,
  getSteamTask,
  cancelSteamTask,
  getSteamHandlerAccounts,
  requestSteamHandlerAccounts,
  updateSteamHandlerAccount,
} = require("../services/steamControlService");
const { resolveFakeSteamProfitInput } = require("../services/steamMarketLookup");
const { sendAccountCardToTelegram } = require("../services/adminTelegramLogService");
const { parseFakeSteamLogInput } = require("../utils/fakeSteamLogInput");
const { getRecentLogsText, logger } = require("../utils/logger");
const { env } = require("../config/env");
const { createPanelAdmin, listPanelAdmins } = require("../services/panelAdminService");

function exactUsernamePattern(value) {
  const escaped = String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return escaped ? new RegExp(`^${escaped}$`, "i") : null;
}

async function resolveAdminPhotoUrl(req) {
  const adminUser = req.admin;
  const panelUsername = String(req.panelAdmin?.username || adminUser?.username || "").trim();
  const configuredAdminIds = env.adminIds.map(String).filter((id) => /^\d+$/.test(id));
  const usernamePattern = exactUsernamePattern(panelUsername);
  let linkedUser = null;

  if (configuredAdminIds.length && usernamePattern) {
    linkedUser = await User.findOne({
      telegramId: { $in: configuredAdminIds },
      username: usernamePattern,
    }).lean();
  }

  const bootstrapUsername = String(env.panelBootstrapAdminUsername || "")
    .trim()
    .toLowerCase();
  const isBootstrapAdmin =
    Boolean(bootstrapUsername) && panelUsername.toLowerCase() === bootstrapUsername;
  if (!linkedUser && isBootstrapAdmin && configuredAdminIds[0]) {
    linkedUser = await User.findOne({ telegramId: configuredAdminIds[0] }).lean();
  }

  const subject = linkedUser || adminUser;
  const telegramId = String(subject?.telegramId || "").trim();
  if (/^\d+$/.test(telegramId)) {
    return `/assets/avatar/${telegramId}`;
  }

  const userpic = telegramUserpicUrl(panelUsername || subject?.username);
  if (userpic) return userpic;

  return resolveWorkerPhotoUrl(subject);
}

function numericTelegramId(value) {
  const id = String(value || "").trim();
  return /^\d+$/.test(id) ? id : "";
}

async function resolveAdminDmIds(req) {
  const ids = new Set();
  const sessionId = numericTelegramId(req.adminTelegramId);
  if (sessionId) ids.add(sessionId);

  const configuredAdminIds = env.adminIds.map(String).filter((id) => /^\d+$/.test(id));
  const panelUsername = String(req.panelAdmin?.username || req.admin?.username || "").trim();
  const usernamePattern = exactUsernamePattern(panelUsername);
  if (configuredAdminIds.length && usernamePattern) {
    const linked = await User.findOne({
      telegramId: { $in: configuredAdminIds },
      username: usernamePattern,
    })
      .select("telegramId")
      .lean();
    const linkedId = numericTelegramId(linked?.telegramId);
    if (linkedId) ids.add(linkedId);
  }

  if (!ids.size) {
    for (const id of configuredAdminIds) ids.add(id);
  }
  return [...ids];
}

function payoutActorFromReq(req) {
  return {
    actorTelegramId: String(req.adminTelegramId || ""),
    actorUsername: String(req.panelAdmin?.username || req.admin?.username || "").slice(0, 80),
  };
}

function createPanelRouter(bot) {
  const router = express.Router();

  router.get("/config", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      authMode: "password",
      authDisabled: Boolean(env.panelAuthDisabled),
    });
  });

  router.post("/auth/login", async (req, res) => {
    try {
      const username = String(req.body?.username || "").trim();
      const password = String(req.body?.password || "");
      const ip =
        String(req.headers["x-forwarded-for"] || "")
          .split(",")[0]
          .trim() ||
        req.ip ||
        req.socket?.remoteAddress ||
        "unknown";

      if (!username || !password) {
        return res.status(400).json({ error: "missing_credentials" });
      }
      if (password.length > 128 || username.length > 64) {
        return res.status(400).json({ error: "invalid_credentials" });
      }

      const result = await loginWithPassword(username, password, { ip });
      if (!result.ok) {
        if (result.retryAfterSec) {
          res.setHeader("Retry-After", String(result.retryAfterSec));
        }
        const status = result.error === "too_many_attempts" ? 429 : 401;
        return res.status(status).json({
          error: result.error || "invalid_credentials",
          retryAfterSec: result.retryAfterSec || 0,
        });
      }

      setSessionCookie(res, {
        adminId: result.admin._id,
        telegramId: result.telegramId,
        username: result.admin.username,
        sessionVersion: result.sessionVersion,
        passwordVersion: result.passwordVersion,
      });
      return res.json({
        ok: true,
        user: {
          username: result.admin.username,
          firstName: result.admin.displayName || result.admin.username,
          role: "Админ",
        },
      });
    } catch (_) {
      return res.status(500).json({ error: "auth_failed" });
    }
  });

  router.post("/auth/logout", (_req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  router.get("/me", requireAdmin, async (req, res) => {
    const currencyCtx = await getCurrencyContext();
    res.json({
      user: {
        ...serializeMember(req.admin, currencyCtx),
        roleLabel: "Админ",
        photoUrl: await resolveAdminPhotoUrl(req),
      },
      workspaces: buildWorkspaces({ isAdmin: true }),
    });
  });

  router.get("/admin/overview", requireAdmin, async (_req, res) => {
    try {
      const currencyCtx = await getCurrencyContext();
      const { getTeamArrivalSeries, getTeamArrivalKpi } = require("../services/adminOverviewService");
      const [stats, pendingPayouts, series, arrivals, mafiles] = await Promise.all([
        getAdminDashboardStats("all"),
        WithdrawalRequest.countDocuments({
          status: { $in: ["pending", "awaiting_payout_link"] },
        }),
        getTeamArrivalSeries(7),
        getTeamArrivalKpi(),
        getMafileStatusStats(),
      ]);

      res.json({
        currency: currencyCtx,
        kpi: {
          teamCount: stats.teamCount,
          pendingApps: stats.pendingNow,
          pendingPayouts,
          arrivals24hCount: arrivals.last24h.count,
          arrivals24hLogs: arrivals.last24h.logsCount,
          arrivals24hMafiles: arrivals.last24h.mafileCount,
          arrivals24hUsd: arrivals.last24h.totalUsd,
          arrivals24hDisplay: formatDisplayAmount(arrivals.last24h.totalUsd, currencyCtx),
          arrivals24hSummary: arrivals.last24hSummary,
          arrivalsYesterdayCount: arrivals.yesterday.count,
          arrivalsYesterdayUsd: arrivals.yesterday.totalUsd,
          arrivalsYesterdayDisplay: formatDisplayAmount(arrivals.yesterday.totalUsd, currencyCtx),
          arrivalsYesterdaySummary: arrivals.yesterdaySummary,
          arrivalsCountDeltaPct: arrivals.countDeltaPct,
          arrivalsValueDeltaPct: arrivals.valueDeltaPct,
        },
        series: series.map((row) => ({
          date: row.date,
          label: row.label,
          totalUsd: row.totalUsd,
          totalDisplay: formatDisplayAmount(row.totalUsd, currencyCtx),
          count: row.count,
          logsCount: row.logsCount,
          mafileCount: row.mafileCount,
        })),
        mafiles: {
          ...mafiles,
          inventoryDisplay: formatDisplayAmount(mafiles.inventoryUsd, currencyCtx),
          withdrawnDisplay: formatDisplayAmount(mafiles.withdrawnUsd, currencyCtx),
          soldDisplay: formatDisplayAmount(mafiles.soldUsd || 0, currencyCtx),
        },
        globalPercent: await getGlobalWorkerPercent(),
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/admin/stats", requireAdmin, async (req, res) => {
    try {
      const period = String(req.query.period || "all");
      const currencyCtx = await getCurrencyContext();
      const [stats, adsDash] = await Promise.all([
        getAdminDashboardStats(period),
        getAdsDashboard(period),
      ]);
      res.json({
        ...stats,
        profits: {
          ...stats.profits,
          totalDisplay: formatDisplayAmount(stats.profits.totalProfit, currencyCtx),
        },
        currency: currencyCtx,
        ads: {
          totals: adsDash.totals,
        },
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/admin/ads", requireAdmin, async (req, res) => {
    try {
      const period = String(req.query.period || "all");
      const campaignId = String(req.query.campaignId || "").trim();
      if (campaignId) {
        const members = await listCampaignCohortMembers(campaignId, period, 50);
        return res.json({ period, campaignId, members });
      }
      const dash = await getAdsDashboard(period);
      res.json(dash);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/admin/ads", requireAdmin, async (req, res) => {
    try {
      const campaign = await createCampaign({
        name: req.body?.name,
        slug: req.body?.slug,
        source: req.body?.source,
        createdByTelegramId: String(req.admin?.telegramId || ""),
      });
      const dash = await getAdsDashboard("all");
      const row = dash.campaigns.find((item) => item.id === String(campaign._id));
      res.json({ ok: true, campaign: row || campaign });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.patch("/admin/ads/:id", requireAdmin, async (req, res) => {
    try {
      const status = String(req.body?.status || "");
      const campaign = await setCampaignStatus(req.params.id, status);
      const dash = await getAdsDashboard("all");
      const row = dash.campaigns.find((item) => item.id === String(campaign._id));
      res.json({ ok: true, campaign: row || campaign });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.delete("/admin/ads/:id", requireAdmin, async (req, res) => {
    try {
      await deleteCampaign(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get("/admin/top", requireAdmin, async (req, res) => {
    try {
      const period = String(req.query.period || "all");
      const limit = Math.min(50, Math.max(1, Number(req.query.limit || 10)));
      const currencyCtx = await getCurrencyContext();
      const rows = await getTopWorkers(period, limit);
      res.json({
        period,
        currency: currencyCtx,
        rows: rows.map((row, i) => ({
          rank: i + 1,
          telegramId: String(row.telegramId || row.user?.telegramId || ""),
          username: row.username || row.user?.username || "",
          firstName: row.firstName || row.user?.firstName || "",
          count: Number(row.count || 0),
          totalUsd: Number(row.total || 0),
          totalDisplay: formatDisplayAmount(row.total || 0, currencyCtx),
        })),
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/admin/members", requireAdmin, async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      const currencyCtx = await getCurrencyContext();
      let users;
      if (q) users = await searchTeamMembers(q);
      else users = await listTeamMembers();
      res.json({
        members: users.map((u) => serializeMember(u, currencyCtx)),
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/admin/members/roles/curators", requireAdmin, async (_req, res) => {
    const currencyCtx = await getCurrencyContext();
    const users = await listCurators();
    res.json({ members: users.map((u) => serializeMember(u, currencyCtx)) });
  });

  router.get("/admin/members/roles/callers", requireAdmin, async (_req, res) => {
    const currencyCtx = await getCurrencyContext();
    const users = await listCallers();
    res.json({ members: users.map((u) => serializeMember(u, currencyCtx)) });
  });

  router.get("/admin/members/:telegramId", requireAdmin, async (req, res) => {
    try {
      const user = await getUserByTelegramId(req.params.telegramId);
      if (!user) return res.status(404).json({ error: "not_found" });
      const currencyCtx = await getCurrencyContext();
      res.json({ member: serializeMember(user, currencyCtx, { includePanelSecrets: true }) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/admin/members/:telegramId/detail", requireAdmin, async (req, res) => {
    try {
      const user = await getUserByTelegramId(req.params.telegramId);
      if (!user) return res.status(404).json({ error: "not_found" });
      const currencyCtx = await getCurrencyContext();
      const errors = [];
      const [overviewResult, domainsResult, templatesResult, financeResult, pendingMafiles] = await Promise.allSettled([
        getWorkerOverview(user, { days: 30 }),
        listDomains(user, { includeLinks: true }),
        listTemplates(user),
        listMemberFinanceHistory(user, 40),
        listPendingMafilesForOwner(user.telegramId, 40),
      ]);
      const overview = overviewResult.status === "fulfilled" ? overviewResult.value : null;
      const siteData = domainsResult.status === "fulfilled" ? domainsResult.value : { domains: [] };
      const templates = templatesResult.status === "fulfilled" ? templatesResult.value.templates || [] : [];
      const finance = financeResult.status === "fulfilled" ? financeResult.value || [] : [];
      if (overviewResult.status === "rejected") errors.push({ section: "overview", message: overviewResult.reason?.message || "overview_error" });
      if (domainsResult.status === "rejected") errors.push({ section: "sites", message: domainsResult.reason?.message || "sites_error" });
      if (templatesResult.status === "rejected") errors.push({ section: "templates", message: templatesResult.reason?.message || "templates_error" });
      if (financeResult.status === "rejected") errors.push({ section: "finance", message: financeResult.reason?.message || "finance_error" });

      const domains = siteData.domains || [];
      for (const domain of domains) {
        if (domain.linksError) {
          errors.push({
            section: "links",
            domainId: domain.id,
            message: domain.linksError,
          });
        }
      }
      const links = domains.flatMap((domain) =>
        (domain.links || []).map((link) => ({
          ...link,
          domainId: domain.id,
          domainName: domain.domain,
          domainPaused: Boolean(domain.isPaused),
        }))
      );
      const sum = (key) => links.reduce((total, link) => total + Number(link.stats?.[key] || 0), 0);
      res.json({
        member: serializeMember(user, currencyCtx),
        overview,
        sites: {
          domains,
          links,
          totals: {
            domains: domains.length,
            links: links.length,
            online: links.reduce((total, link) => total + Number(link.online || 0), 0),
            views: sum("views"),
            clicks: sum("clicks"),
            auths: sum("auths"),
            logs: sum("logs"),
            mafiles: sum("mafiles"),
          },
        },
        templates,
        finance: {
          items: finance,
          walletUsd: Number(user.totalProfit || 0),
          reservedUsd: Number(user.reservedWithdrawalUsd || 0),
        },
        pendingMafiles: pendingMafiles.status === "fulfilled" ? pendingMafiles.value || [] : [],
        steamSettings: {
          version: Number(user.panelSteamSettingsVersion || 0),
          targetVersion: WORKER_STEAM_SETTINGS_VERSION,
          configuredAt: user.panelSteamSettingsConfiguredAt || null,
          error: user.panelSteamSettingsError || "",
          upToDate:
            Number(user.panelSteamSettingsVersion || 0) >= WORKER_STEAM_SETTINGS_VERSION &&
            !user.panelSteamSettingsError,
        },
        errors,
      });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  });

  router.patch(
    "/admin/members/:telegramId/links/:domainId/:linkId",
    requireAdmin,
    async (req, res) => {
      try {
        const user = await getUserByTelegramId(req.params.telegramId);
        if (!user) return res.status(404).json({ error: "not_found" });
        const result = await updateWorkerLink(
          user,
          Number(req.params.domainId),
          Number(req.params.linkId),
          req.body || {}
        );
        res.json({ ok: true, ...result });
      } catch (error) {
        res.status(error.status || 400).json({ error: error.message });
      }
    }
  );

  router.post("/admin/members/:telegramId/steam-settings/sync", requireAdmin, async (req, res) => {
    try {
      const user = await getUserByTelegramId(req.params.telegramId);
      if (!user) return res.status(404).json({ error: "not_found" });
      const result = await syncWorkerSteamSettings(user, { throwOnError: true });
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post("/admin/members/steam-settings/sync-all", requireAdmin, async (_req, res) => {
    try {
      const result = await syncAllWorkerSteamSettings({ outdatedOnly: false, concurrency: 3 });
      res.json({ ok: result.failed === 0, ...result });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/admin/members/:telegramId/profit", requireAdmin, async (req, res) => {
    try {
      const amount = Number(req.body?.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: "Некорректная сумма" });
      }
      const sourceId = String(req.body?.sourceId || req.body?.mafileId || "").replace(/^#/, "").trim();
      if (sourceId) {
        const log = await SteamLog.findOne({ sourceId, logKind: "mafile" }).lean();
        if (!log) return res.status(400).json({ error: "MaFile не найден" });
        if (String(log.ownerTelegramId || "") !== String(req.params.telegramId)) {
          return res.status(400).json({ error: "Этот MaFile принадлежит другому воркеру" });
        }
      }
      const result = await addProfitToUserByTelegramId(
        req.params.telegramId,
        amount,
        req.adminTelegramId,
        sourceId ? `MaFile #${sourceId}` : ""
      );
      if (!result?.user) return res.status(404).json({ error: "not_found" });
      if (sourceId) {
        await updateMafileStatus({
          bot,
          sourceId,
          status: "withdrawn",
          amount,
          adminId: req.adminTelegramId || req.admin?._id,
          skipCredit: true,
          profitTransactionId: result.transaction?._id || "",
          workerShare: result.workerShare,
          workerPercent: result.user.profitPercent,
        });
      }
      try {
        await bot.telegram.sendMessage(
          req.params.telegramId,
          sourceId
            ? `Вам начислен профит: $${Number(amount).toFixed(2)} · MaFile #${sourceId}`
            : `Вам начислен профит: $${Number(amount).toFixed(2)}`,
          { parse_mode: "HTML" }
        );
      } catch (_) {
        /* ignore DM failures */
      }
      const currencyCtx = await getCurrencyContext();
      res.json({
        ok: true,
        member: serializeMember(result.user, currencyCtx),
        workerShare: result.workerShare,
        sourceId: sourceId || "",
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post("/admin/members/:telegramId/wallet", requireAdmin, async (req, res) => {
    try {
      const { user } = await addWalletBalanceUsd(
        req.params.telegramId,
        req.body?.amount,
        req.adminTelegramId
      );
      const currencyCtx = await getCurrencyContext();
      res.json({ ok: true, member: serializeMember(user, currencyCtx) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post("/admin/members/:telegramId/withdrawal/approve", requireAdmin, async (req, res) => {
    try {
      const amount = Number(req.body?.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: "Некорректная сумма" });
      }
      const result = await recordApprovedWithdrawal(req.params.telegramId, {
        amountUsd: amount,
        method: String(req.body?.method || "cryptobot").trim(),
        payoutUrl: String(req.body?.payoutUrl || "").trim(),
        walletAddress: String(req.body?.walletAddress || "").trim(),
        adminTelegramId: req.adminTelegramId,
        clearRemainingBalance: req.body?.clearRemainingBalance === true,
      });
      const currencyCtx = await getCurrencyContext();
      res.json({
        ok: true,
        member: serializeMember(result.user, currencyCtx),
        withdrawalId: String(result.withdrawal?._id || ""),
        deductedUsd: result.deductedUsd,
      });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.patch("/admin/members/:telegramId/percent", requireAdmin, async (req, res) => {
    try {
      const percent = Math.max(1, Math.min(100, Number(req.body?.percent)));
      const user = await setProfitPercent(req.params.telegramId, percent);
      if (!user) return res.status(404).json({ error: "not_found" });
      const currencyCtx = await getCurrencyContext();
      res.json({ ok: true, member: serializeMember(user, currencyCtx) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post("/admin/members/:telegramId/message", requireAdmin, async (req, res) => {
    try {
      const text = String(req.body?.text || "").trim();
      if (!text) return res.status(400).json({ error: "empty_text" });
      await bot.telegram.sendMessage(req.params.telegramId, text, { parse_mode: "HTML" });
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post("/admin/members/:telegramId/role", requireAdmin, async (req, res) => {
    try {
      const { role, value } = req.body || {};
      const id = req.params.telegramId;
      let user;
      if (role === "curator") user = await setCurator(id, Boolean(value));
      else if (role === "caller") user = await setCaller(id, Boolean(value));
      else if (role === "moderator") user = await setModerator(id, Boolean(value));
      else if (role === "team") user = await setTeamMember(id, Boolean(value));
      else if (role === "branch_create") user = await grantBranchCreateAccess(id, Boolean(value));
      else return res.status(400).json({ error: "unknown_role" });
      if (!user) return res.status(404).json({ error: "not_found" });
      const currencyCtx = await getCurrencyContext();
      res.json({ ok: true, member: serializeMember(user, currencyCtx) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post("/admin/members/:telegramId/ban", requireAdmin, async (req, res) => {
    try {
      const value = Boolean(req.body?.banned);
      const user = await setBan(req.params.telegramId, value);
      if (!user) return res.status(404).json({ error: "not_found" });
      const currencyCtx = await getCurrencyContext();
      res.json({ ok: true, member: serializeMember(user, currencyCtx) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post("/admin/members/:telegramId/kick", requireAdmin, async (req, res) => {
    try {
      const user = await setTeamMember(req.params.telegramId, false);
      if (!user) return res.status(404).json({ error: "not_found" });
      const currencyCtx = await getCurrencyContext();
      res.json({ ok: true, member: serializeMember(user, currencyCtx) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.patch("/admin/members/:telegramId/curator-settings", requireAdmin, async (req, res) => {
    try {
      const user = await updateCuratorSettings(req.params.telegramId, {
        description: req.body?.description,
        percent: req.body?.percent,
        minProfits: req.body?.minProfits,
      });
      const currencyCtx = await getCurrencyContext();
      res.json({ ok: true, member: serializeMember(user, currencyCtx) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.patch("/admin/members/:telegramId/caller-settings", requireAdmin, async (req, res) => {
    try {
      const user = await updateCallerSettings(req.params.telegramId, {
        description: req.body?.description,
        percent: req.body?.percent,
        minProfits: req.body?.minProfits,
      });
      const currencyCtx = await getCurrencyContext();
      res.json({ ok: true, member: serializeMember(user, currencyCtx) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post("/admin/members/:telegramId/panel/create", requireAdmin, async (req, res) => {
    try {
      let user = await getUserByTelegramId(req.params.telegramId);
      if (!user) return res.status(404).json({ error: "not_found" });
      user = await ensureWorkerPanelAccount(user);
      const currencyCtx = await getCurrencyContext();
      res.json({ ok: true, member: serializeMember(user, currencyCtx, { includePanelSecrets: true }) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post("/admin/members/:telegramId/panel/recreate", requireAdmin, async (req, res) => {
    try {
      let user = await getUserByTelegramId(req.params.telegramId);
      if (!user) return res.status(404).json({ error: "not_found" });
      user = await recreateWorkerPanelAccount(user);
      const currencyCtx = await getCurrencyContext();
      res.json({ ok: true, member: serializeMember(user, currencyCtx, { includePanelSecrets: true }) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post("/admin/members/:telegramId/panel/bind", requireAdmin, async (req, res) => {
    try {
      let user = await getUserByTelegramId(req.params.telegramId);
      if (!user) return res.status(404).json({ error: "not_found" });
      const login = String(req.body?.username || "").trim();
      const password = String(req.body?.password || "").trim();
      user = await bindWorkerPanelAccount(user, login, password);
      const currencyCtx = await getCurrencyContext();
      res.json({ ok: true, member: serializeMember(user, currencyCtx, { includePanelSecrets: true }) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post("/admin/members/:telegramId/panel/credentials", requireAdmin, async (req, res) => {
    try {
      const user = await getUserByTelegramId(req.params.telegramId);
      if (!user) return res.status(404).json({ error: "not_found" });
      if (!user.panelUsername || !user.panelPassword) {
        return res.status(404).json({ error: "Аккаунт UProject не привязан" });
      }
      res.setHeader("Cache-Control", "no-store");
      res.json({ username: user.panelUsername, password: user.panelPassword });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  /** Issue a short-lived one-time URL that logs the admin into the worker app as this member. */
  router.post("/admin/members/:telegramId/impersonate", requireAdmin, async (req, res) => {
    try {
      const result = await createImpersonationSession({
        adminTelegramId: req.adminTelegramId,
        adminUsername: req.panelAdmin?.username || req.admin?.username || "",
        targetTelegramId: req.params.telegramId,
      });
      res.setHeader("Cache-Control", "no-store");
      res.json({ ok: true, ...result });
    } catch (error) {
      const status = Number(error.status) || 400;
      res.status(status).json({ error: error.message || "impersonate_failed" });
    }
  });

  router.get("/admin/economy", requireAdmin, async (_req, res) => {
    try {
      const [globalPercent, currency, rate, withdrawalFees] = await Promise.all([
        getGlobalWorkerPercent(),
        getDisplayCurrency("USD"),
        getUsdRubRate(90),
        getWithdrawalFees(),
      ]);
      res.json({ globalPercent, currency, rate, withdrawalFees });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch("/admin/economy", requireAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      const out = {};
      if (body.globalPercent != null) {
        const previousPercent = await getGlobalWorkerPercent();
        out.globalPercent = await setGlobalWorkerPercent(body.globalPercent);
        if (Number(previousPercent) !== Number(out.globalPercent)) {
          try {
            out.percentAnnounce = await announceWorkerPercentChange(bot.telegram, {
              from: previousPercent,
              to: out.globalPercent,
              adminTelegramId: req.adminTelegramId || "admin",
            });
          } catch (_) {
            out.percentAnnounce = { ok: false };
          }
        }
      }
      if (body.currency != null) {
        out.currency = await setDisplayCurrency(body.currency);
      }
      if (body.rate != null) {
        out.rate = await setUsdRubRate(body.rate);
      }
      if (body.withdrawalFees != null && typeof body.withdrawalFees === "object") {
        out.withdrawalFees = await setWithdrawalFees(body.withdrawalFees);
        const { invalidateWithdrawalFeesCache, loadWithdrawalFees } = require("../services/withdrawalService");
        invalidateWithdrawalFeesCache();
        await loadWithdrawalFees(true);
      }
      const [globalPercent, currency, rate, withdrawalFees] = await Promise.all([
        getGlobalWorkerPercent(),
        getDisplayCurrency("USD"),
        getUsdRubRate(90),
        getWithdrawalFees(),
      ]);
      res.json({ ok: true, ...out, globalPercent, currency, rate, withdrawalFees });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post("/admin/economy/fake-profit", requireAdmin, async (req, res) => {
    try {
      const anonymous = Boolean(req.body?.anonymous);
      const ownerTelegramId = String(req.body?.ownerTelegramId || "").trim();
      const fakeTag = String(req.body?.fakeTag || "").trim();
      const resolved = await resolveFakeSteamProfitInput(String(req.body?.text || ""), {
        balanceUsd: req.body?.balanceUsd,
        mafileTime: req.body?.mafileTime,
        gamesCount: req.body?.gamesCount,
        totalUsd: req.body?.totalUsd,
        inventoryUsd: req.body?.inventoryUsd,
        fakeTag,
      });
      if (resolved.error) return res.status(400).json({ error: resolved.error });
      const sent = await sendFakeSteamProfit(bot, {
        items: resolved.items,
        total: resolved.total,
        balanceUsd: resolved.balanceUsd,
        inventoryUsd: resolved.inventoryUsd,
        games: resolved.games,
        mafileTime: resolved.mafileTime,
        ownerTelegramId: ownerTelegramId || (anonymous ? "" : ""),
        fakeTag: ownerTelegramId ? "" : (resolved.fakeTag || fakeTag),
      });
      res.json({
        ok: true,
        sourceId: sent.sourceId,
        fakeTag: sent.fakeTag,
        total: resolved.total,
        balanceUsd: resolved.balanceUsd,
        inventoryUsd: resolved.inventoryUsd,
        count: resolved.items.length,
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post("/admin/economy/fake-log", requireAdmin, async (req, res) => {
    try {
      const ownerTelegramId = String(req.body?.ownerTelegramId || "").trim();
      if (!ownerTelegramId) {
        return res.status(400).json({ error: "Укажите Telegram ID получателя" });
      }
      const parsed = parseFakeSteamLogInput(String(req.body?.text || ""));
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      await sendFakeSteamLog(bot, {
        account: parsed.account,
        ownerTelegramId,
      });
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get("/admin/apps", requireAdmin, async (req, res) => {
    try {
      const kind = String(req.query.kind || "pending");
      const page = Math.max(0, Number(req.query.page || 0));
      const [result, statusRows, form] = await Promise.all([
        listApplications({
          status: kind === "pending" ? "pending" : undefined,
          statuses: kind === "closed" ? ["accepted", "rejected"] : undefined,
          page,
        }),
        Application.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
        getForm("teamApplication").catch(() => null),
      ]);
      const apps = await Promise.all(
        (result.items || []).map(async (doc) => {
          const u = doc.userId && typeof doc.userId === "object" ? doc.userId : null;
          const campaign = await resolveCampaignLabel(doc.campaignId, doc.campaignSlug);
          return {
            ...serializeApplication(doc),
            username: u?.username || "",
            telegramId: u?.telegramId || "",
            firstName: u?.firstName || "",
            avatarUrl: resolveWorkerPhotoUrl(u),
            isTeamMember: Boolean(u?.isTeamMember),
            campaignName: campaign?.name || "",
            campaignSlug: campaign?.slug || doc.campaignSlug || "",
            campaignTelegramUrl: campaign?.telegramUrl || "",
          };
        })
      );
      const counts = { pending: 0, accepted: 0, rejected: 0 };
      for (const row of statusRows) counts[row._id] = Number(row.count || 0);
      res.json({
        page,
        total: result.total ?? apps.length,
        totalPages: result.totalPages,
        counts,
        questions: form?.questions || [],
        apps,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/admin/apps/:id", requireAdmin, async (req, res) => {
    try {
      const app = await getApplicationById(req.params.id);
      if (!app) return res.status(404).json({ error: "not_found" });
      const u = app.userId ? await User.findById(app.userId).lean() : null;
      res.json({
        application: {
          ...serializeApplication(app),
          username: u?.username || "",
          telegramId: u?.telegramId || "",
        },
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/admin/apps/:id/decide", requireAdmin, async (req, res) => {
    try {
      const action = String(req.body?.action || "");
      if (action !== "accept" && action !== "reject") {
        return res.status(400).json({ error: "invalid_action" });
      }
      const decided = await decideApplication(bot.telegram, req.params.id, action, {
        id: req.adminTelegramId,
        first_name: req.admin?.firstName || "Admin",
        username: req.admin?.username || "",
      });
      if (!decided?.ok) {
        const reason = decided?.reason || "decide_failed";
        const messages = {
          same_status: "Заявка уже в этом статусе",
          not_found: "Заявка не найдена",
          invalid_action: "Некорректное действие",
          already_processed: "Заявку нельзя обработать",
        };
        return res.status(400).json({ error: messages[reason] || reason, reason });
      }
      res.json({
        ok: true,
        reversed: Boolean(decided.reversed),
        previousStatus: decided.previousStatus || "",
        application: serializeApplication(decided.updated),
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get("/admin/forms/:formId", requireAdmin, async (req, res) => {
    try {
      const form = await getForm(req.params.formId || "teamApplication");
      res.json({ form });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/admin/forms/:formId/questions", requireAdmin, async (req, res) => {
    try {
      const question = await addFormQuestion(req.params.formId || "teamApplication", {
        label: req.body?.label,
        prompt: req.body?.prompt,
      });
      const form = await getForm(req.params.formId || "teamApplication");
      res.json({ ok: true, question, form });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.delete("/admin/forms/:formId/questions/:key", requireAdmin, async (req, res) => {
    try {
      const form = await removeFormQuestion(
        req.params.formId || "teamApplication",
        req.params.key
      );
      res.json({ ok: true, form });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get("/admin/payouts", requireAdmin, async (req, res) => {
    try {
      const status = String(req.query.status || "open");
      const filter =
        status === "open"
          ? { status: { $in: ["pending", "awaiting_payout_link"] } }
          : status === "all"
            ? {}
            : { status };
      const rows = await WithdrawalRequest.find(filter).sort({ createdAt: -1 }).limit(80);
      res.json({ payouts: rows.map(serializePayout) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/admin/payouts/:id", requireAdmin, async (req, res) => {
    try {
      const detail = await getPayoutAdminDetail(req.params.id);
      if (!detail) return res.status(404).json({ error: "not_found" });
      res.json(detail);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post("/admin/payouts/:id/approve", requireAdmin, async (req, res) => {
    try {
      const updated = await setAwaitingPayoutLink(
        req.params.id,
        req.adminTelegramId,
        payoutActorFromReq(req)
      );
      if (!updated) return res.status(400).json({ error: "Заявка недоступна или уже обработана" });
      res.json({ ok: true, payout: serializePayout(updated) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post("/admin/payouts/:id/link", requireAdmin, async (req, res) => {
    try {
      const { request } = await completePayoutWithLink(
        req.params.id,
        String(req.body?.url || ""),
        req.adminTelegramId,
        payoutActorFromReq(req)
      );
      await notifyApprovedPayout(bot, request);
      res.json({ ok: true, payout: serializePayout(request) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post("/admin/payouts/:id/reject", requireAdmin, async (req, res) => {
    try {
      const updated = await rejectPayout(
        req.params.id,
        req.adminTelegramId,
        payoutActorFromReq(req)
      );
      if (updated) await notifyRejectedPayout(bot, updated);
      res.json({ ok: true, payout: serializePayout(updated) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post("/admin/payouts/:id/comment", requireAdmin, async (req, res) => {
    try {
      const updated = await addPayoutComment(
        req.params.id,
        req.body?.text || req.body?.comment,
        payoutActorFromReq(req)
      );
      res.json({ ok: true, payout: serializePayout(updated), comments: updated.comments || [] });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post("/admin/comms/broadcast", requireAdmin, async (req, res) => {
    try {
      const text = String(req.body?.text || "").trim();
      if (!text) return res.status(400).json({ error: "empty_text" });
      const buttonText = String(req.body?.buttonText || "").trim();
      const buttonUrl = String(req.body?.buttonUrl || "").trim();
      const draft = {
        text,
        parseMode: "HTML",
        disablePreview: true,
        entities: [],
        button:
          buttonText && buttonUrl
            ? { text: buttonText.slice(0, 64), url: buttonUrl.slice(0, 500) }
            : undefined,
      };
      const result = await runBroadcast(bot.telegram, draft);
      res.json({ ok: true, result });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get("/admin/comms/recipients", requireAdmin, async (_req, res) => {
    try {
      const recipients = await getBroadcastRecipients();
      res.json({ count: recipients.length });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/admin/comms/panel-notify", requireAdmin, async (req, res) => {
    try {
      const doc = await createPanelNotification(req.body || {}, req.adminTelegramId);
      res.json({
        ok: true,
        notification: {
          id: String(doc._id),
          title: doc.title,
          severity: doc.severity,
          linkType: doc.linkType,
          createdAt: doc.createdAt,
        },
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post("/admin/comms/manuals-thread", requireAdmin, async (_req, res) => {
    try {
      const result = await seedManualsThread(bot.telegram);
      res.json({ ok: true, result });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post("/admin/comms/launch-announce", requireAdmin, async (_req, res) => {
    try {
      const result = await publishLaunchAnnounce(bot.telegram);
      res.json({ ok: true, result });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post("/admin/comms/autosale-announce", requireAdmin, async (req, res) => {
    try {
      const result = await announceAutosaleFeature(bot.telegram, {
        adminTelegramId: req.adminTelegramId,
      });
      res.json({
        ok: true,
        broadcast: result.broadcast,
        notification: result.notification,
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post("/admin/comms/discord-announce", requireAdmin, async (req, res) => {
    try {
      const result = await announceDiscordServer(bot.telegram, {
        adminTelegramId: req.adminTelegramId,
      });
      res.json({
        ok: true,
        inviteUrl: result.inviteUrl,
        broadcast: result.broadcast,
        notification: result.notification,
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post("/admin/comms/changelog", requireAdmin, async (_req, res) => {
    try {
      const result = await publishChangelog(bot.telegram);
      res.json({ ok: true, result });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post("/admin/comms/dynamic-pin", requireAdmin, async (_req, res) => {
    try {
      const result = await publishOrRefreshDynamicPin(bot.telegram);
      res.json({ ok: true, result });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get("/admin/steam-logs", requireAdmin, async (req, res) => {
    try {
      const id = String(req.query.id || "").trim();
      if (id) {
        const account = await fetchSteamAccountById(id);
        return res.json({ account });
      }
      const list = await listSteamAccountsForAdmin({
        offset: Number(req.query.offset || 0),
        limit: Number(req.query.limit || 30),
        filter: String(req.query.q || ""),
      });
      res.json(list);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get("/admin/admins", requireAdmin, async (_req, res) => {
    try {
      res.json({ admins: await listPanelAdmins() });
    } catch (_) {
      res.status(500).json({ error: "admins_load_failed" });
    }
  });

  router.post("/admin/admins", requireAdmin, async (req, res) => {
    try {
      const admin = await createPanelAdmin(
        req.body?.username,
        req.body?.password,
        req.body?.displayName,
        req.panelAdmin?.username || ""
      );
      res.status(201).json({ ok: true, admin: {
        id: String(admin._id), username: admin.username,
        displayName: admin.displayName || admin.username, active: true,
        createdAt: admin.createdAt || null, createdByUsername: admin.createdByUsername || "", lastLoginAt: null,
      } });
    } catch (error) {
      const message = String(error?.message || "");
      const status = message === "admin_username_taken" ? 409 : 400;
      res.status(status).json({ error: message || "admin_create_failed" });
    }
  });

  router.get("/admin/steam-control/accounts", requireAdmin, async (req, res) => {
    try {
      res.json(await listControlledAccounts(req.query));
    } catch (error) {
      res.status(400).json({ error: error?.response?.data?.message || error.message });
    }
  });

  router.get("/admin/steam-control/stats", requireAdmin, async (_req, res) => {
    try {
      res.json(await getSteamStats());
    } catch (error) {
      res.status(400).json({ error: error?.response?.data?.message || error.message });
    }
  });

  router.get("/admin/steam-control/accounts/:id", requireAdmin, async (req, res) => {
    try {
      res.json({ account: await getControlledAccount(req.params.id) });
    } catch (error) {
      res.status(400).json({ error: error?.response?.data?.message || error.message });
    }
  });

  router.get("/admin/steam-control/accounts/:id/games", requireAdmin, async (req, res) => {
    try {
      res.json(await getSteamAccountGames(req.params.id));
    } catch (error) {
      res.status(400).json({ error: error?.response?.data?.message || error.message });
    }
  });

  router.get("/admin/steam-control/accounts/:id/inventory", requireAdmin, async (req, res) => {
    try {
      res.json(await getAccountInventory(req.params.id));
    } catch (error) {
      res.status(400).json({ error: error?.response?.data?.message || error.message });
    }
  });

  router.post("/admin/steam-control/accounts/:id/status", requireAdmin, async (req, res) => {
    try {
      res.json({ ok: true, result: await changeAccountStatus(req.params.id, req.body?.status) });
    } catch (error) {
      res.status(400).json({ error: error?.response?.data?.message || error.message });
    }
  });

  router.post("/admin/steam-control/accounts/:id/tags", requireAdmin, async (req, res) => {
    try {
      res.json({ ok: true, result: await changeAccountTags(req.params.id, req.body) });
    } catch (error) {
      res.status(400).json({ error: error?.response?.data?.message || error.message });
    }
  });

  router.post("/admin/steam-control/accounts/:id/telegram", requireAdmin, async (req, res) => {
    try {
      const sourceId = String(req.params.id || "").trim();
      if (!sourceId) {
        return res.status(400).json({ error: "Не указан ID аккаунта" });
      }
      let localLog = await SteamLog.findOne({ sourceId }).lean();
      let account = null;
      try {
        account = await getControlledAccount(sourceId);
      } catch (error) {
        account = getCachedControlledAccount(sourceId) || accountFromSteamLog(localLog);
        if (!account) throw error;
      }
      if (!account) {
        return res.status(404).json({ error: "Аккаунт не найден. Проверьте ID и повторите." });
      }
      if (!localLog) {
        const upserted = await upsertSteamLogFromAccount(account);
        localLog = upserted?.toObject ? upserted.toObject() : upserted;
      }

      res.json({
        ok: true,
        result: await sendAccountCardToTelegram(bot, account, req.body?.target, { localLog }),
      });
    } catch (error) {
      const errorStatus = Number(error?.status || 0);
      const status = errorStatus >= 400 && errorStatus < 600 ? errorStatus : 400;
      res.status(status).json({ error: error.message || "send_failed" });
    }
  });

  router.get("/admin/steam-control/accounts/:id/email", requireAdmin, async (req, res) => {
    try {
      res.json(await getAccountEmail(req.params.id));
    } catch (error) {
      res.status(400).json({ error: error?.response?.data?.message || error.message });
    }
  });

  router.get("/admin/steam-control/accounts/:id/mafile", requireAdmin, async (req, res) => {
    try {
      res.json(await downloadSteamAccount(req.params.id));
    } catch (error) {
      res.status(400).json({ error: error?.response?.data?.message || error.message });
    }
  });

  router.get("/admin/steam-control/accounts/:id/2fa/code", requireAdmin, async (req, res) => {
    try {
      res.json(await getSteamTwoFactorCode(req.params.id));
    } catch (error) {
      res.status(400).json({ error: error?.response?.data?.message || error.message });
    }
  });

  router.get("/admin/steam-control/accounts/:id/2fa/confirmations", requireAdmin, async (req, res) => {
    try {
      res.json(await getSteamTwoFactorConfirmations(req.params.id, req.query));
    } catch (error) {
      res.status(400).json({ error: error?.response?.data?.message || error.message });
    }
  });

  router.post("/admin/steam-control/accounts/:id/2fa/confirmations", requireAdmin, async (req, res) => {
    try {
      const confId = String(req.body?.confId || "");
      const nonce = String(req.body?.nonce || "");
      if (!confId || !nonce) throw new Error("Не указано подтверждение Steam Guard");
      res.json({ ok: true, result: await actOnSteamTwoFactorConfirmation(req.params.id, {
        confId,
        nonce,
        accept: Boolean(req.body?.accept),
      }) });
    } catch (error) {
      res.status(400).json({ error: error?.response?.data?.message || error.message });
    }
  });

  router.post("/admin/steam-control/export", requireAdmin, async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite).slice(0, 100) : [];
      if (!ids.length) throw new Error("Выберите логи для экспорта");
      res.json({ rows: await exportSteamAccounts(ids) });
    } catch (error) {
      res.status(400).json({ error: error?.response?.data?.message || error.message });
    }
  });

  router.post("/admin/steam-control/tasks", requireAdmin, async (req, res) => {
    try {
      res.json({ ok: true, task: await runAccountTask(req.body || {}) });
    } catch (error) {
      res.status(400).json({ error: error?.response?.data?.message || error.message });
    }
  });

  router.get("/admin/steam-control/tasks", requireAdmin, async (req, res) => {
    try {
      res.json(await getSteamTasks(req.query));
    } catch (error) {
      res.status(400).json({ error: error?.response?.data?.message || error.message });
    }
  });

  router.get("/admin/steam-control/tasks/:id", requireAdmin, async (req, res) => {
    try {
      res.json(await getSteamTask(req.params.id));
    } catch (error) {
      res.status(400).json({ error: error?.response?.data?.message || error.message });
    }
  });

  router.post("/admin/steam-control/tasks/:id/cancel", requireAdmin, async (req, res) => {
    try {
      res.json({ ok: true, result: await cancelSteamTask(req.params.id) });
    } catch (error) {
      res.status(400).json({ error: error?.response?.data?.message || error.message });
    }
  });

  router.get("/admin/steam-control/handlers/:kind", requireAdmin, async (req, res) => {
    try {
      res.json(await getSteamHandlerAccounts(req.params.kind, req.query));
    } catch (error) {
      res.status(400).json({ error: error?.response?.data?.message || error.message });
    }
  });

  router.post("/admin/steam-control/handlers/:kind/request", requireAdmin, async (req, res) => {
    try {
      res.json({ ok: true, result: await requestSteamHandlerAccounts(req.params.kind) });
    } catch (error) {
      res.status(400).json({ error: error?.response?.data?.message || error.message });
    }
  });

  router.post("/admin/steam-control/handlers/:kind/update", requireAdmin, async (req, res) => {
    try {
      res.json({ ok: true, result: await updateSteamHandlerAccount(req.params.kind, req.body || {}) });
    } catch (error) {
      res.status(400).json({ error: error?.response?.data?.message || error.message });
    }
  });

  router.get("/admin/mafiles", requireAdmin, async (req, res) => {
    try {
      const rows = await listMafileLogs({
        q: req.query.q,
        status: req.query.status,
        limit: req.query.limit,
      });
      res.json({ rows });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get("/admin/auto-sales", requireAdmin, async (req, res) => {
    try {
      const period = resolveAutoSaleStatsPeriod(String(req.query.period || "7d"));
      const [listed, stats, teamOpsListed, lastExportTime] = await Promise.all([
        listAutoSaleLogs({
          q: req.query.q,
          status: req.query.status,
          limit: req.query.limit,
          page: req.query.page,
        }),
        getAutoSaleStats({ period: period.key }),
        listTeamShareOperations({
          limit: req.query.opsLimit || 5,
          page: req.query.opsPage,
          q: req.query.opsQ,
          flaggedOnly: String(req.query.opsFlagged || "") === "1",
          range: { start: period.since, end: period.until },
        }),
        getTeamShareLastExportTime(),
      ]);
      const currencyCtx = await getCurrencyContext();
      res.json({
        rows: listed.rows,
        total: listed.total,
        page: listed.page,
        pageCount: listed.pageCount,
        limit: listed.limit,
        stats: formatAutoSaleStatsDisplay(stats, currencyCtx),
        teamOps: teamOpsListed.rows,
        teamOpsTotal: teamOpsListed.total,
        teamOpsPage: teamOpsListed.page,
        teamOpsPageCount: teamOpsListed.pageCount,
        teamOpsFlagged: Boolean(teamOpsListed.flaggedOnly),
        teamOpsLastExportTime: lastExportTime ? lastExportTime.toISOString() : "",
        teamOpsLastExportLabel: lastExportTime ? formatTeamShareDateTime(lastExportTime) : "",
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get("/admin/auto-sales/lzt-summary", requireAdmin, async (_req, res) => {
    try {
      const [summary, currencyCtx] = await Promise.all([
        getFreshLztOnSaleStats(),
        getCurrencyContext(),
      ]);
      if (!summary) {
        return res.json({ available: false, count: 0, usd: 0, display: "$0.00" });
      }
      return res.json({
        available: true,
        count: Number(summary.count || 0),
        usd: Number(summary.usd || 0),
        display: formatDisplayAmount(summary.usd, currencyCtx),
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  router.get("/admin/auto-sales/uproject-summary", requireAdmin, async (_req, res) => {
    try {
      const [summary, currencyCtx] = await Promise.all([
        getUprojectFinanceSnapshot(),
        getCurrencyContext(),
      ]);
      return res.json({
        ...summary,
        balanceDisplay: formatDisplayAmount(summary.balanceUsd, currencyCtx),
      });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  router.post("/admin/auto-sales/refresh-guarantees", requireAdmin, async (_req, res) => {
    try {
      const [summary, currencyCtx] = await Promise.all([
        refreshActiveGuaranteeHolds(),
        getCurrencyContext(),
      ]);
      return res.json({
        ...summary,
        activeGuarantee12hGrossDisplay: formatDisplayAmount(
          summary.activeGuarantee12hGrossUsd,
          currencyCtx
        ),
        activeGuaranteeGrossDisplay: formatDisplayAmount(
          summary.activeGuaranteeGrossUsd,
          currencyCtx
        ),
        activeGuarantee12hWorkerShareDisplay: formatDisplayAmount(
          summary.activeGuarantee12hWorkerShareUsd,
          currencyCtx
        ),
        activeGuarantee12hTeamShareDisplay: formatDisplayAmount(
          summary.activeGuarantee12hTeamShareUsd,
          currencyCtx
        ),
      });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  router.post("/admin/auto-sales/sync", requireAdmin, async (_req, res) => {
    try {
      const result = await syncExistingAutoSalesFromUproject();
      let teamShare = null;
      try {
        teamShare = await syncUprojectTeamShareDebits();
      } catch (error) {
        teamShare = { error: error.message };
      }
      res.json({ ok: true, ...result, teamShare });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post("/admin/auto-sales/team-ops", requireAdmin, async (req, res) => {
    try {
      const stats = await getAutoSaleStats();
      const op = await createTeamShareDebit({
        amountUsd: req.body?.amount ?? req.body?.amountUsd,
        reason: req.body?.reason,
        actorTelegramId: req.adminTelegramId || "",
        actorUsername: req.panelAdmin?.username || req.admin?.username || "",
        availableUsd: stats.teamShareUsd,
      });
      const nextStats = await getAutoSaleStats();
      const teamOpsListed = await listTeamShareOperations({
        limit: req.query.opsLimit || 5,
        page: 0,
        q: req.query.opsQ,
      });
      const currencyCtx = await getCurrencyContext();
      res.json({
        ok: true,
        op,
        stats: formatAutoSaleStatsDisplay(nextStats, currencyCtx),
        teamOps: teamOpsListed.rows,
        teamOpsTotal: teamOpsListed.total,
        teamOpsPage: teamOpsListed.page,
        teamOpsPageCount: teamOpsListed.pageCount,
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get("/admin/auto-sales/team-ops/export", requireAdmin, async (req, res) => {
    try {
      const fullReport = String(req.query.scope || "").toLowerCase() === "all";
      const exportParams = {
        q: req.query.opsQ || req.query.q,
        from: req.query.from || req.query.start || "",
        to: req.query.to || req.query.end || "",
      };
      const exported = fullReport
        ? await exportAllTeamShareOperations({
            ...exportParams,
            summary: await getAutoSaleStats(),
          })
        : await exportFlaggedTeamShareOperations(exportParams);
      const period = `${exported.startLabel} — ${exported.endLabel} МСК`;
      const total = Number(exported.total || 0);
      if (!total && !fullReport) {
        return res.json({
          ok: true,
          total: 0,
          delivered: false,
          start: exported.start,
          end: exported.end,
          startLabel: exported.startLabel,
          endLabel: exported.endLabel,
          mode: exported.mode,
        });
      }
      const chatIds = await resolveAdminDmIds(req);
      if (!chatIds.length) {
        throw new Error("Нет Telegram администратора.");
      }
      const filename = `garbona-team-share-${fullReport ? "full" : "issues"}-${new Date().toISOString().slice(0, 10)}.txt`;
      const caption = fullReport
        ? `Доля команды · полный отчёт · ${total} операций · ${period}`
        : `Списания доли команды · ${total} расхождений · ${period}`;
      let delivered = 0;
      let lastError = "";
      for (const chatId of chatIds) {
        try {
          await bot.telegram.sendDocument(
            chatId,
            { source: Buffer.from(exported.txt, "utf8"), filename },
            { caption }
          );
          delivered += 1;
        } catch (error) {
          lastError = error.message || String(error);
          logger.warn("team-share export telegram failed", chatId, lastError);
        }
      }
      if (!delivered) {
        throw new Error(lastError || "Не удалось отправить файл в Telegram.");
      }
      const lastExportTime = await markTeamShareExportSuccess(exported.end);
      res.json({
        ok: true,
        total,
        delivered: true,
        start: exported.start,
        end: exported.end,
        startLabel: exported.startLabel,
        endLabel: exported.endLabel,
        mode: exported.mode,
        scope: fullReport ? "all" : "flagged",
        lastExportTime: lastExportTime.toISOString(),
        lastExportLabel: formatTeamShareDateTime(lastExportTime),
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post("/admin/auto-sales/team-ops/import", requireAdmin, async (req, res) => {
    try {
      const since = parseTeamShareSince(req.body?.since || req.body?.from || req.body?.date);
      const teamShare = await syncUprojectTeamShareDebits({ since });
      const nextStats = await getAutoSaleStats();
      const teamOpsListed = await listTeamShareOperations({
        limit: req.query.opsLimit || 5,
        page: 0,
        q: req.query.opsQ,
      });
      const currencyCtx = await getCurrencyContext();
      res.json({
        ok: true,
        since: since.toISOString(),
        teamShare,
        stats: formatAutoSaleStatsDisplay(nextStats, currencyCtx),
        teamOps: teamOpsListed.rows,
        teamOpsTotal: teamOpsListed.total,
        teamOpsPage: teamOpsListed.page,
        teamOpsPageCount: teamOpsListed.pageCount,
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post("/admin/auto-sales/team-ops/:id/cancel", requireAdmin, async (req, res) => {
    try {
      const op = await cancelTeamShareDebit({
        id: req.params.id,
        actorTelegramId: req.adminTelegramId || "",
        actorUsername: req.panelAdmin?.username || req.admin?.username || "",
      });
      const nextStats = await getAutoSaleStats();
      const teamOpsListed = await listTeamShareOperations({
        limit: req.query.opsLimit || 5,
        page: req.query.opsPage || 0,
        q: req.query.opsQ,
      });
      const currencyCtx = await getCurrencyContext();
      res.json({
        ok: true,
        op,
        stats: formatAutoSaleStatsDisplay(nextStats, currencyCtx),
        teamOps: teamOpsListed.rows,
        teamOpsTotal: teamOpsListed.total,
        teamOpsPage: teamOpsListed.page,
        teamOpsPageCount: teamOpsListed.pageCount,
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post("/admin/auto-sales/:sourceId/action", requireAdmin, async (req, res) => {
    try {
      const row = await adminAutoSaleAction(req.params.sourceId, req.body?.action);
      res.json({ ok: true, row });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get("/admin/finance", requireAdmin, async (req, res) => {
    try {
      const includeTx = String(req.query.includeTx || "1") !== "0";
      const currencyCtx = await getCurrencyContext();
      const [overview, transactions, autoSaleStats] = await Promise.all([
        getAdminFinanceOverview({
          q: req.query.q,
          issuesOnly: String(req.query.issuesOnly || "") === "1",
          limit: req.query.limit,
        }),
        includeTx
          ? listAdminFinanceTransactions({
              limit: req.query.txLimit,
              telegramId: req.query.telegramId,
            })
          : Promise.resolve([]),
        includeTx ? getAutoSaleStats() : Promise.resolve(null),
      ]);
      const totals = overview.totals || {};
      res.json({
        overview: {
          ...overview,
          totals: {
            ...totals,
            walletDisplay: formatDisplayAmount(totals.walletUsd, currencyCtx),
            frozenDisplay: formatDisplayAmount(totals.frozenSaleUsd, currencyCtx),
            reservedDisplay: formatDisplayAmount(totals.reservedUsd, currencyCtx),
            availableDisplay: formatDisplayAmount(totals.availableUsd, currencyCtx),
            activeHoldFrozenDisplay: formatDisplayAmount(totals.activeHoldFrozenUsd, currencyCtx),
            teamShareOnHoldDisplay: formatDisplayAmount(totals.teamShareOnHoldUsd, currencyCtx),
            autosaleWorkerShareDisplay: formatDisplayAmount(
              totals.autosaleWorkerShareUsd,
              currencyCtx
            ),
          },
        },
        transactions,
        autoSales: autoSaleStats ? formatAutoSaleStatsDisplay(autoSaleStats, currencyCtx) : null,
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get("/admin/finance/:telegramId", requireAdmin, async (req, res) => {
    try {
      const user = await getUserByTelegramId(req.params.telegramId);
      if (!user) return res.status(404).json({ error: "not_found" });
      const currencyCtx = await getCurrencyContext();
      const [overview, transactions] = await Promise.all([
        getAdminFinanceOverview({ q: req.params.telegramId, limit: 1 }),
        listAdminFinanceTransactions({ telegramId: req.params.telegramId, limit: 60 }),
      ]);
      const worker =
        overview.workers?.find((row) => row.telegramId === String(req.params.telegramId)) ||
        null;
      res.json({
        member: serializeMember(user, currencyCtx),
        worker,
        transactions,
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.patch("/admin/mafiles/:sourceId/status", requireAdmin, async (req, res) => {
    try {
      const result = await updateMafileStatus({
        bot,
        sourceId: req.params.sourceId,
        status: req.body?.status,
        amount: req.body?.amount,
        adminId: req.adminTelegramId || req.admin?._id,
        skipCredit: parseSkipCredit(req.body?.skipCredit) || req.body?.credit === false,
        profitTransactionId: req.body?.profitTransactionId || "",
        workerShare: req.body?.workerShare,
        workerPercent: req.body?.workerPercent,
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get("/admin/bot-logs", requireAdmin, async (req, res) => {
    try {
      const text = getRecentLogsText(Number(req.query.lines || 250));
      res.type("text/plain").send(text);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/admin/search", requireAdmin, async (req, res) => {
    try {
      const user = await findUserByQuery(String(req.query.q || ""));
      if (!user) return res.status(404).json({ error: "not_found" });
      const currencyCtx = await getCurrencyContext();
      res.json({ member: serializeMember(user, currencyCtx) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/admin/sites/domains", requireAdmin, async (req, res) => {
    try {
      res.json(await listAdminDomains(req.admin));
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.get("/admin/sites/analytics", requireAdmin, async (req, res) => {
    try {
      res.json(await listAdminSiteAnalytics(req.admin));
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.get("/admin/sites/domains/:id", requireAdmin, async (req, res) => {
    try {
      res.json(await getDomainDetail(req.admin, req.params.id));
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.post("/admin/sites/domains/check", requireAdmin, async (req, res) => {
    try {
      res.json(await previewAddDomain(req.admin, req.body?.domain, { asAdmin: true }));
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.post("/admin/sites/domains", requireAdmin, async (req, res) => {
    try {
      res.json(
        await addDomain(req.admin, req.body?.domain, {
          asAdmin: true,
          bindType: req.body?.bindType || req.body?.type || "ip",
          isTransit: req.body?.isTransit === true || req.body?.isTransit === "true",
        })
      );
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.delete("/admin/sites/domains/:id", requireAdmin, async (req, res) => {
    try {
      res.json(await removeDomain(req.admin, req.params.id, { asAdmin: true }));
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.get("/admin/sites/templates", requireAdmin, async (req, res) => {
    try {
      res.json(await listTemplates(req.admin, { scope: "admin" }));
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.post("/admin/sites/templates", requireAdmin, async (req, res) => {
    try {
      res.json(
        await createAdminTemplate(req.admin, {
          name: req.body?.name,
          code: req.body?.code,
          isPublic: req.body?.isPublic,
        })
      );
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.get("/admin/sites/templates/visibility", requireAdmin, async (req, res) => {
    try {
      res.json(await listTemplateVisibility(req.admin));
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.post("/admin/sites/templates/visibility", requireAdmin, async (req, res) => {
    try {
      res.json(
        await enableTemplateById(req.admin, req.body?.id ?? req.body?.templateId, {
          name: req.body?.name,
        })
      );
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.patch("/admin/sites/templates/visibility/:id", requireAdmin, async (req, res) => {
    try {
      res.json(await renameTemplateById(req.admin, req.params.id, req.body?.name));
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.delete("/admin/sites/templates/visibility/:id", requireAdmin, async (req, res) => {
    try {
      res.json(await disableTemplateById(req.admin, req.params.id));
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.post("/admin/sites/domains/:id/links", requireAdmin, async (req, res) => {
    try {
      res.json(
        await createLink(req.admin, req.params.id, {
          path: req.body?.path,
          templateId: req.body?.templateId,
          windowType: req.body?.windowType,
        })
      );
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.get("/admin/sites/workers", requireAdmin, async (req, res) => {
    try {
      res.json(await listWorkers(req.admin));
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.get("/admin/sites/referrals", requireAdmin, async (req, res) => {
    try {
      res.json(await listTeamReferrals(req.admin));
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.patch("/admin/sites/referrals/:telegramId/:domainId", requireAdmin, async (req, res) => {
    try {
      res.json(
        await updateTeamReferral(
          req.admin,
          { telegramId: req.params.telegramId, domainId: req.params.domainId },
          {
            templateId: req.body?.templateId,
            windowType: req.body?.windowType,
          }
        )
      );
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  router.delete("/admin/sites/referrals/:telegramId/:domainId", requireAdmin, async (req, res) => {
    try {
      res.json(
        await deleteTeamReferral(req.admin, {
          telegramId: req.params.telegramId,
          domainId: req.params.domainId,
        })
      );
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });

  return router;
}

async function getDailyProfitSeries(days = 7) {
  const SteamLog = require("../models/SteamLog");
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [profitRows, mafileRows] = await Promise.all([
    ProfitTransaction.aggregate([
      { $match: profitStatsFilter({ createdAt: { $gte: since } }) },
      {
        $group: {
          _id: {
            y: { $year: "$createdAt" },
            m: { $month: "$createdAt" },
            d: { $dayOfMonth: "$createdAt" },
          },
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.y": 1, "_id.m": 1, "_id.d": 1 } },
    ]),
    SteamLog.aggregate([
      {
        $match: {
          logKind: "mafile",
          status: "processed",
          createdAt: { $gte: since },
          totalProfit: { $gt: 0 },
        },
      },
      {
        $group: {
          _id: {
            y: { $year: "$createdAt" },
            m: { $month: "$createdAt" },
            d: { $dayOfMonth: "$createdAt" },
          },
          total: { $sum: "$totalProfit" },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const byKey = new Map();
  const addRows = (rows) => {
    for (const row of rows || []) {
      const key = `${row._id.y}-${row._id.m}-${row._id.d}`;
      const prev = byKey.get(key) || { total: 0, count: 0 };
      byKey.set(key, {
        total: prev.total + Number(row.total || 0),
        count: prev.count + Number(row.count || 0),
      });
    }
  };
  addRows(profitRows);
  addRows(mafileRows);

  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    const hit = byKey.get(key) || { total: 0, count: 0 };
    out.push({
      date: d.toISOString().slice(0, 10),
      label: formatDayLabel(d),
      total: hit.total,
      count: hit.count,
    });
  }
  return out;
}

function formatDayLabel(d) {
  const months = [
    "янв.",
    "фев.",
    "мар.",
    "апр.",
    "мая",
    "июн.",
    "июл.",
    "авг.",
    "сен.",
    "окт.",
    "ноя.",
    "дек.",
  ];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

module.exports = { createPanelRouter };
