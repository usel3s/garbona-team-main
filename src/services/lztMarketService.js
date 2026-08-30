const axios = require("axios");
const { env } = require("../config/env");

const TIMEOUT_MS = 60_000;

function assertTokenConfigured() {
  if (!env.lztMarketToken) {
    throw new Error("Не задан LZT_MARKET_TOKEN.");
  }
}

function unwrapItem(payload) {
  if (!payload || typeof payload !== "object") return {};
  if (payload.item && typeof payload.item === "object") return payload.item;
  if (payload.data?.item && typeof payload.data.item === "object") return payload.data.item;
  if (payload.data && typeof payload.data === "object" && payload.data.item_id != null) {
    return payload.data;
  }
  if (payload.item_id != null || payload.item_state != null) return payload;
  return payload;
}

async function getItem(itemId) {
  assertTokenConfigured();
  const id = String(itemId || "").trim();
  if (!id) throw new Error("LZT item id не указан.");
  const response = await axios.get(`${env.lztMarketApiBase}/${encodeURIComponent(id)}`, {
    timeout: TIMEOUT_MS,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${env.lztMarketToken}`,
    },
    validateStatus: (status) => status >= 200 && status < 500,
  });

  const apiMessage = firstApiError(response.data);

  if (response.status === 404 || isGoneItemError(apiMessage, response.status)) {
    const err = new Error(apiMessage || "LZT лот не найден.");
    err.code = "LZT_NOT_FOUND";
    err.status = response.status;
    throw err;
  }
  if (response.status === 401) {
    const err = new Error(
      apiMessage || "LZT API: нет доступа (проверьте токен и scope market)."
    );
    err.code = "LZT_AUTH";
    err.status = 401;
    throw err;
  }
  if (response.status === 403) {
    // 403 у LZT бывает и на удалённых лотах, и на реальном запрете.
    const err = new Error(
      apiMessage || "LZT API: доступ запрещён (403)."
    );
    err.code = isGoneItemError(apiMessage, 403) ? "LZT_NOT_FOUND" : "LZT_FORBIDDEN";
    err.status = 403;
    throw err;
  }
  if (response.status >= 400) {
    const err = new Error(apiMessage || `LZT API HTTP ${response.status}`);
    err.code = "LZT_HTTP";
    err.status = response.status;
    throw err;
  }
  return unwrapItem(response.data);
}

function firstApiError(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (Array.isArray(payload.errors) && payload.errors.length) {
    return String(payload.errors[0] || "").trim();
  }
  if (payload.error != null) return String(payload.error).trim();
  if (payload.message != null) return String(payload.message).trim();
  return "";
}

function isGoneItemError(message, status) {
  const text = String(message || "").toLowerCase();
  if (/удален|удалён|не найден|not found|does not exist|deleted/i.test(text)) {
    return true;
  }
  return status === 404;
}

function toUnixMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 1e12 ? n * 1000 : n;
}

function durationSecondsToPhrase(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value % 86400 === 0) return `${Math.round(value / 86400)}д`;
  if (value % 3600 === 0) return `${Math.round(value / 3600)}ч`;
  if (value % 60 === 0) return `${Math.round(value / 60)}м`;
  return "";
}

function readPriceRub(item) {
  // LZT: rub_price — рубли; price — обычно USD витрины (не путать).
  const rub = Number(item?.rub_price ?? item?.price_rub ?? 0);
  if (Number.isFinite(rub) && rub > 0) return rub;
  return 0;
}

/**
 * Sale amounts from LZT item.
 * When both `price` and `rub_price` exist and price << rub, `price` is USD.
 */
function resolveSaleAmounts(item, usdRubRate = 0) {
  const rub = readPriceRub(item);
  const price = Number(item?.price ?? item?.usd_price ?? 0);
  const rate = Number(usdRubRate);

  if (Number.isFinite(rub) && rub > 0 && Number.isFinite(price) && price > 0 && price * 10 < rub) {
    return {
      priceRub: rub,
      grossUsd: Number(price.toFixed(2)),
      priceIsUsd: true,
    };
  }

  if (Number.isFinite(rub) && rub > 0) {
    return {
      priceRub: rub,
      grossUsd:
        Number.isFinite(rate) && rate > 0 ? Number((rub / rate).toFixed(2)) : 0,
      priceIsUsd: false,
    };
  }

  if (Number.isFinite(price) && price > 0) {
    // Alone `price` on market API is typically USD for Steam category.
    if (price < 500) {
      return {
        priceRub: Number.isFinite(rate) && rate > 0 ? Number((price * rate).toFixed(2)) : 0,
        grossUsd: Number(price.toFixed(2)),
        priceIsUsd: true,
      };
    }
    return {
      priceRub: price,
      grossUsd:
        Number.isFinite(rate) && rate > 0 ? Number((price / rate).toFixed(2)) : 0,
      priceIsUsd: false,
    };
  }

  return { priceRub: 0, grossUsd: 0, priceIsUsd: false };
}

/**
 * Whether marketplace guarantee/hold is still active for a sold (paid) item.
 * Conservative: unknown paid items are treated as held.
 */
function isGuaranteeHoldActive(item) {
  if (!item || typeof item !== "object") return true;

  const guarantee = item.guarantee;
  if (guarantee === false || guarantee === 0 || guarantee === "0" || guarantee === "") {
    return false;
  }
  if (guarantee === true || guarantee === 1 || guarantee === "1") {
    return true;
  }

  if (guarantee && typeof guarantee === "object") {
    if (guarantee.active === false || guarantee.enabled === false) return false;

    const until = toUnixMs(
      guarantee.endDate ?? guarantee.until ?? guarantee.end ?? guarantee.to ?? guarantee.expires
    );
    if (until > 0) return Date.now() < until;

    if (guarantee.cancelled === true) return true; // спор / отмена — деньги ещё не свободны
    if (guarantee.active === true || guarantee.enabled === true) return true;

    const remaining = Number(guarantee.remainingTime);
    if (Number.isFinite(remaining)) return remaining > 0;

    const duration = Number(guarantee.duration ?? guarantee.days ?? 0);
    if (Number.isFinite(duration) && duration <= 0) return false;
  }

  const untilFlat = toUnixMs(
    item.guarantee_until ?? item.guaranteeUntil ?? item.hold_until ?? item.holdUntil
  );
  if (untilFlat > 0) return Date.now() < untilFlat;

  const opDate = toUnixMs(
    item.operation_date ?? item.operationDate ?? item.buyer?.operation_date
  );
  // LZT guarantee.duration is seconds (e.g. 43200 = 12h).
  const durationSec = Number(
    (guarantee && typeof guarantee === "object" ? guarantee.duration : null) ??
      item.guarantee_duration ??
      0
  );
  if (opDate > 0 && Number.isFinite(durationSec) && durationSec > 0) {
    return Date.now() < opDate + durationSec * 1000;
  }

  // Paid without an explicit end signal → still on hold.
  return true;
}

/**
 * Hold timing from LZT guarantee object.
 */
function readHoldInfo(item) {
  const guarantee =
    item?.guarantee && typeof item.guarantee === "object" ? item.guarantee : null;
  const durationSeconds = Number(
    guarantee?.duration ?? item?.guarantee_duration ?? item?.hold_duration ?? 0
  );
  const endMsDirect = toUnixMs(
    guarantee?.endDate ??
      guarantee?.until ??
      guarantee?.end ??
      guarantee?.to ??
      guarantee?.expires ??
      item?.guarantee_until ??
      item?.guaranteeUntil ??
      item?.hold_until ??
      item?.holdUntil
  );
  const opMs = toUnixMs(
    item?.operation_date ?? item?.operationDate ?? item?.buyer?.operation_date
  );
  const inferredEndMs =
    !endMsDirect && opMs > 0 && Number.isFinite(durationSeconds) && durationSeconds > 0
      ? opMs + durationSeconds * 1000
      : 0;
  const endMs = endMsDirect || inferredEndMs;
  const remainingSeconds = Number(guarantee?.remainingTime);
  return {
    holdUntil: endMs > 0 ? new Date(endMs) : null,
    remainingPhrase: String(guarantee?.remainingTimePhrase || "").trim(),
    durationPhrase: String(guarantee?.durationPhrase || "").trim()
      || durationSecondsToPhrase(durationSeconds),
    remainingSeconds: Number.isFinite(remainingSeconds) ? remainingSeconds : null,
    active: guarantee?.active === true,
    cancelled: guarantee?.cancelled === true,
  };
}

/**
 * Map LZT item payload to auto-sale lifecycle phase.
 * @returns {"listed"|"sold_held"|"released"|"terminal_unsold"|"unknown"}
 */
function classifyLztSaleState(item) {
  const state = String(item?.item_state || item?.state || "")
    .trim()
    .toLowerCase();

  if (["active", "pre_active", "awaiting", "stickied", "pre_upload", "auto_bump"].includes(state)) {
    return "listed";
  }

  if (state === "paid") {
    return isGuaranteeHoldActive(item) ? "sold_held" : "released";
  }

  if (["deleted", "closed", "closed_inactive", "pending_deletion"].includes(state)) {
    return "terminal_unsold";
  }

  return "unknown";
}

function extractClaimItemId(claim) {
  const direct =
    claim?.item_id ??
    claim?.itemId ??
    claim?.market_item_id ??
    claim?.marketItemId;
  if (direct != null && String(direct).trim()) {
    const match = String(direct).match(/(\d{5,})/);
    if (match) return match[1];
  }
  const blob = `${claim?.message_body || ""}\n${claim?.message_body_html || ""}`;
  const fromUrl = blob.match(/lzt\.market\/(\d{5,})/i);
  return fromUrl ? fromUrl[1] : "";
}

/**
 * Active market claims (арбитраж) filed against the seller account.
 * @returns {Promise<Map<string, { threadId: string, claimDate: Date|null, claimState: string }>>}
 */
async function fetchActiveClaimByItemId() {
  assertTokenConfigured();
  const response = await axios.get(`${env.lztMarketApiBase}/claims`, {
    timeout: TIMEOUT_MS,
    params: { claim_state: "active", type: "market" },
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${env.lztMarketToken}`,
    },
    validateStatus: (status) => status >= 200 && status < 500,
  });
  if (response.status === 401) {
    const err = new Error("LZT API: нет доступа к /claims (токен).");
    err.code = "LZT_AUTH";
    throw err;
  }
  if (response.status >= 400) {
    const err = new Error(firstApiError(response.data) || `LZT claims HTTP ${response.status}`);
    err.code = "LZT_HTTP";
    err.status = response.status;
    throw err;
  }

  const map = new Map();
  for (const claim of response.data?.claims || []) {
    const itemId = extractClaimItemId(claim);
    if (!itemId) continue;
    map.set(itemId, {
      threadId: String(claim.thread_id || claim.threadId || "").trim(),
      claimDate: (() => {
        const ms = toUnixMs(claim.claim_date || claim.claimDate);
        return ms > 0 ? new Date(ms) : null;
      })(),
      claimState: String(claim.claim_state || claim.claimState || "active"),
    });
  }
  return map;
}

