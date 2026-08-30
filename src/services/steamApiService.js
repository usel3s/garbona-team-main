const axios = require("axios");
const { env } = require("../config/env");
const {
  withPanelRetry,
  isServiceUnavailable,
  markServiceUnavailable,
  isServiceUnavailableError,
} = require("./apiService");
const { createTtlCache } = require("../utils/ttlCache");

const keyHeaders = { "x-api-key": env.uprojectApiKey };
const TIMEOUT_MS = 20000;
const steamCache = createTtlCache({ defaultTtlMs: 25000, maxEntries: 200 });
const ACCOUNTS_TTL_MS = 25000;

/** Как веб-панель: cookie token без team x-api-key. */
function panelApi(token) {
  return axios.create({
    baseURL: env.uprojectApiBase,
    timeout: TIMEOUT_MS,
    headers: {
      Cookie: `token=${token}`,
      Origin: "https://uproject.io",
      Referer: "https://uproject.io/",
    },
  });
}

function keyClient() {
  return axios.create({
    baseURL: env.uprojectApiBase,
    timeout: TIMEOUT_MS,
    headers: keyHeaders,
  });
}

function accountsCacheKey(token, query) {
  const scope = token ? `u:${String(token).slice(0, 32)}` : "team";
  const stable = Object.keys(query || {}).sort().map((key) => `${key}:${JSON.stringify(query[key])}`).join("|");
  return `accounts:${scope}:${stable}`;
}

async function steamRequest(token, method, path, { params, data } = {}) {
  if (isServiceUnavailable()) {
    const err = new Error("Панель сайтов временно недоступна. Попробуйте чуть позже.");
    err.response = { status: 503 };
    throw err;
  }
  try {
    return await withPanelRetry(async () => {
      const client = token ? panelApi(token) : keyClient();
      return (await client.request({ method, url: path, params, data })).data;
    });
  } catch (error) {
    if (isServiceUnavailableError(error)) markServiceUnavailable(120000);
    throw error;
  }
}

async function steamGet(token, path, params) {
  return steamRequest(token, "GET", path, { params });
}

async function getSteamInfo() {
  return steamCache.getOrSet(
    "steam:info",
    () => steamGet(null, env.steamInfoUrl.replace(env.uprojectApiBase, "") || "/steam/info"),
    60 * 1000
  );
}

async function getSteamAccounts(token, query = {}) {
  const params = { ...query, limit: Math.min(100, Math.max(1, Number(query.limit) || 50)) };
  const skipCache = Boolean(params.skipCache);
  delete params.skipCache;
  if (skipCache) {
    return steamGet(token, "/steam/accounts", params);
  }
  const key = accountsCacheKey(token, params);
  return steamCache.getOrSet(
    key,
    () => steamGet(token, "/steam/accounts", params),
    ACCOUNTS_TTL_MS
  );
}

function invalidateSteamAccountsCache(token) {
  if (token) {
    steamCache.invalidatePrefix(`accounts:u:${String(token).slice(0, 32)}`);
  } else {
    steamCache.invalidatePrefix("accounts:team");
  }
}

async function getSteamAccountById(token, accountId) {
  const id = String(accountId || "").trim();
  if (!id) throw new Error("Account id is required");
  try {
    return await steamGet(token, `/steam/accounts/${id}`);
  } catch (error) {
    const status = Number(error?.response?.status || 0);
    if (status !== 404) throw error;
    const list = await getSteamAccounts(token, { search: id, limit: 10 });
    const rows = Array.isArray(list?.rows)
      ? list.rows
      : Array.isArray(list?.data)
        ? list.data
        : [];
    const match = rows.find((row) => String(row?.id || "") === id) || rows[0] || null;
    if (!match) throw error;
    return match;
  }
}

async function getSteamStats() {
  return steamGet(null, "/steam/stats");
}

async function getSteamWorkersStats(workerId) {
  return steamGet(null, "/steam/stats/workers", { id: workerId });
}

async function getSteamAccountGames(accountId) {
  return steamGet(null, `/steam/accounts/${accountId}/games`);
}

async function getSteamEmail(username, email) {
  return steamGet(null, "/steam/accounts/get-email", { username, email });
}

async function downloadSteamAccount(accountId) {
  return steamGet(null, `/steam/accounts/${accountId}/download`);
}

async function getSteamTwoFactorCode(accountId) {
  return steamGet(null, `/steam/accounts/${accountId}/2fa/code`);
}

async function getSteamTwoFactorConfirmations(accountId, params = {}) {
  return steamGet(null, `/steam/accounts/${accountId}/2fa/confirmations`, params);
}

async function actOnSteamTwoFactorConfirmation(accountId, payload) {
  return steamRequest(null, "POST", `/steam/accounts/${accountId}/2fa/confirmations`, { data: payload });
}

async function exportSteamAccounts(ids) {
  return steamGet(null, "/steam/export", { ids });
}

async function setSteamAccountStatus(accountId, status) {
  const result = await steamRequest(null, "POST", `/steam/accounts/${accountId}/status`, { data: { status } });
  invalidateSteamAccountsCache();
  return result;
}

