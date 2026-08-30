const axios = require("axios");
const {
  tryParseLegacySkinLine,
  parseFakeSteamProfitMeta,
  buildFakeProfitGames,
} = require("../utils/fakeSteamProfitInput");
const { pickSkinsForInventoryTarget } = require("../utils/fakeProfitSkinPicker");
const { normalizeFakeProfitTag } = require("../utils/fakeProfitTag");

const headers = { "User-Agent": "Mozilla/5.0", Accept: "application/json, text/javascript, */*;q=0.01" };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parsePrice(value) {
  const parsed = Number(String(value || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function isRateLimited(error) {
  return error?.response?.status === 429 || /status code 429/i.test(String(error?.message || ""));
}

async function steamGet(url, params, timeout = 25000) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if (attempt > 0) await sleep(2000 * attempt);
      return (await axios.get(url, { params, headers, timeout })).data;
    } catch (error) {
      lastError = error;
      if (!isRateLimited(error)) throw error;
    }
  }
  throw lastError;
}

async function resolveSkinLine(line, index) {
  const legacy = tryParseLegacySkinLine(line);
  if (legacy) return { item: legacy };
  try {
    await sleep(1200);
    const data = await steamGet("https://steamcommunity.com/market/search/render/", {
      query: line, start: 0, count: 10, norender: 1, appid: 730, currency: 1, language: "english",
    });
    const item = data?.results?.[0];
    const name = item?.hash_name || item?.asset_description?.market_hash_name;
    const icon = item?.asset_description?.icon_url;
    if (!name || !icon) return { error: `Строка ${index}: предмет не найден на Steam Market.` };
    await sleep(1200);
    const priceData = await steamGet("https://steamcommunity.com/market/priceoverview/", {
      appid: 730, currency: 1, market_hash_name: name,
    }, 20000);
    const price = parsePrice(priceData?.lowest_price) ?? parsePrice(priceData?.median_price);
    if (price == null) return { error: `Строка ${index}: нет активных лотов для «${name}».` };
    return { item: { icon: String(icon).replace(/\/\d+fx\d+f$/i, ""), price, itemHashName: name } };
  } catch (error) {
    if (isRateLimited(error)) {
      return {
        error: "Steam Market временно ограничил запросы (429). Подождите 1–2 минуты или используйте формат: иконка;цена;название",
      };
    }
    return { error: `Строка ${index}: ${error.message}` };
  }
}

function applyFakeProfitOverrides(parsed, overrides = {}) {
  const balanceUsd =
    overrides.balanceUsd != null && overrides.balanceUsd !== ""
      ? Math.max(0, Number(overrides.balanceUsd) || 0)
      : parsed.balanceUsd;
  const mafileTime =
    overrides.mafileTime != null && String(overrides.mafileTime).trim()
      ? String(overrides.mafileTime).trim()
      : parsed.mafileTime;
  const gamesCount =
    overrides.gamesCount != null && overrides.gamesCount !== ""
      ? Math.max(0, Math.min(4, Math.trunc(Number(overrides.gamesCount) || 0)))
      : parsed.gamesCount;

  let inventoryUsd = parsed.inventoryUsd;
  let totalUsd = parsed.totalUsd;

  if (overrides.inventoryUsd != null && overrides.inventoryUsd !== "") {
    inventoryUsd = Math.max(0, Number(overrides.inventoryUsd) || 0);
    totalUsd = null;
  } else if (overrides.totalUsd != null && overrides.totalUsd !== "") {
    totalUsd = Math.max(0, Number(overrides.totalUsd) || 0);
    inventoryUsd = null;
  }

  if (inventoryUsd == null && totalUsd != null) {
    inventoryUsd = Number((totalUsd - balanceUsd).toFixed(2));
    if (inventoryUsd < 5) {
      return { error: "После вычета баланса сумма инвентаря меньше $5. Уменьшите баланс или увеличьте сумму MaFile." };
    }
  }

  const fakeTag =
    overrides.fakeTag != null && overrides.fakeTag !== ""
      ? normalizeFakeProfitTag(overrides.fakeTag)
      : parsed.fakeTag || "";

  return { balanceUsd, mafileTime, gamesCount, inventoryUsd, totalUsd, fakeTag };
}

function hasAutoOverrides(overrides = {}) {
  return (
    (overrides.totalUsd != null && overrides.totalUsd !== "") ||
    (overrides.inventoryUsd != null && overrides.inventoryUsd !== "")
  );
}

function buildParsedFromOverrides(overrides = {}) {
  return {
    balanceUsd: 0,
    mafileTime: "",
    gamesCount: 4,
    inventoryUsd: null,
    totalUsd: null,
    fakeTag: "",
    mode: "auto",
    skinLines: [],
  };
}

async function resolveFakeSteamProfitInput(text, overrides = {}) {
  const trimmed = String(text || "").trim();
  let parsed;

  if (!trimmed && hasAutoOverrides(overrides)) {
    parsed = buildParsedFromOverrides(overrides);
  } else {
    parsed = parseFakeSteamProfitMeta(text);
    if (parsed.error) return parsed;
  }

  const applied = applyFakeProfitOverrides(parsed, overrides);
  if (applied.error) return applied;
  const mode =
    applied.inventoryUsd != null && applied.inventoryUsd >= 5 && parsed.mode !== "manual"
      ? "auto"
      : parsed.mode;

  if (mode === "auto") {
    const picked = pickSkinsForInventoryTarget(applied.inventoryUsd);
    if (picked.error) return picked;
    const inventoryUsd = picked.inventoryUsd;
    const total = Number((inventoryUsd + applied.balanceUsd).toFixed(2));
    return {
      items: picked.items,
      total,
      balanceUsd: applied.balanceUsd,
      inventoryUsd,
      mafileTime: applied.mafileTime,
      games: buildFakeProfitGames(applied.gamesCount),
      fakeTag: applied.fakeTag,
    };
  }

  const items = [];
  for (let index = 0; index < parsed.skinLines.length; index += 1) {
    const resolved = await resolveSkinLine(parsed.skinLines[index], index + 1);
    if (resolved.error) return resolved;
    items.push(resolved.item);
  }

  const inventoryUsd = Number(items.reduce((sum, item) => sum + Number(item.price || 0), 0).toFixed(2));
  const total = Number((inventoryUsd + applied.balanceUsd).toFixed(2));

  return {
    items,
    total,
    balanceUsd: applied.balanceUsd,
    inventoryUsd,
    mafileTime: applied.mafileTime,
    games: buildFakeProfitGames(applied.gamesCount),
    fakeTag: applied.fakeTag,
  };
}

/** @deprecated alias */
async function resolveFakeProfitSevenSkinQueries(text, overrides) {
  return resolveFakeSteamProfitInput(text, overrides);
}

module.exports = { resolveFakeSteamProfitInput, resolveFakeProfitSevenSkinQueries };
