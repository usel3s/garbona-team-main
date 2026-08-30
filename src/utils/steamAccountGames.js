"use strict";

const KNOWN_APP_NAMES = {
  10: "Counter-Strike",
  440: "Team Fortress 2",
  550: "Left 4 Dead 2",
  570: "Dota 2",
  620: "Portal 2",
  730: "Counter-Strike 2",
  252490: "Rust",
  271590: "Grand Theft Auto V",
  359550: "Tom Clancy's Rainbow Six Siege",
  578080: "PUBG: BATTLEGROUNDS",
};

function knownAppName(appid) {
  const id = Number(appid) || 0;
  return KNOWN_APP_NAMES[id] || (id > 0 ? `App ${id}` : "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function normalizeGameRow(game) {
  const appid = Number(
    game?.appid || game?.appId || game?.app_id || game?.id || 0
  );
  return {
    appid,
    name: String(game?.name || game?.title || game?.gameName || knownAppName(appid) || ""),
    playtime_forever: Number(
      game?.playtime_forever ?? game?.playtimeForever ?? game?.playtime ?? game?.hours ?? 0
    ),
    icon: String(game?.icon || game?.img_icon_url || game?.imgIconUrl || "").trim(),
    imageUrl: String(
      game?.imageUrl ||
        game?.image_url ||
        game?.header_image ||
        game?.capsule_image ||
        ""
    ).trim(),
  };
}

function unwrapGamesPayload(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.games)) return raw.games;
  if (Array.isArray(raw?.gamesInfo)) return raw.gamesInfo;
  if (Array.isArray(raw?.ownedGames)) return raw.ownedGames;
  if (Array.isArray(raw?.data?.games)) return raw.data.games;
  if (Array.isArray(raw?.data?.gamesInfo)) return raw.data.gamesInfo;
  if (Array.isArray(raw?.data?.ownedGames)) return raw.data.ownedGames;
  if (Array.isArray(raw?.response?.games)) return raw.response.games;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.items)) return raw.items;
  if (Array.isArray(raw?.rows)) return raw.rows;
  return [];
}

function normalizeGamesList(list) {
  return (Array.isArray(list) ? list : [])
    .filter(Boolean)
    .map(normalizeGameRow)
    .filter((game) => game.appid > 0);
}

function pickGamesFromAccount(account) {
  const candidates = [
    account?.gamesInfo,
    account?.games,
    account?.ownedGames,
    account?.steamInfo?.gamesInfo,
    account?.steamInfo?.games,
    account?.steamInfo?.ownedGames,
  ];
  for (const list of candidates) {
    if (!Array.isArray(list) || !list.length) continue;
    // Пустой список после фильтра appid — не блокируем fallback на другие поля / API.
    const normalized = normalizeGamesList(list);
    if (normalized.length) return normalized;
  }
  return [];
}

/** CS/CS2 skins в market_hash_name почти всегда вида `Weapon | Skin (Wear)`. */
const CS_SKIN_RE =
  /\|\s*.+\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/i;
const CS_WEAPON_RE =
  /^(★\s*)?(StatTrak™\s*)?(Souvenir\s*)?(AK-47|AWP|M4A1-S|M4A4|USP-S|Glock-18|Desert Eagle|FAMAS|Galil|P250|MP9|MAC-10|UMP-45|P90|PP-Bizon|Nova|XM1014|MAG-7|Sawed-Off|Negev|M249|SSG 08|SCAR-20|G3SG1|SG 553|AUG|FAMAS|MP7|MP5-SD|CZ75|Tec-9|Five-SeveN|Dual Berettas|R8 Revolver|Knife|Bayonet|Karambit|Butterfly|Talon|Classic Knife)/i;

function inferAppidFromItemName(name) {
  const text = String(name || "").trim();
  if (!text) return 0;
  if (CS_SKIN_RE.test(text) || CS_WEAPON_RE.test(text)) return 730;
  if (/^Unusual\s+/i.test(text) || /\b(Strange|Vintage|Haunted)\b/i.test(text)) return 440;
  if (/\b(AKM|M416|AWM|Level [1-8] Helmet)\b/i.test(text)) return 578080;
  return 0;
}