async function setSteamAccountTags(accountId, payload) {
  const result = await steamRequest(null, "POST", `/steam/accounts/${accountId}/tag`, { data: payload });
  invalidateSteamAccountsCache();
  return result;
}

async function createSteamTask({ tasks, ids, name }) {
  const result = await steamRequest(null, "POST", "/steam/tasks", { data: { tasks, ids, name } });
  invalidateSteamAccountsCache();
  return result;
}

async function getSteamTasks(params = {}) {
  return steamGet(null, "/steam/tasks", params);
}

async function getSteamTask(taskId) {
  return steamGet(null, `/steam/tasks/${taskId}`);
}

async function cancelSteamTask(taskId) {
  return steamRequest(null, "POST", `/steam/tasks/cancel/${taskId}`);
}

async function getSteamHandlerAccounts(kind, params = {}) {
  if (!new Set(["mafile", "log"]).has(kind)) throw new Error("Неизвестный обработчик Steam");
  return steamGet(null, `/steam/handlers/${kind}`, params);
}

async function requestSteamHandlerAccounts(kind) {
  if (!new Set(["mafile", "log"]).has(kind)) throw new Error("Неизвестный обработчик Steam");
  return steamRequest(null, "POST", `/steam/handlers/${kind}`);
}

async function updateSteamHandlerAccount(kind, payload) {
  if (!new Set(["mafile", "log"]).has(kind)) throw new Error("Неизвестный обработчик Steam");
  return steamRequest(null, "POST", `/steam/handlers/${kind}/update`, { data: payload });
}

function unwrapApiPayload(payload, terminalKeys = []) {
  let value = payload;
  for (let i = 0; i < 5 && value && typeof value === "object"; i += 1) {
    if (terminalKeys.some((key) => value[key] != null)) break;
    const next = ["data", "result", "inventory", "task"]
      .map((key) => value[key])
      .find((candidate) => candidate && typeof candidate === "object");
    if (!next || next === value) break;
    value = next;
  }
  return value || {};
}

async function createCheckValidTask(id) {
  steamCache.invalidatePrefix("accounts:");
  const response = (
    await withPanelRetry(() =>
      axios.post(
        env.steamTasksUrl,
        { tasks: [{ task: "CheckValid" }], ids: [Number(id)], name: "Проверка на валид" },
        { timeout: TIMEOUT_MS, headers: keyHeaders }
      )
    )
  ).data;
  return unwrapApiPayload(response, ["id", "state", "status"]);
}

async function getSteamTaskById(taskId) {
  const response = (
    await withPanelRetry(() =>
      axios.get(`${env.steamTaskByIdUrl}/${taskId}`, { timeout: TIMEOUT_MS, headers: keyHeaders })
    )
  ).data;
  return unwrapApiPayload(response, ["id", "state", "status"]);
}

async function getSteamInventory(steamId, token = null) {
  const sid = String(steamId || "").trim();
  if (!sid) throw new Error("Steam ID не указан");
  const path = `${env.steamInventoryUrl.replace(env.uprojectApiBase, "")}/${encodeURIComponent(sid)}`;
  const response = token
    ? await steamGet(token, path)
    : (
        await withPanelRetry(() =>
          axios.get(`${env.steamInventoryUrl}/${encodeURIComponent(sid)}`, {
            timeout: TIMEOUT_MS,
            headers: keyHeaders,
          })
        )
      ).data;
  return unwrapApiPayload(response, ["price", "inventories", "items"]);
}

/**
 * Read-only inventory fetch that ignores the global UProject circuit breaker.
 * Account endpoints can 502 while /steam/inventory/:steamid still works —
 * Telegram cards should prefer this path instead of failing with "перегружен".
 */
async function getSteamInventorySoft(steamId, token = null) {
  const sid = String(steamId || "").trim();
  // SteamID64 is 17 digits and starts with 7656119. Reject UProject account ids.
  if (!/^7656119\d{10}$/.test(sid)) return null;
  try {
    if (token) {
      const path = `${env.steamInventoryUrl.replace(env.uprojectApiBase, "")}/${encodeURIComponent(sid)}`;
      const client = panelApi(token);
      const response = (await client.get(path)).data;
      return unwrapApiPayload(response, ["price", "inventories", "items"]);
    }
    const response = (
      await axios.get(`${env.steamInventoryUrl}/${encodeURIComponent(sid)}`, {
        timeout: Math.min(TIMEOUT_MS, 12000),
        headers: keyHeaders,
      })
    ).data;
    return unwrapApiPayload(response, ["price", "inventories", "items"]);
  } catch (_) {
    return null;
  }
}

module.exports = {
  getSteamInfo,
  getSteamAccounts,
  getSteamAccountById,
  getSteamStats,
  getSteamWorkersStats,
  getSteamAccountGames,
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
  createCheckValidTask,
  getSteamTaskById,
  getSteamInventory,
  getSteamInventorySoft,
  invalidateSteamAccountsCache,
  unwrapApiPayload,
};
