const axios = require("axios");
const FormData = require("form-data");
const { createHash } = require("crypto");
const { env } = require("../config/env");
const { createTtlCache } = require("../utils/ttlCache");

const PANEL_TIMEOUT_MS = 25000;
const TOKEN_TTL_MS = 8 * 60 * 1000;
const tokenCache = new Map();
const panelDataCache = createTtlCache({ defaultTtlMs: 45000, maxEntries: 800 });

const CACHE_TTL = {
  // Статистика/онлайн на UProject обновляются часто — длинный TTL даёт «отстающую» конверсию.
  domains: 8000,
  links: 8000,
  templates: 5 * 60 * 1000,
  workers: 2 * 60 * 1000,
  ips: 5 * 60 * 1000,
  ns: 5 * 60 * 1000,
};

/** Global pause after uproject 502/503 — shared by poller and panel. */
let serviceUnavailableUntil = 0;

const baseClient = axios.create({
  baseURL: env.uprojectApiBase,
  timeout: PANEL_TIMEOUT_MS,
  headers: { "x-api-key": env.uprojectApiKey },
});

function getAccessToken(payload) {
  return payload?.accessToken || payload?.token || payload?.data?.accessToken || payload?.data?.token || "";
}

function isTimeoutError(error) {
  return error?.code === "ECONNABORTED" || /timeout/i.test(String(error?.message || ""));
}

function isServiceUnavailableError(error) {
  const status = error?.response?.status;
  return status === 502 || status === 503 || status === 504;
}

function markServiceUnavailable(ms = 120000) {
  serviceUnavailableUntil = Math.max(serviceUnavailableUntil, Date.now() + ms);
}

function isServiceUnavailable() {
  return Date.now() < serviceUnavailableUntil;
}

function serviceUnavailableMsLeft() {
  return Math.max(0, serviceUnavailableUntil - Date.now());
}

/**
 * Клиент от имени воркера — как в веб-панели:
 * Cookie token=… без x-api-key команды, иначе owner ссылок = владелец API-ключа.
 */
function panelClient(token) {
  return axios.create({
    baseURL: env.uprojectApiBase,
    timeout: PANEL_TIMEOUT_MS,
    headers: {
      Cookie: `token=${token}`,
      Origin: "https://uproject.io",
      Referer: "https://uproject.io/",
    },
  });
}

