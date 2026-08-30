const SteamLog = require("../models/SteamLog");
const {
  getSteamAccounts,
  getSteamAccountById,
  getSteamStats,
  getSteamWorkersStats,
  getSteamAccountGames,
  getSteamInventory,
  getSteamInventorySoft,
  getSteamEmail,
  downloadSteamAccount,
  getSteamTwoFactorCode,
  getSteamTwoFactorConfirmations,
  actOnSteamTwoFactorConfirmation,
  exportSteamAccounts,
  setSteamAccountStatus,
  setSteamAccountTags,
  createSteamTask,
  getSteamTasks,
  getSteamTask,
  cancelSteamTask,
  getSteamHandlerAccounts,
  requestSteamHandlerAccounts,
  updateSteamHandlerAccount,
} = require("./steamApiService");
const { getUserByPanelUsername } = require("./userService");
const { periodSince } = require("./adminStatsService");

const accountCache = new Map();
const ACCOUNT_CACHE_TTL_MS = 15 * 60 * 1000;
const ACCOUNT_CACHE_MAX = 500;

const TASKS = new Set([
  "CheckValid",
  "GetMail",
  "SellLZT",
  "UnlockRed",
  "MaFileLock",
  "MaFileToLog",
]);
const STATUSES = new Set([
  "Ok", "Invalid", "InvalidSession", "Processing", "OnProcessing", "Empty", "MaFile",
  "Sold", "OnHandle", "OnSell", "OnHold", "Processed", "InvalidRCode", "Locked",
  "Restored", "Converted", "RedLocked",
]);
const STATUS_LABELS = {
  Ok: "Валид", Invalid: "Невалид", InvalidSession: "Невалидная сессия",
  Processing: "На снятии", OnProcessing: "В обработке", Empty: "Пустой", MaFile: "MaFile",
  Sold: "Продан", OnHandle: "Обрабатывается", OnSell: "На продаже", OnHold: "На удержании",
  Processed: "Обработан", InvalidRCode: "Неверный RCode", Locked: "Заблокирован",
  Restored: "Восстановлен", Converted: "Конвертирован", RedLocked: "КТ",
};

