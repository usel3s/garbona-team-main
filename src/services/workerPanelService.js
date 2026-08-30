const { getPanelToken } = require("../handlers/sitesHandler");
const { getSteamAccounts, getSteamAccountById, getSteamTaskById } = require("./steamApiService");
const { formatPanelError, getAllDomainsForToken } = require("./apiService");
const axios = require("axios");
const { env } = require("../config/env");
const { createTtlCache } = require("../utils/ttlCache");
const {
  classifyWorkerAccountStatus,
  serializeWorkerMafileSession,
  rawUprojectStatus,
  preferWorkerStatus,
} = require("./steamControlService");
const { resolveSteamCountryCode } = require("../utils/countryStats");
const { buildDomainLookup, formatAccountSourcePage } = require("../utils/steamSourcePage");
const SteamLog = require("../models/SteamLog");

const workerViewCache = createTtlCache({ defaultTtlMs: 25000, maxEntries: 100 });

function accountPrice(account) {
  const balance =
    account?.steamInfo?.balanceUsd != null
      ? Number(account.steamInfo.balanceUsd)
      : Number(account?.steamInfo?.balance || 0);
  const price = account?.inventory?.price || {};
  const inventory = Number(
    price.tradable != null
      ? price.tradable
      : price.marketable != null
        ? price.marketable
        : price.total != null
          ? price.total
          : 0
  );
  const bal = Number.isFinite(balance) ? balance : 0;
  const inv = Number.isFinite(inventory) ? inventory : 0;
  return Number((bal + inv).toFixed(2));
}

function classifyStatus(row) {
  return classifyWorkerAccountStatus(row);
}

function isOnSaleLabel(status) {
  return /прода[её]тся|on\s*sell|onsell|на\s*продаж/i.test(String(status || ""));
}

/**
 * Live UProject keeps an account tagged `OnSell` even after its LZT lot was
 * sold / refunded / deleted (UProject never learns the lot died). When our own
 * tracked lifecycle (SteamLog) says the account is no longer sellable, trust it
 * over the stale live tag — but only to correct a live "on sale" status.
 */
function reconcileStoredStatus(liveStatus, dbDoc) {
  if (!dbDoc || !isOnSaleLabel(liveStatus)) return liveStatus;
  const auto = String(dbDoc.autoSaleStatus || "").toLowerCase();
  if (auto === "failed") return "Невалид";
  if (auto === "refunded") return "Продажа отменена";
  if (auto === "released") return "Продан";
  if (auto === "sold_held" || auto === "arbitration") return "На холде";
  if (/^(invalid|невалид)$/i.test(String(dbDoc.accountStatus || "").trim())) {
    return "Невалид";
  }
  return liveStatus;
}

function formatSourcePage(row = {}, domainById = null) {
  return formatAccountSourcePage(row, domainById);
}

function serializeLog(row, domainById = null, dbDoc = null) {
  const steam = row?.steamInfo || {};
  const session = serializeWorkerMafileSession(row);
  return {
    id: row.id,
    createdAt: row.createdAt || row.date || row.created_at || null,
    username: row.username || steam.nickname || "",
    sourcePage: formatSourcePage(row, domainById),
    level: steam.level ?? null,
    country:
      resolveSteamCountryCode(steam) || steam.country || steam.countryCode || "",
    lastPlayed: steam.lastPlayed || null,
    priceUsd: accountPrice(row),
    status: reconcileStoredStatus(classifyStatus(row), dbDoc),
    steamId: steam.steamid || steam.steamId || "",
    gamesCount: Number(row.gamesCount ?? row.gameCount ?? row.gamesInfo?.length ?? 0),
    accountTag: String(row.customTeamTag || row.customTag || ""),
    eventType: session.eventType,
    mafileTime: session.mafileTime,
    mafileSessionHoursLeft: session.mafileSessionHoursLeft,
    mafileSessionUnlocked: session.mafileSessionUnlocked,
    sessionInvalid: session.sessionInvalid,
    sessionCheckedAt: session.sessionCheckedAt,
  };
}

function isToday(value) {
  if (!value) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  );
}

function unwrapSteamAccount(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.id != null) return payload;
  if (payload.data?.id != null) return payload.data;
  if (payload.account?.id != null) return payload.account;
  return null;
}

function mergeAccountRows(primary = [], extra = []) {
  const byId = new Map();
  for (const row of [...(primary || []), ...(extra || [])]) {
    const id = String(row?.id || "").trim();
    if (!id) continue;
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, row);
      continue;
    }
    const status = preferWorkerStatus(rawUprojectStatus(row), rawUprojectStatus(prev));
    byId.set(id, {
      ...prev,
      ...row,
      status: status || row.status || prev.status,
      invalidDate: row.invalidDate || prev.invalidDate || null,
    });
  }
  return [...byId.values()];
}

function persistLiveAccountSnapshots(accounts, domainById) {
  const ops = [];
  for (const account of accounts || []) {
    const sourceId = String(account?.id || "").trim();
    if (!/^\d+$/.test(sourceId)) continue;
    const $set = {};
    const sourcePage = formatAccountSourcePage(account, domainById);
    const accountStatus = rawUprojectStatus(account);
    if (sourcePage) $set.sourcePage = sourcePage;
    if (accountStatus) $set.accountStatus = accountStatus;
    const steamId = String(account?.steamInfo?.steamid || account?.steamInfo?.steamId || "").trim();
    if (steamId) $set.steamId = steamId;
    if (!Object.keys($set).length) continue;
    ops.push({
      updateOne: {
        filter: { sourceId },
        update: { $set },
      },
    });
  }
  if (!ops.length) return;
  SteamLog.bulkWrite(ops, { ordered: false }).catch(() => {});
}