async function withPanelRetry(request, { retries = 1 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (isServiceUnavailable()) {
      const err = new Error("Панель сайтов временно недоступна. Попробуйте чуть позже.");
      err.response = { status: 503 };
      throw err;
    }
    try {
      return await request();
    } catch (error) {
      lastError = error;
      // Don't retry 502/503/504 — uproject is overloaded; pause everyone.
      if (isServiceUnavailableError(error)) {
        markServiceUnavailable(120000);
        throw error;
      }
      if (isTimeoutError(error) && attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

async function createWorkerAccount(username, password) {
  const response = await withPanelRetry(() =>
    baseClient.post(env.uprojectApiUrl.replace(env.uprojectApiBase, ""), { username, password })
  );
  return response.data;
}

/** Логин как в веб-панели — без x-api-key команды. Кэш токена снижает нагрузку. */
async function authCredentials(username, password) {
  const key = `${String(username || "").toLowerCase()}::${String(password || "")}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() && cached.token) {
    return { token: cached.token, data: cached.data };
  }

  const response = await withPanelRetry(() =>
    axios.post(
      `${env.uprojectApiBase}/auth/credentials`,
      { username, password },
      { timeout: PANEL_TIMEOUT_MS }
    )
  );
  const token = getAccessToken(response.data);
  if (token) {
    tokenCache.set(key, {
      token,
      data: response.data,
      expiresAt: Date.now() + TOKEN_TTL_MS,
    });
  }
  return { token, data: response.data };
}

async function getUserSettings(token) {
  return (
    await withPanelRetry(() => panelClient(token).get("/users/settings"), { retries: 2 })
  ).data;
}

async function saveUserSettings(token, settings) {
  return (
    await withPanelRetry(() => panelClient(token).post("/users/settings", settings), {
      retries: 2,
    })
  ).data;
}

function invalidatePanelToken(username) {
  const prefix = `${String(username || "").toLowerCase()}::`;
  for (const key of tokenCache.keys()) {
    if (key.startsWith(prefix)) tokenCache.delete(key);
  }
}

function cacheScope(token) {
  // JWT headers are identical between users; hash the complete token to isolate accounts.
  return `t:${createHash("sha256").update(String(token || "")).digest("hex").slice(0, 32)}`;
}

function invalidatePanelData(token) {
  panelDataCache.invalidatePrefix(cacheScope(token));
}

function invalidateTeamDomainCaches() {
  panelDataCache.invalidatePrefix("team:domains");
  panelDataCache.invalidatePrefix("team:ns");
}

function invalidateDomainCaches(token) {
  const s = cacheScope(token);
  panelDataCache.invalidatePrefix(`${s}:domains`);
  panelDataCache.invalidatePrefix(`${s}:links`);
  panelDataCache.invalidatePrefix(`${s}:list`);
  invalidateTeamDomainCaches();
}

function invalidateTemplateCaches(token) {
  panelDataCache.invalidatePrefix(`${cacheScope(token)}:templates`);
}

async function getDomains(token, offset = 0, limit = 15) {
  const key = `${cacheScope(token)}:domains:${offset}:${limit}`;
  return panelDataCache.getOrSet(
    key,
    async () =>
      (await withPanelRetry(() => panelClient(token).get("/domains", { params: { offset, limit } }))).data,
    CACHE_TTL.domains
  );
}
async function getDomainsList(token) {
  const key = `${cacheScope(token)}:list`;
  return panelDataCache.getOrSet(
    key,
    async () => (await withPanelRetry(() => panelClient(token).get("/domains/list"))).data,
    CACHE_TTL.domains
  );
}
async function getAllDomainsForToken(token) {
  const rows = [];
  const seen = new Set();
  const pushChunk = (chunk) => {
    let added = 0;
    for (const row of chunk || []) {
      const id = Number(row?.id);
      if (!Number.isFinite(id) || id < 1 || seen.has(id)) continue;
      seen.add(id);
      rows.push(row);
      added += 1;
    }
    return added;
  };

  try {
    const listed = await getDomainsList(token);
    pushChunk(listed?.rows || listed?.data || listed?.domains || (Array.isArray(listed) ? listed : []));
  } catch {
    /* /domains/list может быть недоступен — ниже обычная пагинация */
  }

  let offset = 0;
  for (let page = 0; page < 40; page += 1) {
    const payload = await getDomains(token, offset, 100);
    const chunk = payload?.rows || payload?.data || [];
    const added = pushChunk(chunk);
    if (!chunk.length) break;
    if (payload?.hasNextPage) {
      const nextOffset = Number(payload?.lastId);
      offset = Number.isFinite(nextOffset) && nextOffset !== offset ? nextOffset : offset + chunk.length;
      continue;
    }
    if (chunk.length >= 100 && added) {
      offset += chunk.length;
      continue;
    }
    break;
  }
  return rows;
}
async function isDomainAvailable(token, domain) {
  return (await withPanelRetry(() => panelClient(token).get("/domains/isAvailable", { params: { domain } }))).data;
}

/**
 * Панель: 200 + { domain } = свободен; 409 = уже занят.
 * Флага isAvailable в ответе нет.
 */
async function checkDomainAvailability(token, domain) {
  try {
    const data = await isDomainAvailable(token, domain);
    if (typeof data === "boolean") return { available: data, data };
    if (data?.isAvailable === false || data?.available === false) {
      return { available: false, data, message: data?.message || "Домен недоступен." };
    }
    // Успешный ответ вида { domain: "kot1.cc" } — домен свободен.
    return { available: true, data };
  } catch (error) {
    const status = error?.response?.status;
    const message = error?.response?.data?.message || error.message;
    if (status === 409 || status === 400 || status === 422) {
      return { available: false, data: error.response?.data, message };
    }
    throw error;
  }
}
async function getActualIPs(token) {
  const key = `${cacheScope(token)}:ips`;
  return panelDataCache.getOrSet(
    key,
    async () => (await withPanelRetry(() => panelClient(token).get("/domains/actualIPs"))).data,
    CACHE_TTL.ips
  );
}
async function createDomain(token, payload) {
  const data = (await withPanelRetry(() => panelClient(token).post("/domains", payload))).data;
  invalidateDomainCaches(token);
  return data;
}
async function deleteDomain(token, domainId) {
  const data = (await withPanelRetry(() => panelClient(token).delete(`/domains/${domainId}`))).data;
  invalidateDomainCaches(token);
  return data;
}
/** Удаление старых доменов, созданных до перехода на нативный Cloudflare воркера. */
async function deleteLegacyTeamDomain(domainId) {
  const data = (
    await withPanelRetry(() => baseClient.delete(`/domains/${domainId}`), { retries: 0 })
  ).data;
  invalidateTeamDomainCaches();
  return data;
}
async function getCloudflareNameservers(token) {
  const key = `${cacheScope(token)}:ns`;
  return panelDataCache.getOrSet(
    key,
    async () => (await withPanelRetry(() => panelClient(token).get("/cloudflare/nameservers"))).data,
    CACHE_TTL.ns
  );
}

async function getSteamLinks(token, domainId, offset = 0, limit = 15) {
  const key = `${cacheScope(token)}:links:${domainId}:${offset}:${limit}`;
  return panelDataCache.getOrSet(
    key,
    async () =>
      (
        await withPanelRetry(() =>
          panelClient(token).get(`/steam/links/${domainId}`, { params: { offset, limit } })
        )
      ).data,
    CACHE_TTL.links
  );
}
async function getAllSteamLinks(token, domainId) {
  const rows = [];
  const seen = new Set();
  let offset = 0;
  for (let page = 0; page < 50; page += 1) {
    const payload = await getSteamLinks(token, domainId, offset, 100);
    const chunk = payload?.rows || payload?.data || [];
    let added = 0;
    for (const row of chunk) {
      const id = Number(row?.id);
      if (!Number.isFinite(id) || seen.has(id)) continue;
      seen.add(id);
      rows.push(row);
      added += 1;
    }
    if (!payload?.hasNextPage || !chunk.length || !added) break;
    const nextOffset = Number(payload?.lastId);
    offset = Number.isFinite(nextOffset) && nextOffset !== offset ? nextOffset : offset + chunk.length;
  }
  return { rows, hasNextPage: false, lastId: rows.at(-1)?.id ?? null };
}
async function getSteamLinkHistory(token, linkId) {
  return (
    await withPanelRetry(() =>
      panelClient(token).get(`/steam/links/history/${linkId}`)
    )
  ).data;
}
async function getTemplates(token, offset = 0, limit = 15, { search } = {}) {
  const q = String(search || "").trim();
  const key = `${cacheScope(token)}:templates:${offset}:${limit}:${q || "-"}`;
  return panelDataCache.getOrSet(
    key,
    async () => {
      const params = { offset, limit };
      if (q) params.search = q;
      return (await withPanelRetry(() => panelClient(token).get("/templates", { params }))).data;
    },
    CACHE_TTL.templates
  );
}

/**
 * UProject пагинирует шаблоны курсором: offset=0 → первая страница,
 * далее offset = lastId предыдущей страницы (не индекс строки).
 * Лимит API: максимум 100.
 */
async function getAllTemplates(token, { search } = {}) {
  const q = String(search || "").trim();
  const key = `${cacheScope(token)}:templates:all:${q || "-"}`;
  return panelDataCache.getOrSet(
    key,
    async () => {
      const rows = [];
      const seen = new Set();
      let offset = 0;
      for (let page = 0; page < 40; page += 1) {
        const payload = await getTemplates(token, offset, 100, { search: q });
        const chunk = payload?.rows || payload?.data || [];
        let added = 0;
        for (const row of chunk) {
          const id = Number(row?.id);
          if (!Number.isFinite(id) || seen.has(id)) continue;
          seen.add(id);
          rows.push(row);
          added += 1;
        }
        if (!payload?.hasNextPage || !chunk.length || !added) break;
        const nextOffset = Number(payload?.lastId);
        if (!Number.isFinite(nextOffset) || nextOffset === offset) break;
        offset = nextOffset;
      }
      return { rows, totalCount: rows.length };
    },
    CACHE_TTL.templates
  );
}

async function findTemplateById(token, templateId) {
  const id = Math.trunc(Number(templateId));
  if (!Number.isFinite(id) || id < 1) return null;

  try {
    const searched = await getTemplates(token, 0, 50, { search: String(id) });
    const fromSearch = (searched?.rows || searched?.data || []).find((row) => Number(row?.id) === id);
    if (fromSearch) return fromSearch;
  } catch {
    // search may be unsupported — fall through to full catalog
  }

  try {
    const all = await getAllTemplates(token);
    return (all?.rows || []).find((row) => Number(row?.id) === id) || null;
  } catch {
    return null;
  }
}

/**
 * Создание шаблона в Uproject (как в панели): multipart name + isPublic + service + HTML file.
 * @param {string} token
 * @param {{ name: string, isPublic?: boolean, code: string|Buffer, service?: string }} opts
 */
async function createTemplate(token, { name, isPublic = false, code, service = "Steam" } = {}) {
  const title = String(name || "").trim();
  if (!title) throw new Error("Укажите название шаблона");
  const html = typeof code === "string" ? code : Buffer.isBuffer(code) ? code.toString("utf8") : "";
  if (!String(html || "").trim()) throw new Error("Пришлите HTML-код шаблона");

  const form = new FormData();
  form.append("name", title);
  form.append("isPublic", isPublic === true || isPublic === "true" ? "true" : "false");
  form.append("service", String(service || "Steam"));
  form.append("file", Buffer.from(String(html), "utf8"), {
    filename: "template.html",
    contentType: "text/html",
  });

  const data = (
    await withPanelRetry(() =>
      panelClient(token).post("/templates", form, {
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 60000,
      })
    )
  ).data;
  invalidateTemplateCaches(token);
  return data;
}

async function deleteTemplate(token, templateId) {
  const id = Math.trunc(Number(templateId));
  if (!Number.isFinite(id) || id < 1) throw new Error("Некорректный ID шаблона");
  const data = (await withPanelRetry(() => panelClient(token).delete(`/templates/${id}`))).data;
  invalidateTemplateCaches(token);
  return data;
}

async function createSteamLink(token, payload) {
  // POST must not retry: a timeout after a successful create comes back as 409.
  const data = (
    await withPanelRetry(() => panelClient(token).post("/steam/links", payload), {
      retries: 0,
    })
  ).data;
  invalidateDomainCaches(token);
  return data;
}
const VALID_WINDOW_TYPES = new Set(["FakeWindow", "AboutBlank", "CurrentWindow", "NewWindow"]);

function normalizeWindowType(value) {
  return VALID_WINDOW_TYPES.has(value) ? value : "FakeWindow";
}

async function updateSteamLink(token, domainId, linkId, patch) {
  const domain = Math.trunc(Number(domainId));
  const id = Math.trunc(Number(linkId));
  if (!Number.isFinite(domain) || domain < 1) throw new Error("Некорректный ID домена");
  if (!Number.isFinite(id) || id < 1) throw new Error("Некорректный ID ссылки");
  const body = { id, ...patch };
  if (body.template != null) body.template = Math.trunc(Number(body.template));
  if (body.domain != null) body.domain = Math.trunc(Number(body.domain));
  if (body.windowType != null) body.windowType = normalizeWindowType(body.windowType);
  const client = panelClient(token);
  let data;
  try {
    data = (await withPanelRetry(() => client.patch(`/steam/links/${domain}`, body))).data;
  } catch (error) {
    if (error?.response?.status !== 404) throw error;
    data = (await withPanelRetry(() => client.patch(`/steam/links/${id}`, body))).data;
  }
  invalidateDomainCaches(token);
  return data;
}

const DELETED_LINK_PREFIX = "deleted_";

function isDeletedSteamLink(link) {
  const path = String(link?.path || "").replace(/^\/+/, "");
  return path.startsWith(DELETED_LINK_PREFIX);
}

function filterActiveSteamLinks(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter(
    (link) => link && typeof link === "object" && !isDeletedSteamLink(link)
  );
}

/**
 * Uproject не отдаёт DELETE для ссылок — «удаляем» сменой path + очисткой Mongo.
 */
async function deleteSteamLink(token, domainId, linkId, { windowType } = {}) {
  const tombstone = `${DELETED_LINK_PREFIX}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return updateSteamLink(token, domainId, linkId, {
    path: tombstone,
    windowType: normalizeWindowType(windowType || "FakeWindow"),
    randPath: false,
  });
}

/** Домены команды через x-api-key (без cookie воркера). */
async function getTeamDomains(offset = 0, limit = 50) {
  const key = `team:domains:${offset}:${limit}`;
  return panelDataCache.getOrSet(
    key,
    async () =>
      (await withPanelRetry(() => baseClient.get("/domains", { params: { offset, limit } }))).data,
    CACHE_TTL.domains
  );
}

async function getAllTeamDomains() {
  const rows = [];
  const seen = new Set();
  let offset = 0;
  for (let page = 0; page < 40; page += 1) {
    const payload = await getTeamDomains(offset, 100);
    const chunk = payload?.rows || payload?.data || [];
    let added = 0;
    for (const row of chunk) {
      const id = Number(row?.id);
      if (!Number.isFinite(id) || seen.has(id)) continue;
      seen.add(id);
      rows.push(row);
      added += 1;
    }
    if (!payload?.hasNextPage || !chunk.length || !added) break;
    const nextOffset = Number(payload?.lastId);
    if (Number.isFinite(nextOffset) && nextOffset !== offset) {
      offset = nextOffset;
    } else {
      offset += chunk.length;
    }
  }
  return { rows, totalCount: rows.length };
}

async function getTeamWorkers(token, offset = 0, limit = 100) {
  const key = `${cacheScope(token)}:workers:${offset}:${limit}`;
  return panelDataCache.getOrSet(
    key,
    async () =>
      (
        await withPanelRetry(() =>
          panelClient(token).get("/teams/workers/list", { params: { offset, limit } })
        )
      ).data,
    CACHE_TTL.workers
  );
}

async function getAllTeamWorkers(token) {
  const rows = [];
  const seen = new Set();
  let offset = 0;
  for (let page = 0; page < 40; page += 1) {
    const payload = await getTeamWorkers(token, offset, 100);
    const chunk = payload?.rows || [];
    let added = 0;
    for (const row of chunk) {
      const id = Number(row?.id);
      if (!Number.isFinite(id) || seen.has(id)) continue;
      seen.add(id);
      rows.push(row);
      added += 1;
    }
    if (!payload?.hasNextPage || !chunk.length || !added) break;
    const nextOffset = Number(payload?.lastId);
    offset = Number.isFinite(nextOffset) && nextOffset !== offset ? nextOffset : offset + chunk.length;
  }
  return rows;
}

async function getTeamTransactions(offset = 0, limit = 100) {
  return (
    await withPanelRetry(() =>
      baseClient.get("/transactions", { params: { offset, limit } })
    )
  ).data;
}

function panelErrorBody(error) {
  const data = error?.response?.data;
  if (data == null) return "";
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (!trimmed || /^<!doctype|<html/i.test(trimmed)) return "";
    return trimmed.slice(0, 280);
  }
  if (typeof data !== "object") return "";
  const candidates = [
    data.message,
    data.error,
    data.msg,
    data.detail,
    data.data?.message,
    data.data?.error,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 280);
  }
  return "";
}

function isAxiosStatusMessage(message) {
  return /^Request failed with status code \d+$/i.test(String(message || "").trim());
}

function formatPanelError(error) {
  if (isServiceUnavailable() || isServiceUnavailableError(error)) {
    return "Панель сайтов временно недоступна. Попробуйте чуть позже.";
  }
  if (isTimeoutError(error)) return "Панель сайтов не отвечает. Попробуйте ещё раз через минуту.";
  const body = panelErrorBody(error);
  if (body && !isAxiosStatusMessage(body)) return body;
  const status = Number(error?.response?.status || 0);
  if (status === 409) {
    return "Этот адрес уже занят. Укажи другой path или оставь поле пустым.";
  }
  if (isAxiosStatusMessage(error?.message)) {
    return status ? `Ошибка панели (${status}).` : "Неизвестная ошибка панели.";
  }
  return error?.message || "Неизвестная ошибка панели.";
}

module.exports = {
  createWorkerAccount,
  authCredentials,
  getUserSettings,
  saveUserSettings,
  invalidatePanelToken,
  invalidatePanelData,
  withPanelRetry,
  getDomains,
  getDomainsList,
  getAllDomainsForToken,
  isDomainAvailable,
  checkDomainAvailability,
  getActualIPs,
  getCloudflareNameservers,
  createDomain,
  deleteDomain,
  deleteLegacyTeamDomain,
  getSteamLinks,
  getAllSteamLinks,
  getSteamLinkHistory,
  getTemplates,
  getAllTemplates,
  findTemplateById,
  createTemplate,
  deleteTemplate,
  createSteamLink,
  updateSteamLink,
  deleteSteamLink,
  isDeletedSteamLink,
  filterActiveSteamLinks,
  getTeamDomains,
  getAllTeamDomains,
  normalizeWindowType,
  getTeamWorkers,
  getAllTeamWorkers,
  getTeamTransactions,
  formatPanelError,
  isTimeoutError,
  isServiceUnavailableError,
  isServiceUnavailable,
  markServiceUnavailable,
  serviceUnavailableMsLeft,
  invalidateDomainCaches,
  invalidatePanelData,
};