function asArray(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function boolParam(value) {
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  return undefined;
}

function numberParam(value) {
  if (value === "" || value == null) return undefined;
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}

function rowIsMafile(row) {
  return row?.isMaFile === true
    || row?.localMafile != null
    || /mafile/i.test(String(row?.status || ""));
}

function firstDateValue(...values) {
  for (const value of values) {
    if (value == null || value === false || value === "") continue;
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function flagIsFalse(value) {
  return value === false || value === 0 || value === "false" || value === "0";
}

function flagIsTrue(value) {
  return value === true || value === 1 || value === "true" || value === "1";
}

function pickNested(row, keys) {
  const bags = [row, row?.session, row?.mafileSession, row?.steamInfo, row?.mafileSnapshot];
  for (const bag of bags) {
    if (!bag || typeof bag !== "object") continue;
    for (const key of keys) {
      if (bag[key] != null && bag[key] !== "") return bag[key];
    }
  }
  return undefined;
}

function resolveSessionCheckedAt(row) {
  return firstDateValue(
    pickNested(row, [
      "lastCheckDate",
      "lastCheckedAt",
      "lastCheckAt",
      "checkedAt",
      "sessionCheckedAt",
      "lastValidCheck",
      "lastCheck",
      "invalidDate",
    ]),
    row?.invalidDate,
  );
}

/** UProject red-light: MaFile still listed, but session check failed. */
function isMafileSessionInvalid(row) {
  const status = String(row?.status || "").trim();
  if (/invalidsession/i.test(status)) return true;
  if (flagIsTrue(pickNested(row, ["sessionInvalid", "isSessionInvalid", "mafileSessionInvalid", "invalidSession"]))) {
    return true;
  }
  if (flagIsFalse(pickNested(row, [
    "sessionValid",
    "isSessionValid",
    "mafileSessionValid",
    "validSession",
    "isValidSession",
  ]))) {
    return true;
  }
  if (pickNested(row, ["session"])?.valid === false) return true;
  const sessionStatus = String(pickNested(row, ["sessionStatus", "mafileSessionStatus"]) || "");
  if (/invalid|невалид/i.test(sessionStatus)) return true;
  if (!rowIsMafile(row) && !/mafile/i.test(status)) return false;
  if (row?.invalidDate) return true;
  if (/^(invalid|невалид)$/i.test(status) || (/невалид|invalid/i.test(status) && !/mafile/i.test(status))) {
    return true;
  }
  return false;
}

const POST_MAFILE_STATUSES = new Set([
  "Empty", "OnSell", "OnHold", "Sold", "Processing", "OnProcessing",
  "OnHandle", "Processed", "Locked", "Restored", "Converted", "RedLocked",
]);

function lookupStatusKey(status) {
  const raw = String(status || "").trim();
  if (!raw) return "";
  if (/^прода[её]тся$/i.test(raw) || /^на\s*продаже$/i.test(raw)) return "OnSell";
  if (/^на\s*холде$/i.test(raw)) return "OnHold";
  if (STATUS_LABELS[raw]) return raw;
  const lower = raw.toLowerCase();
  const byKey = Object.keys(STATUS_LABELS).find((key) => key.toLowerCase() === lower);
  if (byKey) return byKey;
  return Object.keys(STATUS_LABELS).find((key) => String(STATUS_LABELS[key]).toLowerCase() === lower) || "";
}

function liveStatusAfterMafile(status) {
  const key = lookupStatusKey(status);
  return key && POST_MAFILE_STATUSES.has(key) ? key : "";
}

function hasUprojectInvalidDate(row) {
  const value = row?.invalidDate || row?.invalid_date || row?.invalidAt;
  if (value == null || value === false || value === "") return false;
  if (value === true) return true;
  const stamp = new Date(value).getTime();
  return Number.isFinite(stamp) ? stamp > 0 : Boolean(value);
}

/** Raw UProject status to persist; Ok + invalidDate means the log already died. */
function rawUprojectStatus(row) {
  const status = String(row?.status || "").trim();
  if (hasUprojectInvalidDate(row) && /^(ok|valid|валид)$/i.test(status)) return "Invalid";
  return status;
}

function statusLooksInvalid(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (/invalidsession|invalid rcode|невалидная сессия|неверн\w* rcode/i.test(raw)) return false;
  return /^(invalid|невалид)$/i.test(raw) || (/невалид|invalid/i.test(raw) && !/mafile/i.test(raw));
}

function preferWorkerStatus(primary, fallback) {
  const a = String(primary || "").trim();
  const b = String(fallback || "").trim();
  if (statusLooksInvalid(a)) return a;
  if (statusLooksInvalid(b)) return b;
  return a || b;
}

/** Worker-facing status from live UProject fields — never hide Invalid behind isMaFile. */
function classifyWorkerAccountStatus(row) {
  const status = String(row?.status || "").trim();
  if (/invalidsession/i.test(status)) return STATUS_LABELS.InvalidSession;
  if (/invalidrcode/i.test(status)) return STATUS_LABELS.InvalidRCode;
  if (
    /^(invalid|невалид)$/i.test(status)
    || (/невалид|invalid/i.test(status) && !/mafile/i.test(status))
    || (hasUprojectInvalidDate(row) && !rowIsMafile(row) && !/mafile/i.test(status))
  ) {
    return STATUS_LABELS.Invalid;
  }
  const liveKey = liveStatusAfterMafile(status);
  if (liveKey === "OnSell") return "Продается";
  if (liveKey) return STATUS_LABELS[liveKey];
  if (rowIsMafile(row) || /mafile/i.test(status)) return STATUS_LABELS.MaFile;
  if (/^(ok|valid|валид)$/i.test(status) && !row?.invalidDate) return STATUS_LABELS.Ok;
  const mappedKey = lookupStatusKey(status);
  if (mappedKey === "OnSell") return "Продается";
  if (mappedKey) return STATUS_LABELS[mappedKey];
  if (/onsell|на\s*продаж|прода[её]тся/i.test(status)) return "Продается";
  if (/empty|пуст/i.test(status)) return STATUS_LABELS.Empty;
  return status || "—";
}

function serializeWorkerMafileSession(row, now = Date.now()) {
  const at = resolveMafileSessionAt(row);
  const hoursLeft = mafileSessionHoursLeft(at, now);
  const status = String(row?.status || "");
  const converted = Boolean(liveStatusAfterMafile(status));
  const isMf = !converted && (rowIsMafile(row) || /mafile/i.test(status));
  const sessionInvalid = isMafileSessionInvalid(row);
  return {
    eventType: isMf ? "mafile" : "log",
    mafileTime: String(at || ""),
    mafileSessionAvailableAt: String(at || ""),
    mafileSessionHoursLeft: hoursLeft,
    mafileSessionUnlocked: !isMf || hoursLeft <= 0,
    sessionInvalid,
    sessionCheckedAt: resolveSessionCheckedAt(row),
  };
}

/** UProject session unlock time (~48h after MaFile). ISO date or remaining hours. */
function resolveMafileSessionAt(row) {
  return (
    row?.mafileSessionAvailableAt
    || row?.maFileSessionAvailableAt
    || row?.mafileTime
    || row?.maFileTime
    || row?.mafileSnapshot?.mafileTime
    || ""
  );
}

function mafileSessionHoursLeft(value, now = Date.now()) {
  if (value == null || value === "") return 0;
  const raw = String(value).trim();
  if (!raw) return 0;
  const asNumber = Number(raw);
  const looksNumeric = Number.isFinite(asNumber) && !/[T:-]/i.test(raw) && asNumber < 10000;
  if (looksNumeric) return Math.max(0, Math.ceil(asNumber));
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.ceil((date.getTime() - now) / 3600000));
}

function enrichMafileSession(rows, now = Date.now()) {
  return (rows || []).map((row) => {
    const session = serializeWorkerMafileSession(row, now);
    const isMf = session.eventType === "mafile";
    return {
      ...row,
      ...session,
      mafileSessionLabel: isMf
        ? (session.sessionInvalid
          ? "невалид"
          : (session.mafileSessionHoursLeft > 0 ? `${session.mafileSessionHoursLeft} ч` : "анлок"))
        : "",
    };
  });
}

function extractAccountRows(payload) {
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function buildAccountsQuery(input = {}) {
  const query = {
    page: Math.max(0, Number(input.page) || 0),
    limit: Math.min(100, Math.max(1, Number(input.limit) || 50)),
  };
  const search = String(input.search || input.q || "").trim();
  if (search) query.search = search;
  const statuses = asArray(input.statuses || input.status);
  if (statuses.length) query.statuses = statuses;
  const games = asArray(input.games);
  if (games.length) query.games = games;
  const workers = asArray(input.workers);
  if (workers.length) query.workers = workers;
  for (const [source, target] of [
    ["mafile_only", "mafile_only"], ["steam_limit", "steam_limit"], ["unlocked", "unlocked"], ["is_prime", "is_prime"],
  ]) {
    const value = boolParam(input[source]);
    if (value !== undefined) query[target] = value;
  }
  for (const key of ["level_from", "level_to", "balance_from", "balance_to", "inv_from", "inv_to", "elo_from", "elo_to"]) {
    const value = numberParam(input[key]);
    if (value !== undefined) query[key] = value;
  }
  return query;
}

function inventoryUsd(row) {
  const price = row?.inventory?.price || {};
  return Number(price.tradable ?? price.marketable ?? price.total ?? 0) || 0;
}

function totalUsd(row) {
  return Number(((Number(row?.steamInfo?.balanceUsd || 0) || 0) + inventoryUsd(row)).toFixed(2));
}

function normalizeAccount(row, localLog) {
  const steam = row?.steamInfo || {};
  const mafileSessionAvailableAt = String(
    resolveMafileSessionAt(row)
      || localLog?.mafileSnapshot?.mafileTime
      || localLog?.mafileTime
      || ""
  );
  return {
    ...row,
    id: String(row?.id || ""),
    statusLabel: STATUS_LABELS[row?.status] || String(row?.status || "—"),
    steamId: String(steam.steamid || ""),
    profileUrl: steam.steamid ? `https://steamcommunity.com/profiles/${steam.steamid}/` : "",
    avatarUrl: steam.avatarHash && !/^0+$/.test(steam.avatarHash)
      ? `https://avatars.steamstatic.com/${steam.avatarHash}_medium.jpg`
      : "",
    inventoryUsd: inventoryUsd(row),
    totalUsd: totalUsd(row),
    accountTag: String(localLog?.accountTag || row?.customTeamTag || row?.customTag || ""),
    mafileSessionAvailableAt,
    localMafile: localLog?.logKind === "mafile" ? {
      status: localLog.mafileStatus || "pending",
      withdrawnAmount: Number(localLog.mafileWithdrawnAmount || 0),
      workerShare: Number(localLog.mafileWorkerShare || 0),
      workerPercent: Number(localLog.mafileWorkerPercent || 0),
      channelMessageId: String(localLog.channelMessageId || ""),
    } : null,
  };
}

function rememberAccounts(rows) {
  const now = Date.now();
  for (const row of rows || []) {
    const id = String(row?.id || "").trim();
    if (!id) continue;
    accountCache.delete(id);
    accountCache.set(id, { account: row, cachedAt: now });
  }
  while (accountCache.size > ACCOUNT_CACHE_MAX) {
    accountCache.delete(accountCache.keys().next().value);
  }
  return rows;
}

function cachedAccount(accountId) {
  const id = String(accountId || "").trim();
  const entry = accountCache.get(id);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > ACCOUNT_CACHE_TTL_MS) {
    accountCache.delete(id);
    return null;
  }
  return entry.account;
}

function getCachedControlledAccount(accountId) {
  return cachedAccount(accountId);
}

function isTransientUpstreamError(error) {
  const status = Number(error?.response?.status || error?.status || 0);
  const code = String(error?.code || "").toUpperCase();
  return (
    status >= 500 ||
    ["ECONNRESET", "ECONNABORTED", "ETIMEDOUT", "EAI_AGAIN", "ENETUNREACH"].includes(code)
  );
}

async function attachLocalState(rows) {
  const ids = (rows || []).map((row) => String(row.id || "")).filter(Boolean);
  const local = ids.length ? await SteamLog.find({ sourceId: { $in: ids } }).lean() : [];
  const byId = new Map(local.map((row) => [String(row.sourceId), row]));
  return (rows || []).map((row) => normalizeAccount(row, byId.get(String(row.id))));
}

function accountCreatedAt(row) {
  const raw = row?.createdAt || row?.date || row?.created_at;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function matchesPeriod(row, since) {
  if (!since) return true;
  const created = accountCreatedAt(row);
  if (!created) return false;
  return created >= since;
}

function matchesMafileUnlocked(row, filter) {
  if (filter === undefined) return true;
  if (!rowIsMafile(row)) return false;
  return Boolean(row.mafileSessionUnlocked) === filter;
}

function paginateRows(rows, page, pageSize) {
  const totalCount = rows.length;
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize) || 1);
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const start = safePage * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    totalCount,
    pageCount,
    page: safePage,
  };
}