async function listWorkerLogs(user, { offset = 0, limit = 30, q = "", skipCache = false } = {}) {
  try {
    const auth = await getPanelToken(user);
    const query = String(q || "").trim();
    const idQuery = query.replace(/^#/, "").trim();
    const isId = /^\d{4,}$/.test(idQuery);
    const [payload, invalidPayload, domains, byId] = await Promise.all([
      getSteamAccounts(auth.token, {
        offset: Math.max(0, Number(offset) || 0),
        limit: Math.min(100, Math.max(1, Number(limit) || 30)),
        skipCache: Boolean(skipCache),
        ...(query ? { search: query } : {}),
      }),
      getSteamAccounts(auth.token, {
        offset: 0,
        limit: 100,
        statuses: ["Invalid"],
        skipCache: true,
      }).catch(() => null),
      getAllDomainsForToken(auth.token).catch(() => []),
      isId
        ? getSteamAccountById(auth.token, idQuery).catch(() => null)
        : Promise.resolve(null),
    ]);
    const domainById = buildDomainLookup(domains);
    let rows = payload?.rows || payload?.data || [];
    if (!Array.isArray(rows)) rows = [];
    const invalidRows = invalidPayload?.rows || invalidPayload?.data || [];
    if (Array.isArray(invalidRows) && invalidRows.length) {
      rows = mergeAccountRows(rows, invalidRows);
    }
    const extra = unwrapSteamAccount(byId);
    if (extra) {
      const extraId = String(extra.id || "");
      if (extraId && !rows.some((row) => String(row.id) === extraId)) {
        rows.unshift(extra);
      } else if (extraId) {
        rows = mergeAccountRows(rows, [extra]);
      }
    }
    persistLiveAccountSnapshots(rows, domainById);
    const needle = query.toLowerCase();
    if (needle) {
      rows = rows.filter((row) => {
        const hay = [
          row.id,
          row.username,
          row.domain,
          row.path,
          row.link,
          row.linkUrl,
          formatSourcePage(row, domainById),
          row.steamInfo?.nickname,
          row.steamInfo?.steamid,
          row.status,
        ]
          .map((v) => String(v || "").toLowerCase())
          .join(" ");
        return hay.includes(needle);
      });
    }
    const sourceIds = rows
      .map((row) => String(row?.id || "").trim())
      .filter((id) => /^\d+$/.test(id));
    let dbBySourceId = new Map();
    if (sourceIds.length) {
      try {
        const docs = await SteamLog.find({ sourceId: { $in: sourceIds } })
          .select("sourceId autoSaleStatus accountStatus")
          .lean();
        dbBySourceId = new Map(docs.map((d) => [String(d.sourceId), d]));
      } catch (_) {
        /* DB join is best-effort; fall back to live status */
      }
    }
    const logs = rows.map((row) =>
      serializeLog(row, domainById, dbBySourceId.get(String(row.id)))
    );
    const todayLogs = logs.filter((l) => isToday(l.createdAt));
    return {
      panelUsername: user.panelUsername || "",
      summary: {
        totalLogs: logs.length,
        todayLogs: todayLogs.length,
        todayVisits: 0,
      },
      logs,
    };
  } catch (error) {
    const err = new Error(formatPanelError(error) || error.message || "logs_error");
    err.status = error?.response?.status || 400;
    throw err;
  }
}

async function listWorkerTasks(user) {
  const cacheKey = `tasks:${user.telegramId || user.panelUsername || ""}`;
  const cached = workerViewCache.get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const auth = await getPanelToken(user);
    const client = axios.create({
      baseURL: env.uprojectApiBase,
      timeout: 30000,
      headers: {
        Cookie: `token=${auth.token}`,
        Origin: "https://uproject.io",
        Referer: "https://uproject.io/",
      },
    });
    let payload;
    try {
      payload = (await client.get("/steam/tasks", { params: { offset: 0, limit: 50 } })).data;
    } catch (_) {
      try {
        payload = (await client.get("/tasks", { params: { offset: 0, limit: 50 } })).data;
      } catch (error) {
        const empty = {
          tasks: [],
          message:
            "Задачи создаются из раздела «Логи»: выберите аккаунты и запустите нужную задачу.",
        };
        workerViewCache.set(cacheKey, empty, 15000);
        return empty;
      }
    }
    const rows = payload?.rows || payload?.data || (Array.isArray(payload) ? payload : []);
    const result = {
      tasks: (rows || []).map((t) => ({
        id: t.id,
        name: t.name || t.task || "Задача",
        status: t.status || t.state || "—",
        accounts: t.accountsCount ?? t.ids?.length ?? t.count ?? 0,
        createdAt: t.createdAt || t.date || null,
      })),
      message:
        "Чтобы создать задачу, выберите аккаунты на странице логов (в uproject) и запустите задачу.",
    };
    workerViewCache.set(cacheKey, result, 25000);
    return result;
  } catch (error) {
    if (/Нет аккаунта сайтов|Неверный логин/i.test(String(error.message || ""))) {
      throw error;
    }
    return {
      tasks: [],
      message:
        "На данной странице отображаются задачи. Создайте задачу из раздела логов.",
    };
  }
}

module.exports = {
  listWorkerLogs,
  listWorkerTasks,
  getSteamTaskById,
};
