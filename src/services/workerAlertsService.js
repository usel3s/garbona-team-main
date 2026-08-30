const { listDomains } = require("./adminSitesService");
const {
  listActivePanelNotifications,
  panelNotificationToAlert,
} = require("./panelNotificationService");
const WithdrawalRequest = require("../models/WithdrawalRequest");
const SteamLog = require("../models/SteamLog");
const { methodLabel, isLinkPayoutMethod } = require("./withdrawalService");
const { autoSaleHoldSoldNote } = require("./autoLogSaleService");

const NEW_USER_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_STORED_IDS = 300;

function capIds(ids) {
  return [...new Set((ids || []).map(String))].slice(-MAX_STORED_IDS);
}

function alertTimestamp(alert) {
  if (!alert?.createdAt) return Number.NEGATIVE_INFINITY;
  const timestamp = new Date(alert.createdAt).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function sortAlertsNewestFirst(alerts) {
  return (alerts || [])
    .map((alert, index) => ({ alert, index, timestamp: alertTimestamp(alert) }))
    .sort((a, b) => b.timestamp - a.timestamp || a.index - b.index)
    .map(({ alert }) => alert);
}

function buildAlertsFromDomains(domains) {
  const alerts = [];
  for (const domain of domains || []) {
    const domainName = String(domain.domain || domain.id || "domain");
    if (domain.isPaused) {
      alerts.push({
        id: `paused:${domain.id}`,
        type: "paused",
        severity: "warn",
        title: domainName,
        message: "Домен на паузе — ссылки не работают",
        domainId: domain.id,
        createdAt: domain.updatedAt || domain.createdAt || null,
      });
    }
    const checks = domain.banChecks || {};
    for (const key of ["google", "cloudflare", "whois", "yandex", "steam"]) {
      if (checks[key]?.banned) {
        alerts.push({
          id: `ban:${domain.id}:${key}`,
          type: "ban",
          severity: "danger",
          title: domainName,
          message: `Бан: ${key}`,
          domainId: domain.id,
          banType: key,
          createdAt: checks.updatedAt || domain.updatedAt || null,
        });
      }
    }
  }

  return sortAlertsNewestFirst(alerts);
}

function payoutAlert(row) {
  const method = methodLabel(row.method);
  const action = isLinkPayoutMethod(row.method) ? "активировать чек" : "посмотреть транзакцию";
  return {
    id: `payout:${row._id}`,
    type: "payout",
    severity: "info",
    title: "Вывод одобрен",
    message: `Одобрен вывод $${Number(row.amountUsd || 0).toFixed(2)} через ${method}. Нажмите, чтобы ${action}.`,
    linkType: row.payoutUrl ? "url" : "view",
    linkView: row.payoutUrl ? "" : "wallet",
    linkUrl: row.payoutUrl || "",
    createdAt: row.updatedAt || row.createdAt || null,
  };
}

function autoSaleAlert(row) {
  const sourceId = String(row.sourceId || "");
  const gross = Number(row.autoSaleGrossUsd || 0);
  const share = Number(row.autoSaleWorkerShareUsd || 0);
  const status = String(row.autoSaleStatus || "");
  if (status === "released") {
    return {
      id: `autosale-released:${sourceId}`,
      type: "autosale",
      severity: "info",
      title: "Холд снят",
      message: `Лог #${sourceId}: $${share.toFixed(2)} доступны к выводу${
        gross > 0 ? ` (продажа $${gross.toFixed(2)})` : ""
      }.`,
      linkType: "view",
      linkView: "wallet",
      linkUrl: "",
      createdAt: row.autoSaleReleasedAt || row.updatedAt || row.createdAt || null,
    };
  }
  if (status === "arbitration") {
    const holdBits = [];
    if (gross > 0) holdBits.push(`$${gross.toFixed(2)} на холде`);
    if (row.autoSaleHoldRemainingPhrase) {
      holdBits.push(`осталось ${row.autoSaleHoldRemainingPhrase}`);
    }
    return {
      id: `autosale-hold:${sourceId}`,
      type: "autosale",
      severity: "warn",
      title: "Арбитраж по продаже",
      message: `По логу #${sourceId} открыт арбитраж. ${
        holdBits.join(" · ") || "Средства заморожены"
      }.`,
      linkType: row.lztMarketUrl ? "url" : "view",
      linkView: row.lztMarketUrl ? "" : "wallet",
      linkUrl: row.lztMarketUrl || "",
      createdAt: row.autoSaleSoldAt || row.updatedAt || row.createdAt || null,
    };
  }
  return {
    id: `autosale-hold:${sourceId}`,
    type: "autosale",
    severity: "info",
    title: "Лог продан",
    message: autoSaleHoldSoldNote(row.autoSaleHoldDurationPhrase),
    linkType: row.lztMarketUrl ? "url" : "view",
    linkView: row.lztMarketUrl ? "" : "wallet",
    linkUrl: row.lztMarketUrl || "",
    createdAt: row.autoSaleSoldAt || row.updatedAt || row.createdAt || null,
  };
}

async function listAutoSaleAlertsForUser(user) {
  const telegramId = String(user?.telegramId || "").trim();
  if (!telegramId) return [];
  const rows = await SteamLog.find({
    ownerTelegramId: telegramId,
    autoSaleStatus: { $in: ["sold_held", "arbitration", "released"] },
    autoSaleSoldAt: { $ne: null },
  })
    .sort({ autoSaleSoldAt: -1 })
    .limit(40)
    .select(
      "sourceId autoSaleStatus autoSaleGrossUsd autoSaleWorkerShareUsd autoSaleSoldAt autoSaleReleasedAt autoSaleHoldRemainingPhrase autoSaleHoldDurationPhrase lztMarketUrl updatedAt createdAt"
    )
    .lean();
  return rows.map(autoSaleAlert);
}

function isNewWorker(user) {
  const created = user?.createdAt ? new Date(user.createdAt).getTime() : 0;
  if (!Number.isFinite(created) || created <= 0) return true;
  return Date.now() - created < NEW_USER_MS;
}

async function bootstrapAlertsIfNeeded(user, alerts) {
  if (user.panelAlertsBootstrapped) return user;
  user.panelAlertsBootstrapped = true;
  if (isNewWorker(user) && alerts.length) {
    const hidden = capIds([...(user.panelHiddenAlertIds || []), ...alerts.map((a) => a.id)]);
    user.panelHiddenAlertIds = hidden;
  }
  await user.save();
  return user;
}

function serializeAlertsForUser(user, alerts) {
  const hidden = new Set((user.panelHiddenAlertIds || []).map(String));
  const read = new Set((user.panelReadAlertIds || []).map(String));
  return (alerts || [])
    .filter((item) => !hidden.has(String(item.id)))
    .map((item) => ({
      ...item,
      read: read.has(String(item.id)),
    }));
}

async function getWorkerAlerts(user) {
  const payload = await listDomains(user, { light: true });
  const domainAlerts = buildAlertsFromDomains(payload?.domains || []);
  const panelRows = await listActivePanelNotifications(50);
  const panelAlerts = panelRows.map(panelNotificationToAlert);
  const payoutRows = await WithdrawalRequest.find({
    telegramId: String(user.telegramId),
    status: "approved",
  })
    .sort({ updatedAt: -1 })
    .limit(20)
    .lean();
  const payoutAlerts = payoutRows.map(payoutAlert);
  const autoSaleAlerts = await listAutoSaleAlertsForUser(user);
  const alerts = sortAlertsNewestFirst([
    ...payoutAlerts,
    ...autoSaleAlerts,
    ...panelAlerts,
    ...domainAlerts,
  ]);

  await bootstrapAlertsIfNeeded(user, alerts);
  return serializeAlertsForUser(user, alerts);
}

async function markWorkerAlertsRead(user, ids) {
  const incoming = capIds(ids);
  if (!incoming.length) return user;
  user.panelReadAlertIds = capIds([...(user.panelReadAlertIds || []), ...incoming]);
  await user.save();
  return user;
}

module.exports = {
  getWorkerAlerts,
  markWorkerAlertsRead,
  buildAlertsFromDomains,
  payoutAlert,
  sortAlertsNewestFirst,
};