function matchesStatuses(row, statuses) {
  if (!statuses?.length) return true;
  return statuses.includes(String(row.status || ""));
}

function matchesQueryFilters(row, baseQuery, { since, mafileUnlockedFilter }) {
  if (!matchesPeriod(row, since)) return false;
  if (!matchesMafileUnlocked(row, mafileUnlockedFilter)) return false;
  if (!matchesStatuses(row, baseQuery.statuses)) return false;
  return true;
}

async function scanControlledAccounts(baseQuery, { since, mafileUnlockedFilter, page, pageSize }) {
  const matched = [];
  const maxPages = 50;
  for (let upage = 0; upage < maxPages; upage += 1) {
    const payload = await getSteamAccounts(null, { ...baseQuery, page: upage, limit: 100 });
    const rows = extractAccountRows(payload);
    if (!rows.length) break;
    const normalized = enrichMafileSession(await attachLocalState(rows));
    for (const row of normalized) {
      if (!matchesQueryFilters(row, baseQuery, { since, mafileUnlockedFilter })) continue;
      matched.push(row);
    }
    if (rows.length < 100) break;
  }
  rememberAccounts(matched);
  return paginateRows(matched, page, pageSize);
}

async function listControlledAccounts(input = {}) {
  const query = buildAccountsQuery(input);
  const mafileUnlockedFilter = boolParam(input.mafile_unlocked);
  const period = String(input.period || "all");
  const since = periodSince(period);
  const needsScan = Boolean(since) || mafileUnlockedFilter !== undefined;

  if (!needsScan) {
    const payload = await getSteamAccounts(null, query);
    const rows = extractAccountRows(payload);
    const normalized = enrichMafileSession(await attachLocalState(rows));
    rememberAccounts(normalized);
    return { ...payload, rows: normalized, query: { ...query, period } };
  }

  const pageSize = query.limit;
  const targetPage = Math.max(0, query.page);
  const scanQuery = {
    ...query,
    page: 0,
    limit: 100,
  };
  if (mafileUnlockedFilter !== undefined) {
    scanQuery.mafile_only = true;
    if (!scanQuery.statuses?.length) scanQuery.statuses = ["MaFile"];
  }

  const result = await scanControlledAccounts(scanQuery, {
    since,
    mafileUnlockedFilter,
    page: targetPage,
    pageSize,
  });

  return {
    ...result,
    query: {
      ...scanQuery,
      page: result.page,
      limit: pageSize,
      mafile_unlocked: mafileUnlockedFilter,
      period,
    },
  };
}

