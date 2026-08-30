const { formatDisplayAmount, getCurrencyContext } = require("../services/currencyService");
const { resolveWorkerPhotoUrl } = require("../utils/profilePhoto");
const { buildTelegramDeepLink } = require("../services/adCampaignService");

function serializeMember(user, currencyCtx, options = {}) {
  if (!user) return null;
  const walletUsd = Number(user.totalProfit || 0);
  const out = {
    telegramId: String(user.telegramId),
    customId: user.customId || "",
    username: user.username || "",
    firstName: user.firstName || "",
    photoUrl: resolveWorkerPhotoUrl(user),
    role: user.role || "user",
    isTeamMember: Boolean(user.isTeamMember),
    isModerator: Boolean(user.isModerator),
    isCurator: Boolean(user.isCurator),
    curatorDescription: user.curatorDescription || "",
    curatorPercent: user.curatorPercent ?? 80,
    curatorMinProfits: user.curatorMinProfits ?? 0,
    curatorTelegramId: user.curatorTelegramId || "",
    isCaller: Boolean(user.isCaller),
    callerDescription: user.callerDescription || "",
    callerPercent: user.callerPercent ?? 80,
    callerMinProfits: user.callerMinProfits ?? 0,
    callerTelegramId: user.callerTelegramId || "",
    isBanned: Boolean(user.isBanned),
    profitPercent: Number(user.profitPercent ?? 70),
    walletUsd,
    walletDisplay: formatDisplayAmount(walletUsd, currencyCtx),
    panelUsername: user.panelUsername || "",
    hasPanelPassword: Boolean(user.panelPassword),
    panelCreatedAt: user.panelCreatedAt || null,
    panelSteamSettingsVersion: Number(user.panelSteamSettingsVersion || 0),
    panelSteamSettingsConfiguredAt: user.panelSteamSettingsConfiguredAt || null,
    panelSteamSettingsError: user.panelSteamSettingsError || "",
    bio: user.bio || "",
    isAnonymous: Boolean(user.isAnonymous),
    autoSellLogs: user.autoSellLogs !== false,
    frozenSaleUsd: Number(user.frozenSaleUsd || 0),
    fakeProfitTag: String(user.fakeProfitTag || ""),
    discordId: user.discordId || "",
    discordUsername: user.discordUsername || "",
    discordVerifiedAt: user.discordVerifiedAt || null,
    branchId: String(user.branchId || ""),
    canCreateBranch: Boolean(user.canCreateBranch),
    createdAt: user.createdAt || null,
    campaignId: String(user.campaignId || ""),
    campaignSlug: String(user.campaignSlug || ""),
    campaignTelegramUrl: buildTelegramDeepLink(user.campaignSlug || ""),
    campaignAttributedAt: user.campaignAttributedAt || null,
  };
  return out;
}

function serializeApplication(app) {
  if (!app) return null;
  const userRef = app.userId;
  const userId =
    userRef && typeof userRef === "object"
      ? String(userRef._id || userRef.id || "")
      : String(userRef || "");
  return {
    id: String(app._id),
    userId,
    telegramId: app.telegramId || "",
    username: app.username || "",
    formId: app.formId || "teamApplication",
    status: app.status,
    answers: app.answers || {},
    moderatorId: app.moderatorId || "",
    channelMessageId: app.channelMessageId || "",
    campaignId: String(app.campaignId || ""),
    campaignSlug: String(app.campaignSlug || ""),
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
  };
}

function serializePayout(req) {
  if (!req) return null;
  const id = String(req._id);
  return {
    id,
    shortId: id.slice(-8),
    userId: req.userId ? String(req.userId) : "",
    telegramId: req.telegramId || "",
    username: req.username || "",
    amountUsd: Number(req.amountUsd || 0),
    method: req.method,
    walletAddress: req.walletAddress || "",
    status: req.status,
    payoutUrl: req.payoutUrl || "",
    resolvedByTelegramId: String(req.resolvedByTelegramId || ""),
    createdAt: req.createdAt,
    updatedAt: req.updatedAt,
  };
}

/**
 * Приводит запись SteamLog к форме аккаунта UProject — это база для рендера карточек,
 * которую затем дополняют свежие данные из API.
 */
function accountFromSteamLog(log) {
  if (!log) return null;
  const inventoryUsd = Number(log.inventoryUsd || 0);
  const balanceUsd = Number(log.balanceUsd || 0);
  const isMafile = log.logKind === "mafile";
  const steamId = String(log.steamId || "").trim();
  const games = Array.isArray(log.mafileSnapshot?.games) ? log.mafileSnapshot.games : [];
  const status = isMafile
    ? "MaFile"
    : log.logKind === "valid"
      ? "Ok"
      : String(log.logKind || "other");

  return {
    id: String(log.sourceId || ""),
    username: String(log.accountUsername || log.sourceId || ""),
    status,
    statusLabel: status,
    isMaFile: isMafile,
    owner: { telegram: String(log.ownerTelegramId || "") },
    steamInfo: {
      steamid: /^7656119\d{10}$/.test(steamId) ? steamId : "",
      nickname: String(log.accountUsername || ""),
      balanceUsd,
    },
    inventory: {
      price: {
        tradable: inventoryUsd,
        marketable: inventoryUsd,
        total: inventoryUsd,
      },
    },
    mafileSnapshot: log.mafileSnapshot || {},
    gamesInfo: games,
    games,
    gamesCount: games.length,
    totalProfit: Number(log.totalProfit || 0),
  };
}

async function withCurrency(fn) {
  const currencyCtx = await getCurrencyContext();
  return fn(currencyCtx);
}

module.exports = {
  serializeMember,
  serializeApplication,
  serializePayout,
  accountFromSteamLog,
  withCurrency,
};
