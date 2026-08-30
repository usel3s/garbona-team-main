const {
  getPanelToken,
  filterAvailableDomains,
} = require("../handlers/sitesHandler");
const {
  getDomains,
  getAllTeamDomains,
  getAllDomainsForToken,
  checkDomainAvailability,
  getActualIPs,
  getCloudflareNameservers,
  createDomain,
  deleteDomain,
  deleteLegacyTeamDomain,
  getAllSteamLinks,
  getSteamLinkHistory,
  filterActiveSteamLinks,
  findTemplateById,
  createTemplate,
  deleteTemplate,
  createSteamLink,
  updateSteamLink,
  deleteSteamLink,
  getAllTeamWorkers,
  formatPanelError,
  normalizeWindowType,
  authCredentials,
} = require("./apiService");
const {
  clearTeamReferralForDomain,
  clearTeamReferralsByDomain,
  listTeamReferralsFromDb,
  getUserByTelegramId,
  getTeamReferralForDomain,
} = require("./userService");
const {
  getVisibleTemplates,
  addVisibleTemplate,
  removeVisibleTemplate,
  renameVisibleTemplate,
  normalizeTemplateId,
  parseTemplatePublicFlag,
  canAccessTemplate,
} = require("./settingsService");
const { buildTemplatesFromToken, mergeAdminCatalogTemplates, mergeEnabledTemplates } = require("./templateCatalogService");
const {
  generateTemplatePreview,
  localPreviewUrl,
  publicPreviewApiUrl,
  ensureLocalPreview,
  hasLocalPreview,
} = require("./templatePreviewService");
const { logger } = require("../utils/logger");
const {
  loadDomainClaimsMap,
  getDomainClaim,
  deleteDomainClaim,
  applyWorkerDomainClaims,
  applyAdminDomainClaims,
  isForeignDomainClaim,
} = require("./domainClaimService");
const { mergeDeviceCounts } = require("../utils/referral");
const { mergeCountryCounts, countryDisplayName } = require("../utils/countryStats");
const { getSteamAccounts, getSteamAccountById } = require("./steamApiService");
const {
  parseSourcePageParts,
  buildDomainLookup,
  unwrapSteamAccount,
  steamAccountRows,
  sourcePageMapFromAccounts,
  missingSourcePageIds,
} = require("../utils/steamSourcePage");

async function fetchCatalogTemplates(user) {
  const load = async ({ token }) => buildTemplatesFromToken(token, { syncVisibility: false });
  if (user?.panelUsername && user?.panelPassword) {
    try {
      return await withWorkerPanel(user, load);
    } catch (error) {
      logger.warn("fetchCatalogTemplates worker panel failed", {
        telegramId: user?.telegramId,
        error: error.message,
      });
    }
  }
  return withAdminPanel(user, load);
}

async function fetchCatalogTemplatesForAdmin(adminUser) {
  if (adminUser?.panelUsername && adminUser?.panelPassword) {
    try {
      return await fetchCatalogTemplates(adminUser);
    } catch (error) {
      logger.warn("fetchCatalogTemplatesForAdmin linked user failed", { error: error.message });
    }
  }
  try {
    const User = require("../models/User");
    const panelUser = await User.findOne({
      panelUsername: { $exists: true, $ne: "" },
      panelPassword: { $exists: true, $ne: "" },
    }).lean();
    if (panelUser) return await fetchCatalogTemplates(panelUser);
  } catch (error) {
    logger.warn("fetchCatalogTemplatesForAdmin service user failed", { error: error.message });
  }
  if (adminUser?.panelUsername && adminUser?.panelPassword) {
    return fetchCatalogTemplates(adminUser);
  }
  return withAdminPanel(adminUser, async ({ token }) => buildTemplatesFromToken(token, { syncVisibility: false }));
}

function pickActualIp(ips) {
  if (Array.isArray(ips)) return ips[0] || "";
  if (typeof ips === "string") return ips;
  return ips?.ip || ips?.[0] || "";
}

function normalizeNameservers(raw) {
  const result = [];
  const seen = new Set();
  const add = (value) => {
    const host = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(host)) return;
    if (seen.has(host)) return;
    seen.add(host);
    result.push(host);
  };
  const visit = (value, depth = 0) => {
    if (value == null || depth > 4) return;
    if (typeof value === "string") {
      value.split(/[\s,;]+/).forEach(add);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, depth + 1));
      return;
    }
    if (typeof value !== "object") return;
    for (const key of ["ns", "nameservers", "nameServers", "ns1", "ns2", "NS1", "NS2", "data", "cloudflare"]) {
      if (Object.prototype.hasOwnProperty.call(value, key)) visit(value[key], depth + 1);
    }
  };
  visit(raw);
  return result;
}

function parseCloudflareContext(raw) {
  const ns = normalizeNameservers(raw);
  const findId = (value, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 4) return null;
    const direct = Number(value.id ?? value.cloudflareId ?? value.cloudflare_id);
    if (Number.isFinite(direct) && direct > 0) return direct;
    for (const key of ["data", "cloudflare", "account", "rows"]) {
      const nested = value[key];
      if (Array.isArray(nested)) {
        for (const row of nested) {
          const id = findId(row, depth + 1);
          if (id) return id;
        }
      } else {
        const id = findId(nested, depth + 1);
        if (id) return id;
      }
    }
    return null;
  };
  const id = findId(raw);
  return {
    id,
    ns,
  };
}

async function loadCloudflareContext(token) {
  const raw = await getCloudflareNameservers(token).catch(() => null);
  return parseCloudflareContext(raw);
}

async function getDomainBindInfo(adminUser) {
  return withAdminPanel(adminUser, async ({ token }) => {
    const [ips, cloudflare] = await Promise.all([
      getActualIPs(token),
      loadCloudflareContext(token),
    ]);
    return {
      ip: pickActualIp(ips) || "",
      ns: cloudflare.ns,
      cloudflareAvailable: Boolean(cloudflare.id && cloudflare.ns.length >= 2),
    };
  });
}

function sumStatCounts(stats = []) {
  const out = {};
  for (const row of Array.isArray(stats) ? stats : []) {
    const action = row?.action || "Unknown";
    out[action] = (out[action] || 0) + (Number(row?.count) || 0);
  }
  return out;
}

/** UProject: desktopCount на PageVisit → «Процент юзеров с ПК». */
function sumDesktopShare(stats = []) {
  let visits = 0;
  let desktop = 0;
  const rows = Array.isArray(stats) ? stats : [];
  for (const row of rows) {
    if (String(row?.action || "") !== "PageVisit") continue;
    const count = Number(row?.count) || 0;
    if (count <= 0) continue;
    visits += count;
    desktop += Math.max(0, Number(row?.desktopCount) || 0);
  }
  if (visits <= 0) {
    for (const row of rows) {
      if (row?.desktopCount == null) continue;
      const count = Number(row?.count) || 0;
      if (count <= 0) continue;
      visits += count;
      desktop += Math.max(0, Number(row.desktopCount) || 0);
    }
  }
  const percent = visits > 0 ? Number(((desktop / visits) * 100).toFixed(2)) : null;
  return { desktopCount: desktop, visitCount: visits, desktopPercent: percent };
}

function ratePercent(value, total) {
  const denominator = Number(total) || 0;
  if (denominator <= 0) return null;
  return Number((((Number(value) || 0) / denominator) * 100).toFixed(2));
}