async function getControlledAccount(accountId, { preferCache = false } = {}) {
  const id = String(accountId);
  const cached = cachedAccount(id);
  if (preferCache && cached) return cached;
  try {
    const row = await getSteamAccountById(null, id);
    const account = row?.data || row?.account || row;
    const normalized = enrichMafileSession(await attachLocalState([account]))[0];
    rememberAccounts([normalized]);
    return normalized;
  } catch (error) {
    if (cached && isTransientUpstreamError(error)) return cached;
    throw error;
  }
}

async function runAccountTask({ task, ids, name }) {
  if (!TASKS.has(String(task))) throw new Error("Недоступная операция UProject");
  const safeIds = asArray(ids).map(Number).filter(Number.isFinite);
  if (!safeIds.length || safeIds.length > 100) throw new Error("Выберите от 1 до 100 логов");
  return createSteamTask({ tasks: [{ task: String(task) }], ids: safeIds, name: String(name || STATUS_LABELS[task] || task) });
}

async function changeAccountStatus(accountId, status) {
  if (!STATUSES.has(String(status))) throw new Error("Недоступный статус UProject");
  return setSteamAccountStatus(String(accountId), String(status));
}

function tagPayloadCandidates(customTag, customTeamTag) {
  const primary = customTeamTag || customTag;
  return [
    { customTag, customTeamTag },
    { custom_tag: customTag, custom_team_tag: customTeamTag },
    { tag: primary },
    { customTag: primary },
    { customTeamTag: primary },
  ].filter((payload, index, list) => {
    const normalized = JSON.stringify(payload);
    return list.findIndex((item) => JSON.stringify(item) === normalized) === index;
  });
}