/**
 * Когда /games ещё пуст (аккаунт не допарсен) или отвалился с 502,
 * хотя бы показываем игры, по которым уже есть ценные предметы инвентаря.
 * Не используем полный список scanned inventories — там часто чужие appid без владения.
 */
function gamesFromPricedItems(items) {
  const byAppid = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item) continue;
    let appid = Number(item.appid || item.appId || item.app_id || 0);
    if (!Number.isFinite(appid) || appid <= 0) {
      appid = inferAppidFromItemName(
        item.itemHashName || item.market_hash_name || item.hash_name || item.name
      );
    }
    if (!Number.isFinite(appid) || appid <= 0 || appid === 753) continue;
    if (!byAppid.has(appid)) {
      byAppid.set(appid, {
        appid,
        name: knownAppName(appid) || String(item.gameName || item.appName || `App ${appid}`),
        playtime_forever: 0,
        icon: "",
        imageUrl: "",
      });
    }
  }
  return [...byAppid.values()];
}

/** appid с групп UProject inventory (даже если item.appid пустой). */
function gamesFromInventoryGroups(inventory) {
  const groups = Array.isArray(inventory?.inventories) ? inventory.inventories : [];
  const byAppid = new Map();
  for (const group of groups) {
    const appid = Number(group?.appid || group?.appId || 0);
    if (!Number.isFinite(appid) || appid <= 0 || appid === 753) continue;
    const items = Array.isArray(group?.items) ? group.items : [];
    if (!items.length) continue;
    if (!byAppid.has(appid)) {
      byAppid.set(appid, {
        appid,
        name: knownAppName(appid) || String(group?.info?.name || group?.name || `App ${appid}`),
        playtime_forever: 0,
        icon: "",
        imageUrl: "",
      });
    }
  }
  return [...byAppid.values()];
}

function gamesFromPayload(raw) {
  const fromUnwrap = normalizeGamesList(unwrapGamesPayload(raw));
  if (fromUnwrap.length) return fromUnwrap;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return pickGamesFromAccount(raw);
  }
  return [];
}

/**
 * @param {object} account
 * @param {string|number} accountId
 * @param {(id: string) => Promise<any>} fetchGames
 * @param {{ retries?: number, retryDelayMs?: number, fallbackItems?: any[], fallbackInventory?: object }} [options]
 */
async function resolveAccountGames(account, accountId, fetchGames, options = {}) {
  const retries = Math.max(0, Number(options.retries ?? 3) || 0);
  const retryDelayMs = Math.max(0, Number(options.retryDelayMs ?? 1800) || 0);
  const fallbackItems = options.fallbackItems;
  const fallbackInventory = options.fallbackInventory;

  const fromAccount = pickGamesFromAccount(account);
  if (fromAccount.length) return fromAccount;

  const id = String(accountId || account?.id || "").trim();
  if (typeof fetchGames === "function" && id) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const raw = await fetchGames(id);
        const games = gamesFromPayload(raw);
        if (games.length) return games;
        // gamesCount > 0, а список ещё пуст — UProject не допарсил, ждём дольше.
        const pendingCount = Number(raw?.gamesCount || raw?.data?.gamesCount || 0);
        if (pendingCount > 0 && attempt < retries && retryDelayMs > 0) {
          await sleep(retryDelayMs + attempt * 400);
          continue;
        }
      } catch (_) {
        // UProject /games часто 502 в момент появления MaFile — пробуем ещё раз.
      }
      if (attempt < retries && retryDelayMs > 0) await sleep(retryDelayMs);
    }
  }

  const fromItems = gamesFromPricedItems(fallbackItems);
  if (fromItems.length) return fromItems;
  return gamesFromInventoryGroups(fallbackInventory);
}

module.exports = {
  knownAppName,
  normalizeGameRow,
  unwrapGamesPayload,
  pickGamesFromAccount,
  gamesFromPricedItems,
  gamesFromInventoryGroups,
  inferAppidFromItemName,
  resolveAccountGames,
};