function serializeCountMap(map, limit = 12) {
  return Object.entries(map || {})
    .map(([name, count]) => ({ name, count: Number(count) || 0 }))
    .filter((row) => row.name && row.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function serializeCountryRows(map, limit = 16) {
  return Object.entries(map || {})
    .map(([code, count]) => ({
      code: String(code || "").trim().toUpperCase(),
      name: countryDisplayName(code),
      count: Number(count) || 0,
    }))
    .filter((row) => row.code && row.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Воронка UProject: PageVisit → AuthVisit → Log → MaFile.
 * Раньше clicks и auths оба брались из AuthVisit, из‑за этого конверсия всегда ~100%.
 * UP иногда перестаёт слать Log/MaFile — тогда listDomains подмешивает SteamLog.
 */
function serializeDomainStats(stats) {
  const counts = sumStatCounts(stats);
  const views = counts.PageVisit || 0;
  const auths = counts.AuthVisit || 0;
  const logs = counts.Log || counts.ValidLog || 0;
  const mafiles = counts.MaFile || counts.Maf || 0;
  const desktop = sumDesktopShare(stats);
  return {
    views,
    // clicks = AuthVisit (2-й шаг воронки UP); отдельного Click в API нет.
    clicks: auths,
    auths,
    logs,
    mafiles,
    trades: counts.Trade || 0,
    desktopCount: desktop.desktopCount,
    desktopPercent: desktop.desktopPercent,
    // Основная конверсия как на UP: авторизации / переходы.
    conversionRate: ratePercent(auths, views),
    authToLogRate: ratePercent(logs, auths),
    earnedUsd: 0,
  };
}

/** Lifetime valid / mafile counts from local SteamLog (ownerTelegramId). */
async function countWorkerSteamFunnel(telegramId) {
  const ownerId = String(telegramId || "").trim();
  if (!ownerId) return { logs: 0, mafiles: 0 };
  const SteamLog = require("../models/SteamLog");
  const [logs, mafiles] = await Promise.all([
    SteamLog.countDocuments({ ownerTelegramId: ownerId, logKind: "valid" }),
    SteamLog.countDocuments({ ownerTelegramId: ownerId, logKind: "mafile" }),
  ]);
  return { logs, mafiles };
}

/** Split integer total across weights; last bucket gets the remainder. */
function distributeByWeight(weights, total) {
  const n = Array.isArray(weights) ? weights.length : 0;
  if (n === 0 || total <= 0) return Array.from({ length: n }, () => 0);
  const safe = weights.map((w) => Math.max(0, Number(w) || 0));
  const sum = safe.reduce((a, b) => a + b, 0);
  const out = new Array(n).fill(0);
  let left = total;
  for (let i = 0; i < n; i += 1) {
    if (i === n - 1) {
      out[i] = left;
      break;
    }
    const share = sum > 0 ? safe[i] / sum : 1 / n;
    const value = Math.floor(total * share);
    out[i] = value;
    left -= value;
  }
  return out;
}

/**
 * When UProject no longer reports Log/MaFile, fill funnel from SteamLog.
 * SteamLogs are not per-link — distribute by AuthVisit (then views) weight.
 */
function applySteamFunnelToDomains(domains, steam) {
  const list = Array.isArray(domains) ? domains : [];
  const upLogs = list.reduce((sum, row) => sum + Number(row?.stats?.logs || 0), 0);
  const upMafiles = list.reduce((sum, row) => sum + Number(row?.stats?.mafiles || 0), 0);
  const steamLogs = Number(steam?.logs || 0);
  const steamMafiles = Number(steam?.mafiles || 0);
  const useLogs = upLogs <= 0 && steamLogs > 0;
  const useMafiles = upMafiles <= 0 && steamMafiles > 0;
  if (!useLogs && !useMafiles) {
    return { domains: list, totalLogs: upLogs, totalMafiles: upMafiles };
  }

  const linkTargets = [];
  for (const domain of list) {
    for (const link of domain.links || []) {
      if (!link || typeof link !== "object") continue;
      const stats = link.stats && typeof link.stats === "object" ? link.stats : null;
      if (!stats) continue;
      linkTargets.push({
        domain,
        link,
        weight: Number(stats.auths || stats.views || 0),
      });
    }
  }

  if (linkTargets.length) {
    const logParts = useLogs ? distributeByWeight(linkTargets.map((t) => t.weight), steamLogs) : null;
    const mafileParts = useMafiles
      ? distributeByWeight(linkTargets.map((t) => t.weight), steamMafiles)
      : null;
    linkTargets.forEach((target, index) => {
      const stats = { ...target.link.stats };
      if (logParts) {
        stats.logs = logParts[index];
        stats.authToLogRate = ratePercent(stats.logs, stats.auths);
      }
      if (mafileParts) stats.mafiles = mafileParts[index];
      target.link.stats = stats;
    });
    for (const domain of list) {
      const links = Array.isArray(domain.links) ? domain.links : [];
      if (!links.length) continue;
      const logs = links.reduce((sum, link) => sum + Number(link?.stats?.logs || 0), 0);
      const mafiles = links.reduce((sum, link) => sum + Number(link?.stats?.mafiles || 0), 0);
      domain.stats = {
        ...(domain.stats || serializeDomainStats([])),
        logs: useLogs ? logs : Number(domain.stats?.logs || 0),
        mafiles: useMafiles ? mafiles : Number(domain.stats?.mafiles || 0),
        authToLogRate: ratePercent(
          useLogs ? logs : Number(domain.stats?.logs || 0),
          Number(domain.stats?.auths || 0)
        ),
      };
    }
  } else {
    const weights = list.map((row) => Number(row?.stats?.auths || row?.stats?.views || 0));
    const logParts = useLogs ? distributeByWeight(weights, steamLogs) : null;
    const mafileParts = useMafiles ? distributeByWeight(weights, steamMafiles) : null;
    list.forEach((domain, index) => {
      const stats = { ...(domain.stats || serializeDomainStats([])) };
      if (logParts) {
        stats.logs = logParts[index];
        stats.authToLogRate = ratePercent(stats.logs, stats.auths);
      }
      if (mafileParts) stats.mafiles = mafileParts[index];
      domain.stats = stats;
    });
  }

  return {
    domains: list,
    totalLogs: useLogs ? steamLogs : upLogs,
    totalMafiles: useMafiles ? steamMafiles : upMafiles,
  };
}

function roundUsd(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function emptyDomainEarnings() {
  return { totalUsd: 0, byHost: new Map(), byHostPath: new Map() };
}

function normalizeLinkPath(link) {
  const rawPath = String(link?.path || "").trim();
  if (rawPath && !/^https?:\/\//i.test(rawPath)) {
    return rawPath.replace(/^\/+|\/+$/g, "").toLowerCase();
  }
  return parseSourcePageParts(String(link?.url || "")).path;
}

const EARNINGS_ACCOUNT_LIST_PAGES = 20;
const EARNINGS_ACCOUNT_BY_ID_MAX = 80;
const EARNINGS_ACCOUNT_BY_ID_CONCURRENCY = 8;
const EARNINGS_ACCOUNT_DIRECT_ID_THRESHOLD = 10;

function collectSourcePagesFromLogs(logs = []) {
  const pageBySourceId = new Map();
  const pageByTxId = new Map();
  const sourceIds = [];
  for (const log of logs) {
    const id = String(log?.sourceId || "").trim();
    if (id) sourceIds.push(id);
    const page = String(log?.sourcePage || "").trim();
    if (!page) continue;
    if (id) pageBySourceId.set(id, page);
    if (log.autoSaleProfitTxId) pageByTxId.set(String(log.autoSaleProfitTxId), page);
    if (log.mafileProfitTransactionId) pageByTxId.set(String(log.mafileProfitTransactionId), page);
  }
  return { pageBySourceId, pageByTxId, sourceIds };
}

function attachResolvedPagesToTxIds(logs, pageBySourceId, pageByTxId) {
  for (const log of logs || []) {
    const page =
      pageBySourceId.get(String(log?.sourceId || "").trim()) || String(log?.sourcePage || "").trim();
    if (!page) continue;
    if (log.autoSaleProfitTxId) pageByTxId.set(String(log.autoSaleProfitTxId), page);
    if (log.mafileProfitTransactionId) pageByTxId.set(String(log.mafileProfitTransactionId), page);
  }
  return pageByTxId;
}

function accumulateDomainEarnings(rows, pageBySourceId, pageByTxId) {
  const byHost = new Map();
  const byHostPath = new Map();
  let totalUsd = 0;
  for (const row of rows || []) {
    const share = roundUsd(row?.workerShare);
    if (share <= 0) continue;
    const txId = String(row._id || "");
    const page =
      pageByTxId.get(txId) || pageBySourceId.get(String(row.sourceId || "").trim()) || "";
    const parts = parseSourcePageParts(page);
    if (!parts.host) continue;
    totalUsd = roundUsd(totalUsd + share);
    byHost.set(parts.host, roundUsd((byHost.get(parts.host) || 0) + share));
    const key = `${parts.host}\0${parts.path}`;
    byHostPath.set(key, roundUsd((byHostPath.get(key) || 0) + share));
  }
  return { totalUsd, byHost, byHostPath };
}

async function loadEarningsDomainContext(user) {
  let token = null;
  let domainById = new Map();
  if (user?.telegramId || (user?.panelUsername && user?.panelPassword)) {
    try {
      const auth = await getPanelToken(user);
      token = auth?.token || null;
      if (token) {
        domainById = buildDomainLookup(await getAllDomainsForToken(token).catch(() => []));
      }
    } catch (error) {
      logger.warn("domain earnings panel token failed", {
        telegramId: user?.telegramId,
        error: error.message,
      });
    }
  }
  if (!domainById.size) {
    try {
      domainById = buildDomainLookup(await getAllTeamDomains());
    } catch (error) {
      logger.warn("domain earnings team domains failed", error.message);
    }
  }
  return { token, domainById };
}

async function listWorkerUprojectAccounts(token) {
  const accounts = [];
  if (!token) return accounts;
  const seen = new Set();
  const pushRows = (payload) => {
    for (const row of steamAccountRows(payload)) {
      const account = unwrapSteamAccount(row);
      const id = String(account?.id || "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      accounts.push(account);
    }
  };
  try {
    for (let page = 0; page < EARNINGS_ACCOUNT_LIST_PAGES; page += 1) {
      const payload = await getSteamAccounts(token, {
        offset: page * 100,
        page,
        limit: 100,
      });
      const rows = steamAccountRows(payload);
      if (!rows.length) break;
      pushRows(payload);
      if (rows.length < 100) break;
    }
  } catch (error) {
    logger.warn("domain earnings account list failed", error.message);
  }
  try {
    pushRows(
      await getSteamAccounts(token, {
        offset: 0,
        limit: 100,
        statuses: ["Invalid"],
        skipCache: true,
      })
    );
  } catch (_) {
    /* default list already includes most rows */
  }
  return accounts;
}

async function fetchUprojectAccountsByIds(ids, token) {
  const unique = missingSourcePageIds(ids, new Map());
  const found = new Map();
  if (!unique.length) return found;
  const concurrency = EARNINGS_ACCOUNT_BY_ID_CONCURRENCY;
  for (let index = 0; index < unique.length; index += concurrency) {
    const chunk = unique.slice(index, index + concurrency);
    const rows = await Promise.all(
      chunk.map(async (id) => {
        try {
          return unwrapSteamAccount(await getSteamAccountById(token, id));
        } catch (_) {
          return null;
        }
      })
    );
    for (const account of rows) {
      const id = String(account?.id || "").trim();
      if (id) found.set(id, account);
    }
  }
  return found;
}

async function resolveUprojectSourcePages(sourceIds, user) {
  const pages = new Map();
  const missing = missingSourcePageIds(sourceIds, pages);
  if (!missing.length) return pages;

  const { token, domainById } = await loadEarningsDomainContext(user);
  let accounts = [];
  if (missing.length > EARNINGS_ACCOUNT_DIRECT_ID_THRESHOLD) {
    accounts = await listWorkerUprojectAccounts(token);
  }
  let fromList = sourcePageMapFromAccounts(accounts, domainById);
  for (const [id, page] of fromList) {
    if (missing.includes(id)) pages.set(id, page);
  }

  const leftover = missingSourcePageIds(missing, pages).slice(0, EARNINGS_ACCOUNT_BY_ID_MAX);
  if (leftover.length) {
    const byId = await fetchUprojectAccountsByIds(leftover, token);
    fromList = sourcePageMapFromAccounts([...byId.values()], domainById);
    for (const [id, page] of fromList) pages.set(id, page);
  }
  return pages;
}

async function backfillSteamLogSourcePages(pageBySourceId) {
  const SteamLog = require("../models/SteamLog");
  const ops = [];
  for (const [sourceId, page] of pageBySourceId || []) {
    const next = String(page || "").trim();
    if (!/^\d+$/.test(sourceId) || !next) continue;
    ops.push({
      updateOne: {
        filter: { sourceId },
        update: { $set: { sourcePage: next } },
      },
    });
  }
  if (!ops.length) return;
  SteamLog.bulkWrite(ops, { ordered: false }).catch((error) => {
    logger.warn("domain earnings sourcePage backfill failed", error.message);
  });
}

/**
 * Attribute worker profit (workerShare) to domains/links via SteamLog.sourcePage
 * and UProject account domain/path. Exact host+path hits the link; leftover host
 * profit is split by funnel weight.
 */
function applyDomainEarningsToDomains(domains, earnings) {
  const list = Array.isArray(domains) ? domains : [];
  const byHost = earnings?.byHost instanceof Map ? earnings.byHost : new Map();
  const byHostPath = earnings?.byHostPath instanceof Map ? earnings.byHostPath : new Map();

  for (const domain of list) {
    const host = parseSourcePageParts(domain?.domain || "").host;
    const hostTotal = host ? roundUsd(byHost.get(host) || 0) : 0;
    const links = Array.isArray(domain.links) ? domain.links.filter((link) => link && typeof link === "object") : [];
    let assignedCents = 0;

    for (const link of links) {
      const path = normalizeLinkPath(link);
      const earned = host ? roundUsd(byHostPath.get(`${host}\0${path}`) || 0) : 0;
      link.stats = { ...(link.stats || {}), earnedUsd: earned };
      assignedCents += Math.round(earned * 100);
    }

    const remainderCents = Math.max(0, Math.round(hostTotal * 100) - assignedCents);
    if (remainderCents > 0 && links.length) {
      const weights = links.map(
        (link) =>
          Number(link.stats?.logs || 0) || Number(link.stats?.auths || 0) || Number(link.stats?.views || 0)
      );
      const parts = distributeByWeight(weights, remainderCents);
      links.forEach((link, index) => {
        link.stats.earnedUsd = roundUsd(Number(link.stats.earnedUsd || 0) + parts[index] / 100);
      });
    }

    domain.stats = { ...(domain.stats || serializeDomainStats([])), earnedUsd: hostTotal };
  }

  return list;
}

async function getWorkerDomainEarnings(userOrTelegramId) {
  const empty = emptyDomainEarnings();
  const user =
    userOrTelegramId && typeof userOrTelegramId === "object"
      ? userOrTelegramId
      : await getUserByTelegramId(userOrTelegramId);
  if (!user?._id) return empty;

  const { profitStatsFilter, enrichProfitsWithSourceId } = require("./profitService");
  const ProfitTransaction = require("../models/ProfitTransaction");
  const SteamLog = require("../models/SteamLog");

  const rows = await ProfitTransaction.find(profitStatsFilter({ userId: user._id }))
    .select("workerShare note")
    .lean();
  if (!rows.length) return empty;

  const enriched = await enrichProfitsWithSourceId(rows);
  const profitSourceIds = [
    ...new Set(enriched.map((row) => String(row.sourceId || "").trim()).filter(Boolean)),
  ];
  const txIds = enriched.map((row) => String(row._id || "")).filter(Boolean);

  let logs = [];
  const logQuery = [];
  if (profitSourceIds.length) logQuery.push({ sourceId: { $in: profitSourceIds } });
  if (txIds.length) {
    logQuery.push({ autoSaleProfitTxId: { $in: txIds } });
    logQuery.push({ mafileProfitTransactionId: { $in: txIds } });
  }
  if (logQuery.length) {
    logs = await SteamLog.find({ $or: logQuery })
      .select("sourceId sourcePage autoSaleProfitTxId mafileProfitTransactionId")
      .lean();
  }

  const collected = collectSourcePagesFromLogs(logs);
  const pageBySourceId = collected.pageBySourceId;
  const pageByTxId = collected.pageByTxId;
  const sourceIds = [...new Set([...profitSourceIds, ...collected.sourceIds])];
  const missing = missingSourcePageIds(sourceIds, pageBySourceId);
  if (missing.length) {
    const uprojectPages = await resolveUprojectSourcePages(missing, user);
    for (const [id, page] of uprojectPages) {
      if (!pageBySourceId.get(id)) pageBySourceId.set(id, page);
    }
    if (uprojectPages.size) backfillSteamLogSourcePages(uprojectPages);
  }
  attachResolvedPagesToTxIds(logs, pageBySourceId, pageByTxId);
  return accumulateDomainEarnings(enriched, pageBySourceId, pageByTxId);
}

function aggregateLinkStats(links = []) {
  const merged = [];
  for (const link of links) {
    if (Array.isArray(link?.stats)) merged.push(...link.stats);
  }
  return serializeDomainStats(merged);
}

function aggregateLinkBreakdown(links = []) {
  const merged = [];
  for (const link of links) {
    if (Array.isArray(link?.stats)) merged.push(...link.stats);
    else if (link && typeof link === "object") merged.push(link);
  }
  return {
    devices: serializeCountMap(mergeDeviceCounts(merged)),
    countries: serializeCountryRows(mergeCountryCounts(merged)),
  };
}

function isDomainPaused(domain) {
  return String(domain?.status || "").toLowerCase() === "pause";
}

function extractOwnerIdFromToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString("utf8"));
    const id = Number(payload?.id);
    return Number.isFinite(id) ? id : null;
  } catch (_) {
    return null;
  }
}

function serializeBanCheck(value) {
  const raw = String(value || "NoInfo");
  return {
    raw,
    banned: raw === "Banned",
    clean: raw === "NotBanned",
  };
}

function serializeBanData(banData) {
  if (!banData || typeof banData !== "object") return null;
  let updatedAt = null;
  const ts = Number(banData.updatedAt);
  if (Number.isFinite(ts) && ts > 0) {
    const date = new Date(ts > 1e12 ? ts : ts * 1000);
    if (!Number.isNaN(date.getTime())) updatedAt = date.toISOString();
  }
  return {
    updatedAt,
    whois: serializeBanCheck(banData.bannedAtWhois),
    cloudflare: serializeBanCheck(banData.bannedAtCloudFlare),
    google: serializeBanCheck(banData.bannedAtChrome),
    yandex: serializeBanCheck(banData.bannedAtYandex),
    steam: serializeBanCheck(banData.bannedAtSteam),
  };
}

function serializeDomain(domain, ownerId = null) {
  if (!domain || typeof domain !== "object") {
    return {
      id: null,
      domain: "",
      online: 0,
      owner: null,
      isOwn: false,
      isTeamPublic: false,
      ip: "",
      service: "Steam",
      status: "",
      isPaused: false,
      createdAt: null,
      linksCount: 0,
      stats: serializeDomainStats([]),
      devices: [],
      countries: [],
      ns: [],
      bindType: "ip",
      bindNs: [],
      banChecks: null,
    };
  }
  const own =
    ownerId != null && Number.isFinite(Number(ownerId))
      ? Number(domain.owner) === Number(ownerId)
      : Boolean(domain.isOwner);
  const status = String(domain.status || "");
  const rawStats = Array.isArray(domain?.stats) ? domain.stats : [];
  return {
    id: domain.id,
    domain: domain.domain || "",
    online: Number(domain.online || 0),
    owner: domain.owner ?? null,
    isOwn: own,
    isTeamPublic: domain.isTeamPublic === true || domain.isPublic === true,
    ip: domain.ip || "",
    service: domain.service || "Steam",
    status,
    isPaused: status.toLowerCase() === "pause",
    createdAt: domain.createdAt || null,
    linksCount: Number(domain.linksCount || 0),
    stats: serializeDomainStats(rawStats),
    devices: serializeCountMap(mergeDeviceCounts(rawStats)),
    countries: serializeCountryRows(mergeCountryCounts(rawStats, domain)),
    ns: domain.ns || [],
    bindType: Array.isArray(domain.ns) && domain.ns.length ? "cloudflare" : "ip",
    bindNs: Array.isArray(domain.ns) ? domain.ns : [],
    banChecks: serializeBanData(domain.banData),
  };
}

function serializeLink(link, domainPaused = false) {
  if (!link || typeof link !== "object") return null;
  const template = link.template;
  const templateId =
    template && typeof template === "object"
      ? template.id
      : link.templateId ?? template ?? null;
  const templateName =
    (template && typeof template === "object" && template.name) ||
    link.templateName ||
    "";
  const steam = link.steam && typeof link.steam === "object" ? link.steam : {};
  const linkStatus = String(link.status || "").toLowerCase();
  const rawStats = Array.isArray(link?.stats) ? link.stats : [];
  return {
    id: link.id,
    path: link.path || "",
    url: link.url || link.link || "",
    windowType: link.windowType || "",
    template: templateId,
    templateName,
    owner: link.owner ?? null,
    online: Number(link.online || 0),
    stats: serializeDomainStats(rawStats),
    iframe: Boolean(link.iframe),
    cloaking: Boolean(link.cloaking),
    ban_vpn: Boolean(link.ban_vpn),
    randPath: Boolean(link.randPath),
    isPaused: domainPaused || linkStatus === "pause",
    devices: serializeCountMap(mergeDeviceCounts(rawStats)),
    countries: serializeCountryRows(mergeCountryCounts(rawStats, link)),
    steam: {
      logError: (steam.logError ?? link.logError) !== false,
      tradeError: (steam.tradeError ?? link.tradeError) !== false,
      mafileError: Boolean(steam.mafileError ?? link.mafileError),
      mafileSteamRedirect:
        (steam.mafileSteamRedirect ?? link.mafileSteamRedirect) !== false,
      logRedirect: String(steam.logRedirect ?? link.logRedirect ?? "").trim(),
      tradeRedirect: String(steam.tradeRedirect ?? link.tradeRedirect ?? "").trim(),
      mafileRedirect: String(steam.mafileRedirect ?? link.mafileRedirect ?? "").trim(),
    },
  };
}

function normalizeRedirectUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function steamActionPayload(options = {}) {
  const logError = options.logError !== false;
  const tradeError = options.tradeError !== false;
  const mafileError = Boolean(options.mafileError);
  const logRedirect = logError ? "" : normalizeRedirectUrl(options.logRedirect);
  const tradeRedirect = tradeError ? "" : normalizeRedirectUrl(options.tradeRedirect);
  const mafileRedirect = mafileError ? "" : normalizeRedirectUrl(options.mafileRedirect);
  const mafileSteamRedirect = mafileError
    ? false
    : options.mafileSteamRedirect != null
      ? Boolean(options.mafileSteamRedirect)
      : !mafileRedirect;
  return {
    logError,
    tradeError,
    mafileError,
    mafileSteamRedirect,
    logRedirect,
    tradeRedirect,
    mafileRedirect,
  };
}

async function withAdminPanel(adminUser, fn) {
  try {
    const auth = await getPanelToken(adminUser);
    return await fn(auth);
  } catch (error) {
    const err = new Error(formatPanelError(error) || error.message || "sites_error");
    err.status = error?.response?.status || 400;
    throw err;
  }
}

async function withWorkerPanel(user, fn) {
  if (!user?.panelUsername || !user?.panelPassword) {
    const err = new Error("У воркера нет аккаунта панели сайтов");
    err.status = 400;
    throw err;
  }
  try {
    const auth = await getPanelToken(user);
    return await fn({ token: auth.token, ownerId: auth.ownerId, user });
  } catch (error) {
    if (error.status) throw error;
    const err = new Error(formatPanelError(error) || error.message || "sites_error");
    err.status = error?.response?.status || 400;
    throw err;
  }
}

async function assertWorkerDomainAccess(user, domain, ownerId) {
  const claim = await getDomainClaim(domain?.id);
  if (claim) {
    if (isForeignDomainClaim(claim, user?.telegramId)) {
      const err = new Error("Домен недоступен");
      err.status = 404;
      throw err;
    }
    return claim;
  }
  if (!filterAvailableDomains([domain], ownerId).length) {
    const err = new Error("Домен недоступен");
    err.status = 404;
    throw err;
  }
}

/** Список доменов — team key + фильтр доступных воркеру.
 *  options.light — без подгрузки ссылок (для алертов)
 *  options.includeLinks — отдать сериализованные ссылки (для аналитики одним запросом)
 */
async function listDomains(user, options = {}) {
  const light = options.light === true;
  const includeLinks = options.includeLinks === true;
  try {
    let ownerId = null;
    let panelUsername = user?.panelUsername || "team";
    const byId = new Map();
    const addRows = (rows) => {
      for (const row of rows || []) {
        const id = Number(row?.id);
        if (!Number.isFinite(id) || id < 1) continue;
        const prev = byId.get(id);
        byId.set(id, prev ? { ...prev, ...row } : row);
      }
    };

    try {
      addRows((await getAllTeamDomains()).rows);
    } catch (_) {
      /* team dump может не включать приватные домены */
    }

    let workerToken = null;
    if (user?.panelUsername && user?.panelPassword) {
      try {
        const auth = await getPanelToken(user);
        ownerId = auth.ownerId;
        panelUsername = user.panelUsername;
        workerToken = auth.token;
        addRows(await getAllDomainsForToken(auth.token));
      } catch (_) {
        // fallback: публичные домены команды
      }
    }

    let rows = [...byId.values()];
    if (ownerId == null) {
      rows = rows.filter((row) => row?.isPublic === true || row?.isTeamPublic === true);
    } else {
      rows = filterAvailableDomains(rows, ownerId);
    }

    let domains = rows.map((d) => serializeDomain(d, ownerId));
    // Старые Cloudflare-домены создавались публичными через владельца команды.
    // Claim-оверлей нужен только для их безопасного показа прежнему владельцу.
    const claims = await loadDomainClaimsMap();
    domains = applyWorkerDomainClaims(domains, claims, user?.telegramId);

    if (!light && workerToken && ownerId != null) {
      try {
        domains = await Promise.all(
          domains.map(async (row) => {
            try {
              const linksPayload = await getAllSteamLinks(workerToken, row.id);
              const myLinks = filterActiveSteamLinks(linksPayload?.rows || []).filter(
                (link) => Number(link.owner) === Number(ownerId)
              );
              const domainPaused = Boolean(row.isPaused);
              const serializedLinks = myLinks
                .map((link) => serializeLink(link, domainPaused))
                .filter(Boolean);
              return {
                ...row,
                linksCount: myLinks.length,
                stats: aggregateLinkStats(myLinks),
                online: myLinks.reduce((sum, link) => sum + Number(link.online || 0), 0),
                ...aggregateLinkBreakdown(myLinks),
                ...(includeLinks ? { links: serializedLinks } : {}),
              };
            } catch (error) {
              return {
                ...row,
                linksCount: 0,
                stats: serializeDomainStats([]),
                online: 0,
                linksError: formatPanelError(error) || error.message || "links_error",
                ...(includeLinks ? { links: [] } : {}),
              };
            }
          })
        );
      } catch (_) {
        // список без персональной статистики
      }
    }

    const steamFunnel = light
      ? { logs: 0, mafiles: 0 }
      : await countWorkerSteamFunnel(user?.telegramId).catch(() => ({ logs: 0, mafiles: 0 }));
    const enriched = light
      ? {
          domains,
          totalLogs: domains.reduce((sum, row) => sum + Number(row.stats?.logs || 0), 0),
          totalMafiles: domains.reduce((sum, row) => sum + Number(row.stats?.mafiles || 0), 0),
        }
      : applySteamFunnelToDomains(domains, steamFunnel);

    if (!light) {
      try {
        const earnings = await getWorkerDomainEarnings(user);
        applyDomainEarningsToDomains(enriched.domains, earnings);
      } catch (error) {
        logger.warn("listDomains earnings failed", {
          telegramId: user?.telegramId,
          error: error.message,
        });
        applyDomainEarningsToDomains(enriched.domains, emptyDomainEarnings());
      }
    }

    return {
      ownerId,
      panelUsername,
      totalOnline: enriched.domains.reduce((sum, row) => sum + Number(row.online || 0), 0),
      ownCount: enriched.domains.filter((row) => row.isOwn).length,
      totalViews: enriched.domains.reduce((sum, row) => sum + Number(row.stats?.views || 0), 0),
      totalClicks: enriched.domains.reduce((sum, row) => sum + Number(row.stats?.clicks || 0), 0),
      totalAuths: enriched.domains.reduce((sum, row) => sum + Number(row.stats?.auths || 0), 0),
      totalLogs: enriched.totalLogs,
      totalMafiles: enriched.totalMafiles,
      steamFunnel,
      domains: enriched.domains,
      viaTeamKey: true,
    };
  } catch (error) {
    const err = new Error(formatPanelError(error) || error.message || "sites_error");
    err.status = error?.response?.status || 400;
    throw err;
  }
}

async function resolveDomainMap(contextUser = null) {
  const rows = await collectAllAccessibleDomains(contextUser);
  const map = new Map();
  for (const row of rows || []) {
    map.set(Number(row.id), row);
  }
  return map;
}

async function findDomainById(domainId, contextUser = null) {
  const id = Number(domainId);
  if (!Number.isFinite(id) || id < 1) return null;

  if (contextUser?.panelUsername && contextUser?.panelPassword) {
    try {
      const auth = await getPanelToken(contextUser);
      const rows = await getAllDomainsForToken(auth.token);
      const hit = rows.find((row) => Number(row.id) === id);
      if (hit) return hit;
    } catch {
      /* fallback to team aggregate below */
    }
  }

  const map = await resolveDomainMap(contextUser);
  return map.get(id) || null;
}

function normalizeDomainName(domainName) {
  return String(domainName || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

async function findTeamDomainByName(domainName) {
  const domain = normalizeDomainName(domainName);
  if (!domain) return null;
  const rows = await collectAllAccessibleDomains();
  return rows.find((row) => String(row?.domain || "").toLowerCase() === domain) || null;
}

async function collectAllAccessibleDomains(contextUser = null) {
  const byId = new Map();
  const addRows = (rows) => {
    for (const row of rows || []) {
      const id = Number(row?.id);
      if (!Number.isFinite(id) || id < 1) continue;
      const prev = byId.get(id);
      byId.set(id, prev ? { ...prev, ...row } : row);
    }
  };

  try {
    addRows((await getAllTeamDomains()).rows);
  } catch {
    /* team key может не отдавать чужие приватные домены */
  }

  const contextLogin = String(contextUser?.panelUsername || "").trim().toLowerCase();
  if (contextUser?.panelUsername && contextUser?.panelPassword) {
    try {
      const auth = await getPanelToken(contextUser);
      addRows(await getAllDomainsForToken(auth.token));
    } catch {
      /* аккаунт текущего пользователя может быть временно недоступен */
    }
  }

  const User = require("../models/User");
  const members = await User.find({
    panelUsername: { $exists: true, $ne: "" },
    panelPassword: { $exists: true, $ne: "" },
  })
    .select("panelUsername panelPassword")
    .lean({ getters: true });

  const seenLogins = new Set();
  if (contextLogin) seenLogins.add(contextLogin);
  const unique = [];
  for (const acc of members || []) {
    const login = String(acc.panelUsername || "").trim().toLowerCase();
    const password = String(acc.panelPassword || "");
    if (!login || !password || seenLogins.has(login)) continue;
    seenLogins.add(login);
    unique.push({ panelUsername: acc.panelUsername, panelPassword: password });
  }

  const queue = unique.slice();
  const workers = Math.min(5, queue.length);
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (queue.length) {
        const acc = queue.shift();
        if (!acc) return;
        try {
          const auth = await authCredentials(acc.panelUsername, acc.panelPassword);
          if (!auth?.token) continue;
          addRows(await getAllDomainsForToken(auth.token));
        } catch {
          /* аккаунт панели может быть невалидным */
        }
      }
    })
  );

  return [...byId.values()];
}

function ownerLabelFromMaps(domain, workerMap, memberMap) {
  const ownerId = Number(domain?.owner);
  const worker = Number.isFinite(ownerId) ? workerMap.get(ownerId) : null;
  const panelLogin = String(worker?.username || "").toLowerCase();
  const member = panelLogin ? memberMap.get(panelLogin) : null;
  if (member?.username) return `@${member.username}`;
  if (member?.telegramId) return String(member.telegramId);
  if (worker?.telegram) return String(worker.telegram);
  if (worker?.username) return String(worker.username);
  return Number.isFinite(ownerId) ? `#${ownerId}` : "—";
}

async function loadOwnerMaps(adminUser) {
  const User = require("../models/User");
  const [{ workers }, members] = await Promise.all([
    listWorkers(adminUser).catch(() => ({ workers: [] })),
    User.find({ panelUsername: { $exists: true, $ne: "" } })
      .select("telegramId username firstName panelUsername")
      .lean(),
  ]);
  const workerMap = new Map((workers || []).map((row) => [Number(row.id), row]));
  const memberMap = new Map(
    (members || []).map((row) => [String(row.panelUsername || "").toLowerCase(), row])
  );
  return { workerMap, memberMap };
}

async function attachDomainTraffic(token, domain, ownerId) {
  const serialized = serializeDomain(domain, ownerId);
  try {
    const linksPayload = await getAllSteamLinks(token, domain.id);
    const links = filterActiveSteamLinks(linksPayload?.rows || []);
    const serializedLinks = links
      .map((link) => serializeLink(link, serialized.isPaused))
      .filter(Boolean);
    return {
      ...serialized,
      linksCount: serializedLinks.length,
      stats: aggregateLinkStats(links),
      online: links.reduce((sum, link) => sum + Number(link.online || 0), 0),
      ...aggregateLinkBreakdown(links),
      links: serializedLinks,
    };
  } catch {
    return {
      ...serialized,
      linksCount: Number(serialized.linksCount || 0),
      stats: serialized.stats || serializeDomainStats([]),
      online: Number(serialized.online || 0),
      links: [],
    };
  }
}

async function listAdminDomains(adminUser, { includeLinks = false } = {}) {
  const rows = await collectAllAccessibleDomains(adminUser);
  const { workerMap, memberMap } = await loadOwnerMaps(adminUser);

  const decorate = (row, traffic, ownerId) => {
    const worker = workerMap.get(Number(row.owner));
    const panelLogin = String(worker?.username || "").toLowerCase();
    const member = panelLogin ? memberMap.get(panelLogin) : null;
    const base = traffic || serializeDomain(row, ownerId);
    const result = {
      ...base,
      ownerLabel: ownerLabelFromMaps(row, workerMap, memberMap),
      ownerTelegramId: String(member?.telegramId || worker?.telegram || ""),
      ownerPanelUsername: String(worker?.username || ""),
    };
    if (!includeLinks) delete result.links;
    return result;
  };

  let domains = [];
  try {
    domains = await withAdminPanel(adminUser, async ({ token, ownerId }) =>
      Promise.all(rows.map(async (row) => decorate(row, await attachDomainTraffic(token, row, ownerId), ownerId)))
    );
  } catch {
    domains = rows.map((row) => decorate(row, null, null));
  }

  const claims = await loadDomainClaimsMap();
  if (claims.size) {
    const telegramIds = [...new Set([...claims.values()].map((row) => String(row.ownerTelegramId || "")))].filter(Boolean);
    const User = require("../models/User");
    const owners = telegramIds.length
      ? await User.find({ telegramId: { $in: telegramIds } }).select("telegramId username").lean()
      : [];
    const userByTelegram = new Map(owners.map((row) => [String(row.telegramId), row]));
    domains = applyAdminDomainClaims(domains, claims, userByTelegram);
  }

  return {
    ownerId: null,
    panelUsername: "team",
    totalOnline: domains.reduce((sum, row) => sum + Number(row.online || 0), 0),
    ownCount: domains.filter((row) => row.isOwn).length,
    totalViews: domains.reduce((sum, row) => sum + Number(row.stats?.views || 0), 0),
    totalClicks: domains.reduce((sum, row) => sum + Number(row.stats?.clicks || 0), 0),
    totalAuths: domains.reduce((sum, row) => sum + Number(row.stats?.auths || 0), 0),
    totalLogs: domains.reduce((sum, row) => sum + Number(row.stats?.logs || 0), 0),
    totalMafiles: domains.reduce((sum, row) => sum + Number(row.stats?.mafiles || 0), 0),
    domains,
    viaTeamKey: true,
  };
}

async function listAdminSiteAnalytics(adminUser) {
  const data = await listAdminDomains(adminUser, { includeLinks: true });
  const rows = [];
  for (const domain of data.domains) {
    for (const link of domain.links || []) {
      rows.push({
        domainId: domain.id,
        domainName: domain.domain,
        ownerLabel: domain.ownerLabel,
        ownerTelegramId: domain.ownerTelegramId,
        link,
        url: link.url || `${domain.domain}/${String(link.path || "").replace(/^\/+/, "")}`,
      });
    }
  }
  return {
    summary: {
      domains: data.domains.length,
      links: rows.length,
      online: data.totalOnline,
      views: data.totalViews,
      clicks: data.totalClicks,
      auths: data.totalAuths,
      logs: data.totalLogs,
      mafiles: data.totalMafiles,
    },
    rows,
    domains: data.domains,
  };
}

async function getWorkerDomainDetail(user, domainId) {
  const domain = await findDomainById(domainId, user);
  if (!domain) {
    const err = new Error("Домен недоступен");
    err.status = 404;
    throw err;
  }

  if (!user?.panelUsername || !user?.panelPassword) {
    const err = new Error("У воркера нет аккаунта панели сайтов");
    err.status = 400;
    throw err;
  }

  const domainPaused = isDomainPaused(domain);

  return withWorkerPanel(user, async ({ token, ownerId }) => {
    await assertWorkerDomainAccess(user, domain, ownerId);

    const linksPayload = await getAllSteamLinks(token, domainId).catch((error) => {
      if (Number(error?.response?.status) === 404) return { rows: [] };
      throw error;
    });
    const myLinks = filterActiveSteamLinks(linksPayload?.rows || []).filter(
      (link) => Number(link.owner) === Number(ownerId)
    );
    const workerOnline = myLinks.reduce((sum, link) => sum + Number(link.online || 0), 0);
    const links = myLinks
      .map((link) => serializeLink(link, domainPaused))
      .filter(Boolean);

    const claim = await getDomainClaim(domainId);
    const claims = new Map();
    if (claim) claims.set(Number(domainId), claim);
    const [visualDomain] = applyWorkerDomainClaims(
      [serializeDomain(domain, ownerId)],
      claims,
      user?.telegramId
    );
    const domainRow = {
      ...(visualDomain || serializeDomain(domain, ownerId)),
      linksCount: links.length,
      stats: aggregateLinkStats(myLinks),
      online: workerOnline,
      ...aggregateLinkBreakdown(myLinks),
      links,
    };
    const steamFunnel = await countWorkerSteamFunnel(user?.telegramId).catch(() => ({
      logs: 0,
      mafiles: 0,
    }));
    const enriched = applySteamFunnelToDomains([domainRow], steamFunnel);
    try {
      const earnings = await getWorkerDomainEarnings(user);
      applyDomainEarningsToDomains(enriched.domains, earnings);
    } catch (error) {
      logger.warn("domain detail earnings failed", {
        telegramId: user?.telegramId,
        error: error.message,
      });
      applyDomainEarningsToDomains(enriched.domains, emptyDomainEarnings());
    }
    const nextDomain = enriched.domains[0] || domainRow;
    const nextLinks = Array.isArray(nextDomain.links) ? nextDomain.links : links;
    delete nextDomain.links;

    return {
      ownerId,
      steamFunnel,
      domain: nextDomain,
      links: nextLinks,
    };
  });
}

async function getDomainDetail(adminUser, domainId) {
  const domain = await findDomainById(domainId, adminUser);
  if (!domain) {
    const err = new Error("Домен недоступен");
    err.status = 404;
    throw err;
  }

  let ownerLinks = [];
  try {
    await withAdminPanel(adminUser, async ({ token }) => {
      const linksPayload = await getAllSteamLinks(token, domainId);
      ownerLinks = filterActiveSteamLinks(linksPayload?.rows || [])
        .map((link) => serializeLink(link, isDomainPaused(domain)))
        .filter(Boolean);
    });
  } catch (_) {
    // Админ без панели — только рефералки из Mongo.
  }

  const referrals = (await listTeamReferralsFromDb()).filter(
    (row) => Number(row.domainId) === Number(domainId)
  );

  let ownerId = null;
  try {
    await withAdminPanel(adminUser, async ({ ownerId: id }) => {
      ownerId = id;
    });
  } catch {
    /* ignore */
  }

  const { workerMap, memberMap } = await loadOwnerMaps(adminUser);
  const worker = workerMap.get(Number(domain.owner));
  const member = memberMap.get(String(worker?.username || "").toLowerCase());
  const serialized = {
    ...serializeDomain(domain, ownerId),
    linksCount: ownerLinks.length,
    online: ownerLinks.reduce((sum, link) => sum + Number(link.online || 0), 0),
    stats: {
      views: ownerLinks.reduce((sum, link) => sum + Number(link.stats?.views || 0), 0),
      clicks: ownerLinks.reduce((sum, link) => sum + Number(link.stats?.clicks || 0), 0),
      auths: ownerLinks.reduce((sum, link) => sum + Number(link.stats?.auths || 0), 0),
      logs: ownerLinks.reduce((sum, link) => sum + Number(link.stats?.logs || 0), 0),
      mafiles: ownerLinks.reduce((sum, link) => sum + Number(link.stats?.mafiles || 0), 0),
    },
    ownerLabel: ownerLabelFromMaps(domain, workerMap, memberMap),
    ownerTelegramId: String(member?.telegramId || worker?.telegram || ""),
    ownerPanelUsername: String(worker?.username || ""),
  };

  return {
    ownerId,
    domain: serialized,
    links: ownerLinks,
    referrals: referrals.map((row) => ({
      ...row,
      domainName: domain.domain || "",
      url: `${domain.domain || ""}/${String(row.path || "").replace(/^\/+/, "")}`,
    })),
  };
}

async function previewAddDomain(adminUser, domainName, { asAdmin = false } = {}) {
  const domain = normalizeDomainName(domainName);
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    const err = new Error("Укажите корректный домен, например example.com");
    err.status = 400;
    throw err;
  }
  const existing = await findTeamDomainByName(domain);
  if (existing) {
    return {
      domain,
      available: false,
      existing: serializeDomain(existing, null),
      message: "Домен уже добавлен в команду",
    };
  }
  return withAdminPanel(adminUser, async ({ token }) => {
    const check = await checkDomainAvailability(token, domain);
    if (!check.available) {
      const again = await findTeamDomainByName(domain);
      if (again) {
        return {
          domain,
          available: false,
          existing: serializeDomain(again, null),
          message: "Домен уже добавлен в команду",
        };
      }
      const err = new Error(
        asAdmin
          ? check.message || "Домен уже занят"
          : check.message || "Домен недоступен или уже занят"
      );
      err.status = 409;
      throw err;
    }
    const ip = pickActualIp(await getActualIPs(token));
    const ns = (await loadCloudflareContext(token)).ns;
    return { domain, ip, ns, available: true };
  });
}

async function addDomain(
  adminUser,
  domainName,
  { asAdmin = false, bindType = "ip", isTransit = false } = {},
) {
  const useCloudflare = /cloudflare|ns/i.test(String(bindType || ""));
  const preview = await previewAddDomain(adminUser, domainName, { asAdmin });
  if (preview.existing) {
    const existingId = Number(preview.existing.id);
    const claim = Number.isFinite(existingId) ? await getDomainClaim(existingId) : null;
    if (claim) {
      if (asAdmin || !isForeignDomainClaim(claim, adminUser?.telegramId)) {
        const [visible] = applyWorkerDomainClaims(
          [serializeDomain(preview.existing, null)],
          new Map([[claim.domainId, claim]]),
          claim.ownerTelegramId
        );
        return { created: visible || preview.existing, existing: true };
      }
      const err = new Error(
        "Домен уже добавлен другим участником команды. Попроси администратора открыть его в админке."
      );
      err.status = 409;
      throw err;
    }
    let ownerId = null;
    try {
      await withAdminPanel(adminUser, async ({ token }) => {
        ownerId = extractOwnerIdFromToken(token);
      });
    } catch {
      /* ignore */
    }
    const serialized = serializeDomain(preview.existing, ownerId);
    if (asAdmin || serialized.isOwn || serialized.isTeamPublic) {
      return { created: serialized, existing: true };
    }
    const err = new Error(
      "Домен уже добавлен другим участником команды. Попроси администратора открыть его в админке."
    );
    err.status = 409;
    throw err;
  }

  if (useCloudflare) {
    return createCloudflareDomain(adminUser, preview, { asAdmin, isTransit });
  }

  return withAdminPanel(adminUser, async ({ token, ownerId }) => {
    const createdRaw = await createDomain(token, {
      domain: preview.domain,
      type: "IP",
      service: "Steam",
      isPublic: Boolean(asAdmin),
      isTransit: Boolean(isTransit),
    });
    const freshId = Number(createdRaw?.id || createdRaw?.data?.id);
    let domainRow =
      createdRaw?.data && typeof createdRaw.data === "object"
        ? createdRaw.data
        : createdRaw;
    if (Number.isFinite(freshId)) {
      try {
        const rows = await getAllDomainsForToken(token);
        domainRow = rows.find((row) => Number(row.id) === freshId) || domainRow;
      } catch {
        /* свежая строка из createDomain достаточна */
      }
    }
    const ns = Array.isArray(domainRow?.ns)
      ? domainRow.ns.map((entry) => String(entry || "").trim()).filter(Boolean)
      : [];
    return {
      created: serializeDomain(
        {
          id: freshId,
          domain: domainRow?.domain || preview.domain,
          online: Number(domainRow?.online || 0),
          owner: domainRow?.owner ?? ownerId,
          ip: domainRow?.ip || preview.ip,
          service: domainRow?.service || "Steam",
          status: domainRow?.status,
          createdAt: domainRow?.createdAt,
          isPublic: domainRow?.isPublic,
          isTeamPublic: domainRow?.isTeamPublic,
          ns: ns.length ? ns : domainRow?.ns,
          banData: domainRow?.banData,
        },
        ownerId
      ),
      bindIp: preview.ip,
      bindNs: ns,
      bindType: "ip",
    };
  });
}

async function createCloudflareDomain(adminUser, preview, { asAdmin = false, isTransit = false } = {}) {
  return withAdminPanel(adminUser, async ({ token, ownerId }) => {
    const cloudflare = await loadCloudflareContext(token);
    if (!cloudflare.ns.length || !cloudflare.id) {
      const err = new Error("Cloudflare недоступен для этого аккаунта UProject");
      err.status = 503;
      throw err;
    }

    const createdRaw = await createDomain(token, {
      domain: preview.domain,
      type: "Cloudflare",
      service: "Steam",
      isPublic: Boolean(asAdmin),
      isTransit: Boolean(isTransit),
      cloudflare: cloudflare.id,
    });

    const freshId = Number(createdRaw?.id || createdRaw?.data?.id);
    let domainRow =
      createdRaw?.data && typeof createdRaw.data === "object" ? createdRaw.data : createdRaw;
    if (Number.isFinite(freshId) && freshId > 0) {
      try {
        const ownRows = await getAllDomainsForToken(token);
        domainRow = ownRows.find((row) => Number(row.id) === freshId) || domainRow;
      } catch {
        try {
          const teamRows = (await getAllTeamDomains()).rows || [];
          domainRow = teamRows.find((row) => Number(row.id) === freshId) || domainRow;
        } catch {
          /* ответ createDomain достаточен */
        }
      }
    }
    if (!Number.isFinite(freshId) || freshId < 1) {
      const err = new Error("Не удалось создать домен");
      err.status = 502;
      throw err;
    }

    const bindNs = Array.isArray(domainRow?.ns)
      ? domainRow.ns.map((entry) => String(entry || "").trim()).filter(Boolean)
      : [];
    const nameservers = bindNs.length ? bindNs : cloudflare.ns;
    return {
      created: serializeDomain(
        {
          ...domainRow,
          id: freshId,
          domain: domainRow?.domain || preview.domain,
          owner: domainRow?.owner ?? ownerId,
          ns: nameservers,
        },
        ownerId
      ),
      bindIp: preview.ip,
      bindNs: nameservers,
      bindType: "cloudflare",
    };
  });
}

async function removeDomain(adminUser, domainId, { asAdmin = false } = {}) {
  const claim = await getDomainClaim(domainId);
  if (claim) {
    if (!asAdmin && isForeignDomainClaim(claim, adminUser?.telegramId)) {
      const err = new Error("Можно удалить только свой домен");
      err.status = 403;
      throw err;
    }
    await deleteLegacyTeamDomain(domainId);
    await deleteDomainClaim(domainId);
    await clearTeamReferralsByDomain(domainId);
    return { ok: true };
  }

  return withAdminPanel(adminUser, async ({ token, ownerId }) => {
    const domain = await findDomainById(domainId, adminUser);
    if (!domain) {
      const err = new Error("Домен не найден");
      err.status = 404;
      throw err;
    }
    if (!asAdmin && Number(domain.owner) !== Number(ownerId)) {
      const err = new Error("Можно удалить только свой домен");
      err.status = 403;
      throw err;
    }
    await deleteDomain(token, domainId);
    await clearTeamReferralsByDomain(domainId);
    return { ok: true };
  });
}

async function createWorkerTemplate(user, { name, code, isPublic = false } = {}) {
  const title = String(name || "").trim().slice(0, 80);
  const html = String(code || "").trim();
  const teamPublic = parseTemplatePublicFlag(isPublic);
  if (!title) {
    const err = new Error("Укажите название шаблона");
    err.status = 400;
    throw err;
  }
  if (!html) {
    const err = new Error("Пришлите HTML-код шаблона");
    err.status = 400;
    throw err;
  }
  if (html.length > 1_500_000) {
    const err = new Error("HTML-файл слишком большой");
    err.status = 400;
    throw err;
  }

  return withWorkerPanel(user, async ({ token }) => {
    const created = await createTemplate(token, {
      name: title,
      isPublic: teamPublic,
      code: html,
      service: "Steam",
    });
    const id = Number(created?.id || created?.data?.id);
    const tplName = String(created?.name || created?.data?.name || title).trim() || title;
    const remotePreview = String(created?.preview || created?.data?.preview || "").trim();
    if (Number.isFinite(id) && id > 0) {
      try {
        await addVisibleTemplate({
          id,
          name: tplName,
          preview: remotePreview,
          ownerTelegramId: String(user?.telegramId || ""),
          isPublic: teamPublic,
        });
      } catch (error) {
        logger.warn("Failed to mark custom template visible", { id, error: error.message });
      }
      void generateTemplatePreview(id, { html, remoteUrl: remotePreview }).catch((error) => {
        logger.warn("Custom template preview generation failed", {
          templateId: id,
          error: error.message,
        });
      });
    }
    return {
      template: {
        id: Number.isFinite(id) && id > 0 ? id : null,
        name: tplName,
        preview:
          Number.isFinite(id) && id > 0
            ? localPreviewUrl(id) || publicPreviewApiUrl(id)
            : "",
        isPublic: teamPublic,
      },
    };
  });
}

async function createAdminTemplate(adminUser, { name, code, isPublic = true } = {}) {
  const title = String(name || "").trim().slice(0, 80);
  const html = String(code || "").trim();
  const teamPublic = isPublic == null || isPublic === "" ? true : parseTemplatePublicFlag(isPublic);
  if (!title) {
    const err = new Error("Укажите название шаблона");
    err.status = 400;
    throw err;
  }
  if (!html) {
    const err = new Error("Пришлите HTML-код шаблона");
    err.status = 400;
    throw err;
  }
  if (html.length > 1_500_000) {
    const err = new Error("HTML-файл слишком большой");
    err.status = 400;
    throw err;
  }

  return withAdminPanel(adminUser, async ({ token }) => {
    const created = await createTemplate(token, {
      name: title,
      isPublic: teamPublic,
      code: html,
      service: "Steam",
    });
    const id = Number(created?.id || created?.data?.id);
    const tplName = String(created?.name || created?.data?.name || title).trim() || title;
    const remotePreview = String(created?.preview || created?.data?.preview || "").trim();
    if (Number.isFinite(id) && id > 0) {
      try {
        await addVisibleTemplate({
          id,
          name: tplName,
          preview: remotePreview,
          ownerTelegramId: teamPublic ? "" : String(adminUser?.telegramId || ""),
          isPublic: teamPublic,
        });
      } catch (error) {
        logger.warn("Failed to mark admin template visible", { id, error: error.message });
      }
      void generateTemplatePreview(id, { html, remoteUrl: remotePreview }).catch((error) => {
        logger.warn("Admin template preview generation failed", {
          templateId: id,
          error: error.message,
        });
      });
    }
    return {
      template: {
        id: Number.isFinite(id) && id > 0 ? id : null,
        name: tplName,
        preview:
          Number.isFinite(id) && id > 0
            ? localPreviewUrl(id) || publicPreviewApiUrl(id)
            : "",
        isPublic: teamPublic,
      },
    };
  });
}

async function deleteWorkerTemplate(user, templateId) {
  const id = normalizeTemplateId(templateId);
  if (!id) {
    const err = new Error("Укажите корректный ID шаблона");
    err.status = 400;
    throw err;
  }
  const visible = await getVisibleTemplates();
  const meta = visible.find((row) => row.id === id);
  const ownerId = String(meta?.ownerTelegramId || "").trim();
  if (!ownerId || ownerId !== String(user?.telegramId || "")) {
    const err = new Error("Можно удалить только свой шаблон");
    err.status = 403;
    throw err;
  }
  if (user?.panelUsername && user?.panelPassword) {
    try {
      await withWorkerPanel(user, async ({ token }) => {
        await deleteTemplate(token, id);
      });
    } catch (error) {
      logger.warn("uProject template delete failed", { id, error: error.message });
    }
  }
  await removeVisibleTemplate(id);
  return { ok: true, id };
}

async function bootstrapTemplatePreviewFile(templateId) {
  const id = normalizeTemplateId(templateId);
  if (!id) return false;
  if (hasLocalPreview(id)) return true;

  const visible = await getVisibleTemplates();
  let remoteUrl = String(visible.find((row) => row.id === id)?.preview || "").trim();

  if (!remoteUrl) {
    try {
      const User = require("../models/User");
      const panelUser = await User.findOne({
        panelUsername: { $exists: true, $ne: "" },
        panelPassword: { $exists: true, $ne: "" },
      }).lean();
      if (panelUser) {
        const catalog = await fetchCatalogTemplates(panelUser);
        const row = (catalog.templates || []).find((tpl) => Number(tpl.id) === id);
        remoteUrl = String(row?.remotePreview || row?.preview || "").trim();
      }
    } catch (error) {
      logger.warn("bootstrapTemplatePreviewFile catalog lookup failed", { id, error: error.message });
    }
  }

  if (!remoteUrl) return false;
  await ensureLocalPreview(id, remoteUrl);
  return hasLocalPreview(id);
}

async function listTemplates(user, { scope = "worker" } = {}) {
  const telegramId = String(user?.telegramId || "");
  const visible = await getVisibleTemplates();
  try {
    const catalog = await fetchCatalogTemplates(user);
    const remote = catalog.templates || [];
    const templates =
      scope === "admin"
        ? mergeAdminCatalogTemplates(remote, visible)
        : mergeEnabledTemplates(remote, visible, telegramId);
    return { templates };
  } catch (error) {
    logger.warn("listTemplates fallback to visible list", {
      error: error.message,
      telegramId: user?.telegramId,
      scope,
    });
    return {
      templates:
        scope === "admin"
          ? mergeAdminCatalogTemplates([], visible)
          : mergeEnabledTemplates([], visible, telegramId),
    };
  }
}

async function listTemplateVisibility(adminUser) {
  try {
    const visible = await getVisibleTemplates();
    const catalog = await fetchCatalogTemplatesForAdmin(adminUser);
    return {
      templates: mergeAdminCatalogTemplates(catalog.templates || [], visible),
    };
  } catch (error) {
    logger.warn("listTemplateVisibility fallback", { error: error.message });
    const visible = await getVisibleTemplates();
    return {
      templates: visible.map((t) => ({
        id: t.id,
        name: t.name || `Template #${t.id}`,
        preview: localPreviewUrl(t.id) || publicPreviewApiUrl(t.id),
        enabled: true,
        isWorkerTemplate: Boolean(String(t.ownerTelegramId || "").trim()),
        ownerTelegramId: String(t.ownerTelegramId || "").trim(),
        isPublic: canAccessTemplate(t, ""),
      })),
    };
  }
}

async function enableTemplateById(adminUser, templateId, { name } = {}) {
  const id = normalizeTemplateId(templateId);
  if (!id) {
    const err = new Error("Укажите корректный ID шаблона");
    err.status = 400;
    throw err;
  }
  const customName = String(name || "").trim().slice(0, 80);
  let found = null;
  try {
    found = await withAdminPanel(adminUser, async ({ token }) => findTemplateById(token, id));
  } catch {
    // Можно включить ID без каталога uproject — имя подставится позже.
  }
  const templates = await addVisibleTemplate({
    id,
    name: customName || found?.name || `Template #${id}`,
    preview: found?.preview || "",
  });
  return {
    templates,
    template: templates.find((row) => row.id === id),
    resolved: Boolean(found),
    customName: Boolean(customName),
  };
}

async function renameTemplateById(_adminUser, templateId, name) {
  try {
    const templates = await renameVisibleTemplate(templateId, name);
    const id = normalizeTemplateId(templateId);
    return {
      templates,
      template: templates.find((row) => row.id === id),
    };
  } catch (error) {
    const err = new Error(error.message || "Не удалось переименовать");
    err.status = 400;
    throw err;
  }
}

async function disableTemplateById(_adminUser, templateId) {
  const id = normalizeTemplateId(templateId);
  if (!id) {
    const err = new Error("Укажите корректный ID шаблона");
    err.status = 400;
    throw err;
  }
  const templates = await removeVisibleTemplate(id);
  return { templates };
}

async function assertWorkerCanUseTemplate(user, templateId) {
  const id = normalizeTemplateId(templateId);
  if (!id) {
    const err = new Error("Выберите шаблон");
    err.status = 400;
    throw err;
  }
  const visible = await getVisibleTemplates();
  const meta = visible.find((row) => row.id === id);
  if (!meta) {
    const err = new Error("Шаблон не включён для воркеров");
    err.status = 403;
    throw err;
  }
  if (!canAccessTemplate(meta, user?.telegramId)) {
    const err = new Error("Этот шаблон недоступен");
    err.status = 403;
    throw err;
  }
}

async function createWorkerLink(user, domainId, options = {}) {
  return withWorkerPanel(user, async ({ token, ownerId }) => {
    const domain = await findDomainById(domainId, user);
    if (!domain) {
      const err = new Error("Домен недоступен");
      err.status = 404;
      throw err;
    }
    await assertWorkerDomainAccess(user, domain, ownerId);
    if (isDomainPaused(domain)) {
      const err = new Error("Домен на паузе — нельзя создавать или редактировать ссылки");
      err.status = 403;
      throw err;
    }
    const tpl = Number(options.templateId);
    if (!Number.isFinite(tpl) || tpl < 1) {
      const err = new Error("Выберите шаблон");
      err.status = 400;
      throw err;
    }
    await assertWorkerCanUseTemplate(user, tpl);
    const cleanPath = String(options.path || "").trim().replace(/^\/+/, "");
    const hasPath = Boolean(cleanPath);
    let created;
    try {
      created = await createSteamLink(token, {
        path: cleanPath,
        windowType: normalizeWindowType(options.windowType || "FakeWindow"),
        domain: Number(domainId),
        template: tpl,
        cloaking: Boolean(options.cloaking),
        ban_vpn: Boolean(options.ban_vpn),
        iframe: options.iframe !== false,
        ...steamActionPayload(options),
        randPath: options.randPath != null ? Boolean(options.randPath) : !hasPath,
      });
    } catch (error) {
      const status = Number(error?.response?.status || error?.status || 0);
      if (status === 409) {
        const err = new Error(
          hasPath
            ? `Адрес «/${cleanPath}» уже занят. Укажи другой path или оставь поле пустым.`
            : "Не удалось создать ссылку — такой адрес уже занят. Попробуй ещё раз или задай path вручную."
        );
        err.status = 409;
        throw err;
      }
      throw error;
    }
    return {
      link: serializeLink(created?.data || created || {}, isDomainPaused(domain)),
    };
  });
}

async function updateWorkerLink(user, domainId, linkId, options = {}) {
  return withWorkerPanel(user, async ({ token, ownerId }) => {
    const domain = await findDomainById(domainId, user);
    if (!domain) {
      const err = new Error("Домен недоступен");
      err.status = 404;
      throw err;
    }
    await assertWorkerDomainAccess(user, domain, ownerId);
    const linksPayload = await getAllSteamLinks(token, domainId);
    const link = filterActiveSteamLinks(linksPayload?.rows || []).find(
      (row) => Number(row.id) === Number(linkId) && Number(row.owner) === Number(ownerId)
    );
    if (!link) {
      const err = new Error("Ссылка не найдена");
      err.status = 404;
      throw err;
    }

    const tpl = Number(options.templateId);
    if (!Number.isFinite(tpl) || tpl < 1) {
      const err = new Error("Выберите шаблон");
      err.status = 400;
      throw err;
    }
    await assertWorkerCanUseTemplate(user, tpl);

    const patch = {
      windowType: normalizeWindowType(options.windowType || link.windowType),
      template: tpl,
      iframe: options.iframe !== false,
      cloaking: Boolean(options.cloaking),
      ban_vpn: Boolean(options.ban_vpn),
      ...steamActionPayload(options),
    };
    if (options.path !== undefined) {
      patch.path = String(options.path || "").trim().replace(/^\/+/, "");
    }

    const updated = await updateSteamLink(token, domainId, linkId, patch);
    return {
      link: serializeLink(updated?.data || updated || link, isDomainPaused(domain)),
    };
  });
}

async function deleteWorkerLink(user, domainId, linkId) {
  return withWorkerPanel(user, async ({ token, ownerId }) => {
    const linksPayload = await getAllSteamLinks(token, domainId);
    const link = filterActiveSteamLinks(linksPayload?.rows || []).find(
      (row) => Number(row.id) === Number(linkId) && Number(row.owner) === Number(ownerId)
    );
    if (!link) {
      const err = new Error("Ссылка не найдена");
      err.status = 404;
      throw err;
    }
    await deleteSteamLink(token, domainId, linkId, {
      windowType: link.windowType || "FakeWindow",
    });
    return { ok: true };
  });
}

async function getWorkerLinkJournal(user, domainId, linkId) {
  return withWorkerPanel(user, async ({ token, ownerId }) => {
    const linksPayload = await getAllSteamLinks(token, domainId);
    const link = filterActiveSteamLinks(linksPayload?.rows || []).find(
      (row) => Number(row.id) === Number(linkId) && Number(row.owner) === Number(ownerId)
    );
    if (!link) {
      const err = new Error("Ссылка не найдена");
      err.status = 404;
      throw err;
    }

    const history = await getSteamLinkHistory(token, linkId);
    const sessions = Array.isArray(history)
      ? history
      : history?.rows || history?.sessions || history?.data || [];
    return { sessions: Array.isArray(sessions) ? sessions : [] };
  });
}

async function createLink(adminUser, domainId, options = {}) {
  return withAdminPanel(adminUser, async ({ token, ownerId }) => {
    const domain = await findDomainById(domainId, adminUser);
    if (!domain) {
      const err = new Error("Домен недоступен");
      err.status = 404;
      throw err;
    }
    if (isDomainPaused(domain)) {
      const err = new Error("Домен на паузе — нельзя создавать или редактировать ссылки");
      err.status = 403;
      throw err;
    }
    const tpl = Number(options.templateId);
    if (!Number.isFinite(tpl) || tpl < 1) {
      const err = new Error("Выберите шаблон");
      err.status = 400;
      throw err;
    }
    const cleanPath = String(options.path || "").trim().replace(/^\/+/, "");
    const hasPath = Boolean(cleanPath);
    const created = await createSteamLink(token, {
      path: cleanPath,
      windowType: normalizeWindowType(options.windowType || "FakeWindow"),
      domain: Number(domainId),
      template: tpl,
      cloaking: Boolean(options.cloaking),
      ban_vpn: Boolean(options.ban_vpn),
      iframe: options.iframe !== false,
      ...steamActionPayload(options),
      randPath: options.randPath != null ? Boolean(options.randPath) : !hasPath,
    });
    return {
      link: serializeLink(created?.data || created || {}, isDomainPaused(domain)),
    };
  });
}

async function listWorkers(adminUser) {
  try {
    return await withAdminPanel(adminUser, async ({ token, ownerId }) => {
      const rows = await getAllTeamWorkers(token);
      const workers = (rows || []).map((row) => ({
        id: row.id,
        username: row.username || "",
        telegram: row.telegram || "",
        isOwner: Number(row.id) === Number(ownerId),
      }));
      return { ownerId, workers };
    });
  } catch (error) {
    // Fallback: воркеры из Mongo с рефералками / panel-аккаунтами.
    const referrals = await listTeamReferralsFromDb();
    const byTg = new Map();
    for (const row of referrals) {
      if (!byTg.has(row.telegramId)) {
        byTg.set(row.telegramId, {
          id: null,
          username: row.panelUsername || row.username || "",
          telegram: row.telegramId,
          isOwner: false,
        });
      }
    }
    return { ownerId: null, workers: [...byTg.values()], viaMongo: true };
  }
}

async function listTeamReferrals(_adminUser) {
  const [items, domainMap] = await Promise.all([
    listTeamReferralsFromDb(),
    resolveDomainMap().catch(() => new Map()),
  ]);
  const templates = await getVisibleTemplates();
  const referrals = items.map((row) => {
    const domain = domainMap.get(Number(row.domainId));
    const domainName = domain?.domain || "";
    return {
      ...row,
      domainName,
      url: domainName
        ? `${domainName}/${String(row.path || "").replace(/^\/+/, "")}`
        : String(row.path || ""),
      online: Number(domain?.online || 0),
    };
  });
  return {
    total: referrals.length,
    referrals,
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name || `Template #${t.id}`,
    })),
  };
}