async function trySetAccountTags(accountId, customTag, customTeamTag) {
  let lastError = null;
  for (const candidate of tagPayloadCandidates(customTag, customTeamTag)) {
    try {
      return { synced: true, result: await setSteamAccountTags(accountId, candidate), payload: candidate };
    } catch (error) {
      lastError = error;
      const status = Number(error?.response?.status || 0);
      if (status && status !== 400 && status !== 422) break;
    }
  }
  return {
    synced: false,
    result: null,
    error: lastError?.response?.data?.message || lastError?.message || "Remote tag sync failed",
  };
}

async function changeAccountTags(accountId, payload = {}) {
  const id = String(accountId);
  const customTag = String(payload.customTag || "").slice(0, 80);
  const customTeamTag = String(payload.customTeamTag || "").slice(0, 80);
  const remote = await trySetAccountTags(id, customTag, customTeamTag);
  let ownerTelegramId = "";
  try {
    const raw = await getSteamAccountById(null, id);
    const account = raw?.data || raw?.account || raw || {};
    ownerTelegramId = String(account?.owner?.telegram || "");
    if (!ownerTelegramId && account?.owner?.username) {
      ownerTelegramId = String((await getUserByPanelUsername(account.owner.username))?.telegramId || "");
    }
  } catch (_) {
    /* remote tag was saved; local owner enrichment is best effort */
  }
  await SteamLog.findOneAndUpdate(
    { sourceId: id },
    {
      $set: {
        accountTag: customTeamTag || customTag,
        ...(ownerTelegramId ? { ownerTelegramId } : {}),
      },
      $setOnInsert: { sourceId: id },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );
  return remote;
}

async function getAccountInventory(accountId) {
  const account = await getControlledAccount(accountId);
  const steamId = String(account?.steamInfo?.steamid || account?.steamId || "").trim();
  let inventory = account?.inventory && typeof account.inventory === "object" ? account.inventory : null;
  if (/^7656119\d{10}$/.test(steamId)) {
    inventory =
      (await getSteamInventorySoft(steamId)) ||
      (await getSteamInventory(steamId).catch(() => null)) ||
      inventory;
  }
  return { account, inventory: inventory || { price: {}, inventories: [] } };
}

async function getAccountEmail(accountId) {
  const account = await getControlledAccount(accountId);
  return getSteamEmail(account.username, account.steamInfo?.email || "");
}

module.exports = {
  TASKS,
  STATUSES,
  STATUS_LABELS,
  buildAccountsQuery,
  tagPayloadCandidates,
  resolveMafileSessionAt,
  mafileSessionHoursLeft,
  enrichMafileSession,
  rowIsMafile,
  isMafileSessionInvalid,
  resolveSessionCheckedAt,
  classifyWorkerAccountStatus,
  rawUprojectStatus,
  preferWorkerStatus,
  serializeWorkerMafileSession,
  listControlledAccounts,
  getControlledAccount,
  getCachedControlledAccount,
  getSteamStats,
  getSteamWorkersStats,
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
};