function lztHeaders() {
  assertTokenConfigured();
  return {
    Accept: "application/json",
    Authorization: `Bearer ${env.lztMarketToken}`,
  };
}

async function lztGet(path, params = {}) {
  const response = await axios.get(`${env.lztMarketApiBase}${path}`, {
    timeout: TIMEOUT_MS,
    headers: lztHeaders(),
    params,
    validateStatus: (status) => status >= 200 && status < 500,
  });
  const apiMessage = firstApiError(response.data);
  if (response.status === 401) {
    const err = new Error(apiMessage || "LZT API: нет доступа (токен / scope market).");
    err.code = "LZT_AUTH";
    err.status = 401;
    throw err;
  }
  if (response.status >= 400) {
    const err = new Error(apiMessage || `LZT API HTTP ${response.status} ${path}`);
    err.code = "LZT_HTTP";
    err.status = response.status;
    throw err;
  }
  return response.data && typeof response.data === "object" ? response.data : {};
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Seller inventory. `show=active` = currently listed.
 * @see https://lzt-market.readme.io/reference/listuser
 */
async function listUserItems({
  categoryId = 1,
  show = "active",
  page = 1,
  userId = "",
} = {}) {
  const params = {
    category_id: Number(categoryId) || 1,
    show: String(show || "active"),
    page: Math.max(1, Number(page) || 1),
  };
  const uid = String(userId || "").trim();
  if (uid) params.user_id = uid;
  return lztGet("/user/items", params);
}

function tallyLztOnSaleItems(items, usdRubRate = 0, allowedItemIds = null) {
  const allowed = allowedItemIds instanceof Set ? allowedItemIds : null;
  let count = 0;
  let usd = 0;
  let rub = 0;
  let otherCount = 0;
  let otherUsd = 0;
  const seen = new Set();
  const matchedIds = [];

  for (const item of items || []) {
    const id = String(item?.item_id ?? item?.itemId ?? "").trim();
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    const amounts = resolveSaleAmounts(item, usdRubRate);
    const itemUsd = Number(amounts.grossUsd || 0);
    const itemRub = Number(amounts.priceRub || 0);
    const isForeign = Boolean(allowed) && (!id || !allowed.has(id));
    if (isForeign) {
      otherCount += 1;
      otherUsd += itemUsd;
      continue;
    }
    count += 1;
    usd += itemUsd;
    rub += itemRub;
    if (id) matchedIds.push(id);
  }

  return {
    count,
    usd: Number(usd.toFixed(2)),
    rub: Number(rub.toFixed(2)),
    otherCount,
    otherUsd: Number(otherUsd.toFixed(2)),
    matchedIds,
    seen,
  };
}

/**
 * Live on-sale Steam lots. Pass `allowedItemIds` to count only panel lots;
 * everything else is reported as `otherCount` / `otherUsd`.
 */
async function fetchLztOnSaleStats(usdRubRate = 0, options = {}) {
  const allowed = options.allowedItemIds instanceof Set ? options.allowedItemIds : null;
  const listedShows = ["active", "stickied", "pre_active", "auto_bump"];
  let count = 0;
  let usd = 0;
  let rub = 0;
  let otherCount = 0;
  let otherUsd = 0;
  const seen = new Set();
  const matchedIds = [];

  for (const show of listedShows) {
    let page = 1;
    let hasNext = true;
    while (hasNext && page <= 12) {
      const payload = await listUserItems({ categoryId: 1, show, page });
      const items = Array.isArray(payload?.items) ? payload.items : [];
      if (page === 1 && !items.length && Number(payload?.totalItems || 0) === 0) {
        break;
      }
      const unique = items.filter((item) => {
        const id = String(item?.item_id ?? item?.itemId ?? "").trim();
        if (id && seen.has(id)) return false;
        if (id) seen.add(id);
        return true;
      });
      const tallied = tallyLztOnSaleItems(unique, usdRubRate, allowed);
      count += tallied.count;
      usd += tallied.usd;
      rub += tallied.rub;
      otherCount += tallied.otherCount;
      otherUsd += tallied.otherUsd;
      matchedIds.push(...tallied.matchedIds);
      hasNext = Boolean(payload?.hasNextPage) && items.length > 0;
      page += 1;
      if (hasNext) await sleep(220);
    }
  }

  return {
    count,
    usd: Number(usd.toFixed(2)),
    rub: Number(rub.toFixed(2)),
    otherCount,
    otherUsd: Number(otherUsd.toFixed(2)),
    matchedIds,
  };
}

function convertRubToUsd(priceRub, usdRubRate) {
  const rub = Number(priceRub);
  const rate = Number(usdRubRate);
  if (!Number.isFinite(rub) || rub <= 0) return 0;
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("Некорректный курс USD/RUB.");
  }
  return Number((rub / rate).toFixed(2));
}

function workerShareFromGross(grossUsd, profitPercent) {
  const gross = Number(grossUsd);
  const percent = Number(profitPercent);
  if (!Number.isFinite(gross) || gross <= 0) return 0;
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  return Number(((gross * percent) / 100).toFixed(2));
}

module.exports = {
  getItem,
  unwrapItem,
  readPriceRub,
  resolveSaleAmounts,
  readHoldInfo,
  isGuaranteeHoldActive,
  classifyLztSaleState,
  extractClaimItemId,
  fetchActiveClaimByItemId,
  listUserItems,
  tallyLztOnSaleItems,
  fetchLztOnSaleStats,
  convertRubToUsd,
  workerShareFromGross,
};