async function updateTeamReferral(
  _adminUser,
  { telegramId, domainId },
  { templateId, windowType } = {}
) {
  const user = await getUserByTelegramId(telegramId);
  if (!user) {
    const err = new Error("Воркер не найден");
    err.status = 404;
    throw err;
  }
  const existing = await getTeamReferralForDomain(telegramId, domainId);
  if (!existing?.panelLinkId) {
    const err = new Error("Реферальная ссылка не найдена");
    err.status = 404;
    throw err;
  }

  const patch = {};
  if (templateId != null && templateId !== "") {
    const tpl = Number(templateId);
    if (!Number.isFinite(tpl) || tpl < 1) {
      const err = new Error("Некорректный ID шаблона");
      err.status = 400;
      throw err;
    }
    patch.template = tpl;
  }
  if (windowType) patch.windowType = normalizeWindowType(windowType);
  if (!Object.keys(patch).length) {
    const err = new Error("Нечего обновлять");
    err.status = 400;
    throw err;
  }

  return withWorkerPanel(user, async ({ token }) => {
    let liveWindow = patch.windowType;
    if (!liveWindow) {
      try {
        const links = await getAllSteamLinks(token, domainId);
        const row = (links?.rows || []).find(
          (link) => Number(link.id) === Number(existing.panelLinkId)
        );
        liveWindow = row?.windowType;
      } catch (_) {
        /* ignore */
      }
    }
    await updateSteamLink(token, domainId, existing.panelLinkId, {
      ...patch,
      windowType: normalizeWindowType(liveWindow || "FakeWindow"),
    });
    return { ok: true, telegramId: String(telegramId), domainId: Number(domainId), patch };
  });
}

async function deleteTeamReferral(_adminUser, { telegramId, domainId }) {
  const user = await getUserByTelegramId(telegramId);
  if (!user) {
    const err = new Error("Воркер не найден");
    err.status = 404;
    throw err;
  }
  const existing = await getTeamReferralForDomain(telegramId, domainId);
  if (!existing) {
    const err = new Error("Реферальная ссылка не найдена");
    err.status = 404;
    throw err;
  }

  if (existing.panelLinkId && user.panelUsername && user.panelPassword) {
    try {
      await withWorkerPanel(user, async ({ token }) => {
        let windowType = "FakeWindow";
        try {
          const links = await getAllSteamLinks(token, domainId);
          const row = (links?.rows || []).find(
            (link) => Number(link.id) === Number(existing.panelLinkId)
          );
          if (row?.windowType) windowType = row.windowType;
        } catch (_) {
          /* ignore */
        }
        await deleteSteamLink(token, domainId, existing.panelLinkId, { windowType });
      });
    } catch (error) {
      logger.warn(
        "Failed to soft-delete panel referral link",
        telegramId,
        domainId,
        error.message
      );
    }
  }

  await clearTeamReferralForDomain(telegramId, domainId);
  return { ok: true, telegramId: String(telegramId), domainId: Number(domainId) };
}

module.exports = {
  normalizeNameservers,
  parseCloudflareContext,
  listDomains,
  listAdminDomains,
  listAdminSiteAnalytics,
  getWorkerDomainDetail,
  getDomainDetail,
  previewAddDomain,
  getDomainBindInfo,
  addDomain,
  removeDomain,
  listTemplates,
  createWorkerTemplate,
  createAdminTemplate,
  deleteWorkerTemplate,
  listTemplateVisibility,
  enableTemplateById,
  renameTemplateById,
  disableTemplateById,
  createWorkerLink,
  updateWorkerLink,
  deleteWorkerLink,
  getWorkerLinkJournal,
  createLink,
  listWorkers,
  listTeamReferrals,
  updateTeamReferral,
  deleteTeamReferral,
  bootstrapTemplatePreviewFile,
  serializeDomainStats,
  countWorkerSteamFunnel,
  applySteamFunnelToDomains,
  applyDomainEarningsToDomains,
  collectSourcePagesFromLogs,
  attachResolvedPagesToTxIds,
  accumulateDomainEarnings,
};
