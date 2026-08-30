const { env } = require("../config/env");
const {
  createCheckValidTask,
  getSteamAccountById,
  getSteamAccountGames,
  getSteamInventory,
  getSteamTask,
  getSteamTaskById,
  invalidateSteamAccountsCache,
} = require("./steamApiService");
const { submitLogSaleRequest, upsertSteamLogFromAccount } = require("./steamMonitorService");
const { logWorkerLogAction } = require("./steamActivityLogService");
const { getPanelToken } = require("../handlers/sitesHandler");
const SteamLog = require("../models/SteamLog");
const { resolveAccountGames } = require("../utils/steamAccountGames");
const { resolveSteamCountryCode } = require("../utils/countryStats");
const { logger } = require("../utils/logger");
const { getAllDomainsForToken } = require("./apiService");
const { formatAccountSourcePage, preferSourcePage, buildDomainLookup } = require("../utils/steamSourcePage");
const {
  classifyWorkerAccountStatus,
  serializeWorkerMafileSession,
  rawUprojectStatus,
} = require("./steamControlService");
const {
  autoSaleActivityStatus,
  effectiveActivitySaleStatus,
} = require("./steamLogStatusService");

const KNOWN_APP_NAMES = {
  730: "CS2",
  570: "Dota 2",
  440: "TM 2",
  252490: "Rust",
  578080: "PUBG",
  753: "Steam",
};

function asError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function moneyOf(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

function inventoryPrice(price = {}) {
  if (price.tradable != null) return moneyOf(price.tradable);
  if (price.marketable != null) return moneyOf(price.marketable);
  if (price.total != null) return moneyOf(price.total);
  return 0;
}

function accountBalance(account) {
  const info = account?.steamInfo || {};
  if (info.balanceUsd != null) return moneyOf(info.balanceUsd);
  return moneyOf(info.balance);
}

function knownAppName(appid) {
  const id = Number(appid) || 0;
  return KNOWN_APP_NAMES[id] || (id > 0 ? `App ${id}` : "Steam");
}

const STEAM_CLIENT_APPID = 753;

function isSteamClientApp(appid) {
  return Number(appid) === STEAM_CLIENT_APPID;
}

function nestedDescription(item) {
  const nested =
    item?.asset_description || item?.assetDescription || item?.description;
  return nested && typeof nested === "object" && !Array.isArray(nested) ? nested : {};
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = firstNonEmpty(
        value.url,
        value.icon,
        value.hash,
        value.src,
        value.icon_url,
        value.iconUrl
      );
      if (nested) return nested;
      continue;
    }
    const text = String(value ?? "").trim();
    if (text && text !== "[object Object]") return text;
  }
  return "";
}

function itemUnitPrice(item) {
  const nested = nestedDescription(item);
  const price = item?.price;
  if (price && typeof price === "object") {
    const fromObj = moneyOf(
      price.usd ?? price.USD ?? price.tradable ?? price.marketable ?? price.total ?? price.value
    );
    if (fromObj > 0) return fromObj;
  }
  return moneyOf(
    item?.priceUsd ??
      item?.price_usd ??
      item?.value ??
      (typeof price === "number" || typeof price === "string" ? price : 0) ??
      nested.price?.usd ??
      0
  );
}

function serializeInventoryItem(item) {
  const nested = nestedDescription(item);
  const amount = Math.max(1, Number(item?.amount || item?.quantity || item?.count || 1) || 1);
  const unitPrice = itemUnitPrice(item);
  const iconRaw = firstNonEmpty(
    item?.icon,
    item?.icon_url,
    item?.iconUrl,
    item?.image,
    item?.imageUrl,
    item?.icon_url_large,
    nested.icon_url_large,
    nested.icon_url,
    nested.iconUrl,
    nested.icon
  );
  let iconUrl = "";
  if (/^https?:\/\//i.test(iconRaw)) {
    iconUrl = iconRaw;
  } else if (iconRaw) {
    const hash = iconRaw.replace(/\/\d+fx\d+f$/i, "");
    iconUrl = `https://community.cloudflare.steamstatic.com/economy/image/${hash}/96fx96f`;
  }
  return {
    name: firstNonEmpty(
      item?.itemHashName,
      item?.market_hash_name,
      item?.hash_name,
      item?.market_name,
      item?.name,
      nested.market_hash_name,
      nested.market_name,
      nested.name,
      nested.hash_name
    ) || "Item",
    priceUsd: unitPrice,
    amount,
    iconUrl,
    appid: Number(item?.appid || item?.appId || nested.appid || 0) || 0,
    nameColor: String(
      item?.name_color || item?.nameColor || nested.name_color || nested.nameColor || ""
    )
      .replace(/^#/, "")
      .trim() || undefined,
    rarity: firstNonEmpty(
      item?.rarity,
      item?.rarityName,
      item?.quality,
      nested.rarity,
      nested.type
    ) || undefined,
  };
}

function flattenInventoryItems(inventory) {
  const groups = Array.isArray(inventory?.inventories) ? inventory.inventories : [];
  const flat = groups.flatMap((group) =>
    (Array.isArray(group?.items) ? group.items : []).map((item) => ({
      ...item,
      appid: item?.appid || item?.appId || group?.appid || group?.appId || 0,
    }))
  );
  if (flat.length) return flat;
  return Array.isArray(inventory?.items) ? inventory.items : [];
}

function topInventoryItems(inventory, limit = 24) {
  return flattenInventoryItems(inventory)
    .map(serializeInventoryItem)
    .sort((a, b) => b.priceUsd - a.priceUsd)
    .slice(0, limit);
}

function inventoryByAppid(inventory) {
  const groups = Array.isArray(inventory?.inventories) ? inventory.inventories : [];
  const map = {};

  const pushGroup = (appid, name, rawItems) => {
    const items = (Array.isArray(rawItems) ? rawItems : [])
      .map((item) => serializeInventoryItem({ ...item, appid: item?.appid || item?.appId || appid }))
      .sort((a, b) => b.priceUsd - a.priceUsd);
    if (!items.length) return;
    const key = String(appid || name || "other");
    const existing = map[key];
    const merged = existing ? [...existing.items, ...items] : items;
    merged.sort((a, b) => b.priceUsd - a.priceUsd);
    const totalUsd = moneyOf(merged.reduce((sum, item) => sum + item.priceUsd * (item.amount || 1), 0));
    map[key] = {
      appid: Number(appid) || Number(existing?.appid) || 0,
      name: String(name || existing?.name || knownAppName(appid)),
      items: merged,
      itemCount: merged.reduce((sum, item) => sum + (item.amount || 1), 0),
      totalUsd,
    };
  };

  if (groups.length) {
    for (const group of groups) {
      if (!group || typeof group !== "object") continue;
      const appid = Number(group.appid || group.appId || group.gameId || 0) || 0;
      const name = String(group.name || group.gameName || group.game || group.title || knownAppName(appid));
      pushGroup(appid, name, group.items);
    }
  } else {
    const fallback = Array.isArray(inventory?.items) ? inventory.items : [];
    for (const item of fallback) {
      const appid = Number(item?.appid || item?.appId || 0) || 0;
      pushGroup(appid, knownAppName(appid), [item]);
    }
  }

  return map;
}

function inventoryItemIconRaw(item) {
  const nested = nestedDescription(item);
  return firstNonEmpty(
    item?.icon,
    item?.icon_url,
    item?.iconUrl,
    item?.image,
    item?.imageUrl,
    item?.icon_url_large,
    nested.icon_url_large,
    nested.icon_url,
    nested.iconUrl,
    nested.icon
  );
}

function inventoryItemNameKey(item) {
  const nested = nestedDescription(item);
  return firstNonEmpty(
    item?.itemHashName,
    item?.market_hash_name,
    item?.hash_name,
    item?.market_name,
    item?.name,
    nested.market_hash_name,
    nested.market_name,
    nested.name
  ).toLowerCase();
}

function buildInventoryIconLookup(inventory) {
  const lookup = new Map();
  for (const item of flattenInventoryItems(inventory)) {
    const name = inventoryItemNameKey(item);
    const icon = inventoryItemIconRaw(item);
    if (name && icon && !lookup.has(name)) lookup.set(name, icon);
  }
  return lookup;
}

function enrichSnapshotItems(items, iconLookup) {
  if (!iconLookup?.size) return items;
  return items.map((item) => {
    if (inventoryItemIconRaw(item)) return item;
    const icon = iconLookup.get(inventoryItemNameKey(item));
    return icon ? { ...item, icon } : item;
  });
}

function inventoryFromSnapshot(snapshot) {
  const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
  if (!items.length) return null;
  const grouped = {};
  for (const item of items) {
    const appid = Number(item?.appid || item?.appId || 0) || 0;
    const key = String(appid || "other");
    if (!grouped[key]) grouped[key] = { appid, name: knownAppName(appid), items: [] };
    grouped[key].items.push(item);
  }
  return {
    price: {
      total: moneyOf(items.reduce((sum, item) => sum + moneyOf(item?.price ?? item?.priceUsd), 0)),
    },
    inventories: Object.values(grouped),
  };
}

function resolveEffectiveInventory({ steamLog, account, inventory, snapshot }) {
  const isMafile = steamLog?.logKind === "mafile";
  const snapshotItems = Array.isArray(snapshot?.items) ? snapshot.items : [];
  const liveInventory = inventory || account?.inventory || null;

  if (isMafile && snapshotItems.length) {
    const iconLookup = buildInventoryIconLookup(liveInventory);
    const enrichedSnapshot = {
      ...snapshot,
      items: enrichSnapshotItems(snapshotItems, iconLookup),
    };
    return inventoryFromSnapshot(enrichedSnapshot);
  }

  return (
    liveInventory ||
    inventoryFromSnapshot(snapshot) ||
    null
  );
}

function httpImageUrl(value) {
  const url = String(value || "").trim();
  return /^https?:\/\//i.test(url) ? url : "";
}

function gameIconUrl(game) {
  const appid = Number(game?.appid);
  const direct = httpImageUrl(game?.iconUrl || game?.icon_url || game?.logoUrl);
  if (direct) return direct;
  const icon = String(game?.icon || game?.img_icon_url || game?.imgIconUrl || "").trim();
  if (!Number.isFinite(appid) || appid <= 0) return "";
  if (icon) {
    return `https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/${appid}/${icon}.jpg`;
  }
  if (isSteamClientApp(appid)) return "";
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/capsule_231x87.jpg`;
}

function gameArtworkUrl(game) {
  const direct = httpImageUrl(
    game?.imageUrl ||
      game?.image_url ||
      game?.headerUrl ||
      game?.header_image ||
      game?.capsuleUrl ||
      game?.capsule_image
  );
  if (direct) return direct;
  const appid = Number(game?.appid);
  if (!Number.isFinite(appid) || appid <= 0 || isSteamClientApp(appid)) {
    return gameIconUrl(game);
  }
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`;
}

function gameHasVac(game, vacInfo) {
  if (!game || typeof game !== "object") return false;
  if (game.vac || game.vacBanned || game.hasVac || game.vacBan) return true;
  const name = String(game.name || game.title || "").toLowerCase();
  const appid = Number(game.appid || game.appId) || 0;
  const vacGames = Array.isArray(vacInfo?.games) ? vacInfo.games : [];
  return vacGames.some((entry) => {
    const label = String(entry || "").toLowerCase();
    if (!label) return false;
    if (name && (label === name || name.includes(label) || label.includes(name))) return true;
    return appid > 0 && label === String(appid);
  });
}

function normalizeGameEntry(game, vacInfo) {
  const appid = Number(game?.appid || game?.appId || 0) || 0;
  const normalized = { ...game, appid };
  return {
    appid,
    name: String(game?.name || game?.title || game?.gameName || knownAppName(appid)),
    playtime: Number(game?.playtime || game?.playtimeForever || game?.playtime_forever || 0),
    iconUrl: gameIconUrl(normalized),
    imageUrl: gameArtworkUrl(normalized),
    vac: gameHasVac(normalized, vacInfo),
    itemCount: Number(game?.itemCount) || 0,
    inventoryUsd: moneyOf(game?.inventoryUsd || game?.totalUsd || 0),
  };
}

function sortGames(list) {
  return [...list].sort((a, b) => {
    const aCs = Number(a.appid) === 730 || /counter.?strike/i.test(String(a.name || "")) ? 1 : 0;
    const bCs = Number(b.appid) === 730 || /counter.?strike/i.test(String(b.name || "")) ? 1 : 0;
    if (aCs !== bCs) return bCs - aCs;
    const aClient = isSteamClientApp(a.appid) ? 1 : 0;
    const bClient = isSteamClientApp(b.appid) ? 1 : 0;
    if (aClient !== bClient) return aClient - bClient;
    const aValue = Number(a.inventoryUsd || 0);
    const bValue = Number(b.inventoryUsd || 0);
    if (aValue !== bValue) return bValue - aValue;
    const aItems = Number(a.itemCount || 0);
    const bItems = Number(b.itemCount || 0);
    if (aItems !== bItems) return bItems - aItems;
    return Number(b.playtime || 0) - Number(a.playtime || 0);
  });
}

function serializeGames(account, vacInfo, { inventoryMap = {}, snapshotGames = [], limit = 100 } = {}) {
  const candidates = [
    account?.gamesInfo,
    account?.games,
    account?.ownedGames,
    account?.steamInfo?.gamesInfo,
    account?.steamInfo?.games,
    snapshotGames,
  ];
  const byAppid = new Map();

  const upsert = (raw) => {
    if (!raw) return;
    const entry = normalizeGameEntry(raw, vacInfo);
    const key = String(entry.appid || entry.name || "");
    if (!key) return;
    const prev = byAppid.get(key);
    if (!prev) {
      byAppid.set(key, entry);
      return;
    }
    byAppid.set(key, {
      ...prev,
      ...entry,
      name: entry.name && !/^App\s+\d+$/i.test(entry.name) ? entry.name : prev.name,
      playtime: Math.max(prev.playtime || 0, entry.playtime || 0),
      iconUrl: entry.iconUrl || prev.iconUrl,
      imageUrl: entry.imageUrl || prev.imageUrl,
      vac: Boolean(prev.vac || entry.vac),
      itemCount: Math.max(prev.itemCount || 0, entry.itemCount || 0),
      inventoryUsd: Math.max(prev.inventoryUsd || 0, entry.inventoryUsd || 0),
    });
  };

  for (const list of candidates) {
    if (!Array.isArray(list)) continue;
    list.filter(Boolean).forEach(upsert);
  }

  for (const group of Object.values(inventoryMap || {})) {
    if (!group) continue;
    upsert({
      appid: group.appid,
      name: group.name || knownAppName(group.appid),
      itemCount: group.itemCount || (group.items || []).length,
      inventoryUsd: group.totalUsd,
    });
  }

  return sortGames([...byAppid.values()]).slice(0, limit);
}

async function resolveDetailGames(account, accountId, vacInfo, inventoryMap, snapshot) {
  let accountForGames = account;
  const embedded = serializeGames(account, vacInfo, {
    inventoryMap,
    snapshotGames: snapshot?.games || [],
  });
  if (embedded.length) return embedded;

  const fetched = await resolveAccountGames(account, accountId, getSteamAccountGames);
  if (fetched.length) {
    accountForGames = { ...(account || {}), gamesInfo: fetched };
  }
  return serializeGames(accountForGames, vacInfo, {
    inventoryMap,
    snapshotGames: snapshot?.games || [],
  });
}

function classifyStatus(row) {
  return classifyWorkerAccountStatus(row);
}

function pickVacCount(source) {
  if (!source || typeof source !== "object") return 0;
  const keys = ["vacBans", "vacBan", "numberOfVACBans", "numberOfVacBans", "vacCount", "VACBans"];
  for (const key of keys) {
    const n = Number(source[key]);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  if (source.hasVac === true || source.vac === true) return 1;
  return 0;
}

function extractVacGames(account) {
  const games = Array.isArray(account?.gamesInfo) ? account.gamesInfo.filter(Boolean) : [];
  return games
    .filter((game) => game.vac || game.vacBanned || game.hasVac || game.vacBan)
    .map((game) => String(game.name || `App ${game.appid || "?"}`));
}

function extractVacInfo(account) {
  if (!account) return null;

  const steam = account.steamInfo || {};
  let count = Math.max(pickVacCount(account), pickVacCount(steam));
  const games = extractVacGames(account);

  if (games.length) count = Math.max(count, games.length);

  const banList = account.bans || steam.bans || account.vacGames || steam.vacGames;
  if (Array.isArray(banList)) {
    const vacFromBans = banList.filter((ban) => {
      const type = String(ban?.type || ban?.banType || ban?.kind || "").toLowerCase();
      return type.includes("vac") || ban?.vac === true;
    });
    if (vacFromBans.length) {
      count = Math.max(count, vacFromBans.length);
      vacFromBans.forEach((ban) => {
        const name = ban.game || ban.gameName || ban.name;
        if (name) games.push(String(name));
      });
    }
  }

  const uniqueGames = [...new Set(games.filter(Boolean))];
  if (count <= 0 && !uniqueGames.length) return null;

  return {
    count: count || uniqueGames.length,
    games: uniqueGames,
  };
}

async function assertOwnedLog(worker, sourceId) {
  const id = String(sourceId || "").trim();
  if (!id) throw asError("source_id_required");

  let steamLog = await SteamLog.findOne({ sourceId: id });
  if (!steamLog) {
    const account = await loadAccountSafe(worker, id);
    if (account) {
      const remoteOwner = String(account?.owner?.telegram || "").trim();
      if (remoteOwner && remoteOwner !== String(worker.telegramId)) {
        throw asError("Это не ваш лог", 403);
      }
      steamLog = await upsertSteamLogFromAccount(account, {
        ownerTelegramId: String(worker.telegramId),
      });
    }
  }
  if (!steamLog || String(steamLog.ownerTelegramId) !== String(worker.telegramId)) {
    throw asError("Это не ваш лог", 403);
  }
  return { id, steamLog };
}

async function loadAccountSafe(worker, sourceId) {
  try {
    const auth = await getPanelToken(worker);
    invalidateSteamAccountsCache(auth.token);
    const payload = await getSteamAccountById(auth.token, sourceId);
    if (!payload || typeof payload !== "object") return null;
    if (payload.id != null) return payload;
    if (payload.data?.id != null) return payload.data;
    if (payload.account?.id != null) return payload.account;
    return payload;
  } catch (error) {
    logger.warn("getSteamAccountById failed", sourceId, error?.message || error);
    return null;
  }
}

async function loadWorkerDomainLookup(worker) {
  try {
    const auth = await getPanelToken(worker);
    return buildDomainLookup(await getAllDomainsForToken(auth.token));
  } catch {
    return new Map();
  }
}

async function persistLiveFieldsToSteamLog(steamLog, account, domainById) {
  if (!steamLog || !account) return;
  let dirty = false;
  const page = formatAccountSourcePage(account, domainById);
  const nextPage = preferSourcePage(page, steamLog.sourcePage);
  if (nextPage && nextPage !== String(steamLog.sourcePage || "")) {
    steamLog.sourcePage = nextPage;
    dirty = true;
  }
  const live = rawUprojectStatus(account);
  if (live && live !== String(steamLog.accountStatus || "")) {
    steamLog.accountStatus = live;
    dirty = true;
  }
  const steamId = String(account?.steamInfo?.steamid || account?.steamInfo?.steamId || "").trim();
  if (steamId && steamId !== String(steamLog.steamId || "")) {
    steamLog.steamId = steamId;
    dirty = true;
  }
  const username = String(account?.username || account?.steamInfo?.nickname || "").trim();
  if (username && username !== String(steamLog.accountUsername || "")) {
    steamLog.accountUsername = username;
    dirty = true;
  }
  if (dirty) await steamLog.save();
}

async function loadInventorySafe(worker, steamId) {
  const sid = String(steamId || "").trim();
  if (!sid) return null;
  try {
    const auth = await getPanelToken(worker);
    return await getSteamInventory(sid, auth.token);
  } catch (error) {
    logger.warn("getSteamInventory failed", sid, error?.message || error);
    return null;
  }
}

async function buildDetail({ id, account, steamLog, inventory, domainById = null }) {
  const snapshot = steamLog?.mafileSnapshot || account?.mafileSnapshot || {};
  const effectiveInventory = resolveEffectiveInventory({
    steamLog,
    account,
    inventory,
    snapshot,
  });

  const steam = account?.steamInfo || {};
  const balanceUsd = account ? accountBalance(account) : moneyOf(steamLog?.balanceUsd);
  const inventoryUsd = effectiveInventory
    ? inventoryPrice(effectiveInventory.price)
    : account
      ? inventoryPrice(account?.inventory?.price)
      : moneyOf(steamLog?.inventoryUsd);
  const totalUsd = moneyOf(
    Number(steamLog?.totalProfit) > 0
      ? steamLog.totalProfit
      : balanceUsd + inventoryUsd
  );
  const status =
    autoSaleActivityStatus(steamLog?.autoSaleStatus) ||
    (account
      ? classifyStatus(account)
      : classifyWorkerAccountStatus({
        status:
          steamLog?.accountStatus
          || (steamLog?.logKind === "mafile"
            ? "MaFile"
            : steamLog?.logKind === "valid"
              ? "Ok"
              : steamLog?.logKind === "invalid"
                ? "Invalid"
                : ""),
        isMaFile: steamLog?.logKind === "mafile",
        invalidDate:
          steamLog?.mafileStatus === "invalid" ? steamLog.mafileStatusUpdatedAt : null,
      }));

  const steamId = String(steam.steamid || steam.steamId || steamLog?.steamId || "");
  const invPrice = effectiveInventory?.price || account?.inventory?.price || {};
  const vac = extractVacInfo(account);
  const byApp = inventoryByAppid(effectiveInventory);
  const games = await resolveDetailGames(account, id, vac, byApp, snapshot);
  const session = serializeWorkerMafileSession({
    ...(account || {}),
    isMaFile:
      account?.isMaFile === true
      || steamLog?.logKind === "mafile"
      || /mafile/i.test(String(status || "")),
    mafileSnapshot: snapshot,
    mafileTime: account?.mafileTime || snapshot?.mafileTime,
    invalidDate:
      account?.invalidDate
      || (steamLog?.mafileStatus === "invalid" ? steamLog.mafileStatusUpdatedAt : null),
    status: account?.status || steamLog?.accountStatus || "",
  });

  return {
    id,
    createdAt: account?.createdAt || account?.date || steamLog?.createdAt || null,
    username:
      account?.username || steam.nickname || steamLog?.accountUsername || "",
    sourcePage: preferSourcePage(
      formatAccountSourcePage(account || {}, domainById),
      steamLog?.sourcePage
    ),
    level: steam.level ?? null,
    country:
      resolveSteamCountryCode(steam) || steam.country || steam.countryCode || "",
    lastPlayed: steam.lastPlayed || steam.last_played || null,
    status,
    steamId,
    steamProfileUrl: steamId ? `https://steamcommunity.com/profiles/${steamId}` : "",
    gamesCount: Math.max(
      Number(
        account?.gamesCount ??
          account?.gameCount ??
          account?.gamesInfo?.length ??
          account?.games?.length ??
          account?.ownedGames?.length ??
          account?.steamInfo?.games?.length ??
          0
      ),
      games.length
    ),
    games,
    balanceUsd,
    inventoryUsd,
    priceUsd: totalUsd,
    inventoryBreakdown: {
      total: moneyOf(invPrice.total ?? inventoryUsd),
      tradable: moneyOf(invPrice.tradable),
      marketable: moneyOf(invPrice.marketable),
    },
    inventoryByAppid: byApp,
    topItems: topInventoryItems(effectiveInventory),
    saleStatus: effectiveActivitySaleStatus(steamLog),
    processStatus: String(steamLog?.processStatus || "none"),
    logKind: String(steamLog?.logKind || ""),
    eventType: session.eventType,
    mafileTime: session.mafileTime,
    mafileSessionHoursLeft: session.mafileSessionHoursLeft,
    mafileSessionUnlocked: session.mafileSessionUnlocked,
    sessionInvalid: session.sessionInvalid,
    sessionCheckedAt: session.sessionCheckedAt,
    accountTag: String(
      account?.customTeamTag || account?.customTag || steamLog?.accountTag || ""
    ),
    vac,
  };
}

async function getLogDetail(worker, sourceId) {
  const { id, steamLog } = await assertOwnedLog(worker, sourceId);
  const [account, domainById] = await Promise.all([
    loadAccountSafe(worker, id),
    loadWorkerDomainLookup(worker),
  ]);
  if (!account && !steamLog) throw asError("Лог не найден", 404);

  const steamId = String(
    account?.steamInfo?.steamid || account?.steamInfo?.steamId || steamLog?.steamId || ""
  );
  const inventory = await loadInventorySafe(worker, steamId);
  const detail = await buildDetail({ id, account, steamLog, inventory, domainById });
  await persistLiveFieldsToSteamLog(steamLog, account, domainById).catch(() => {});
  return detail;
}

async function refreshLogDetail(worker, sourceId) {
  const { id, steamLog } = await assertOwnedLog(worker, sourceId);
  const [account, domainById] = await Promise.all([
    loadAccountSafe(worker, id),
    loadWorkerDomainLookup(worker),
  ]);
  if (!account && !steamLog) throw asError("Лог не найден", 404);

  const steamId = String(
    account?.steamInfo?.steamid || account?.steamInfo?.steamId || steamLog?.steamId || ""
  );
  const inventory = await loadInventorySafe(worker, steamId);
  const detail = await buildDetail({ id, account, steamLog, inventory, domainById });

  if (steamLog) {
    steamLog.balanceUsd = detail.balanceUsd;
    steamLog.inventoryUsd = detail.inventoryUsd;
    steamLog.totalProfit = detail.priceUsd;
    if (detail.steamId) steamLog.steamId = detail.steamId;
    if (detail.username) steamLog.accountUsername = detail.username;
    if (detail.accountTag) steamLog.accountTag = detail.accountTag;
    const page = preferSourcePage(detail.sourcePage, steamLog.sourcePage);
    if (page) steamLog.sourcePage = page;
    const live = account ? rawUprojectStatus(account) : "";
    if (live) steamLog.accountStatus = live;
    await steamLog.save();
  }

  return detail;
}

/**
 * Submit a "sell" request to the steam log sale channel.
 */
async function requestSell({ telegram }, worker, sourceId) {
  const { id, steamLog } = await assertOwnedLog(worker, sourceId);
  if (!steamLog) throw asError("Лог не найден в базе. Дождитесь синхронизации.");

  if (steamLog.saleStatus === "pending" || steamLog.saleStatus === "done") {
    throw asError("Заявка по этому логу уже отправлена");
  }

  await submitLogSaleRequest({ telegram }, steamLog);
  void logWorkerLogAction({
    sourceId: id,
    action: "Заявка на продажу",
  }).catch(() => {});
  return steamLog;
}

/**
 * Submit a "process" request (отработка) which includes CheckValid + admin notify.
 */
async function requestProcess({ telegram }, worker, sourceId) {
  const { id, steamLog } = await assertOwnedLog(worker, sourceId);
  if (!steamLog) throw asError("Лог не найден в базе. Дождитесь синхронизации.");

  if (steamLog.processStatus === "pending" || steamLog.processStatus === "done") {
    throw asError("Заявка на отработку по этому логу уже отправлена");
  }

  steamLog.processStatus = "pending";
  await steamLog.save();

  void logWorkerLogAction({
    sourceId: id,
    action: "Заявка на отработку",
  }).catch(() => {});

  try {
    await createCheckValidTask(id);
  } catch (error) {
    logger.warn("process createCheckValidTask failed", id, error?.message || error);
  }

  const adminChannelId = env.steamAdminLogsChannelId;
  if (telegram && adminChannelId) {
    try {
      const ownerLabel = worker.username
        ? `@${worker.username}`
        : `<code>${worker.telegramId}</code>`;
      const text = [
        `Заявка на отработку`,
        `${ownerLabel} · ID: <code>${id}</code>`,
      ].join("\n");
      await telegram.sendMessage(adminChannelId, text, { parse_mode: "HTML" });
    } catch (error) {
      logger.warn("process admin channel notify failed", id, error?.message || error);
    }
  }

  return steamLog;
}

/**
 * Lightweight UProject CheckValid without full process/sale flow.
 */
function unwrapTask(payload) {
  let value = payload && typeof payload === "object" ? payload : {};
  for (let i = 0; i < 4; i += 1) {
    if (value.id != null || value.state != null || value.status != null) break;
    const next = value.data || value.task || value.result;
    if (!next || typeof next !== "object" || Array.isArray(next)) break;
    value = next;
  }
  if (Array.isArray(value.tasks) && value.tasks[0] && typeof value.tasks[0] === "object") {
    return value.tasks[0];
  }
  return value;
}

function taskFailed(task) {
  const state = String(task?.state || task?.status || "").toLowerCase();
  if (!state) return false;
  return /fail|error|cancel|abort|reject/.test(state);
}

function taskDone(task) {
  const state = String(task?.state || task?.status || "").toLowerCase();
  return /success|done|completed|finished|ok/.test(state);
}

async function loadCheckValidTask(taskId) {
  const id = String(taskId || "").trim();
  if (!id) return null;
  try {
    return unwrapTask(await getSteamTaskById(id));
  } catch (error) {
    logger.warn("getSteamTaskById failed", id, error?.message || error);
  }
  try {
    return unwrapTask(await getSteamTask(id));
  } catch (error) {
    logger.warn("getSteamTask failed", id, error?.message || error);
    return null;
  }
}

async function requestCheckValid(worker, sourceId) {
  const { id } = await assertOwnedLog(worker, sourceId);
  const task = unwrapTask(await createCheckValidTask(id));
  return {
    ok: true,
    pending: true,
    taskId: task?.id || task?.taskId || null,
    state: task?.state || task?.status || "created",
    name: task?.name || "Проверка на валид",
  };
}

async function pollCheckValidStatus(worker, sourceId, taskId) {
  await assertOwnedLog(worker, sourceId);
  const task = await loadCheckValidTask(taskId);
  const state = String(task?.state || task?.status || "");
  if (task && taskFailed(task)) {
    return {
      pending: false,
      failed: true,
      done: false,
      state,
      taskId: task?.id || taskId || null,
    };
  }
  if (task && taskDone(task)) {
    const log = await refreshLogDetail(worker, sourceId);
    return {
      pending: false,
      failed: false,
      done: true,
      state,
      taskId: task?.id || taskId || null,
      log,
    };
  }
  return {
    pending: true,
    failed: false,
    done: false,
    state: state || "pending",
    taskId: taskId || task?.id || null,
  };
}

module.exports = {
  requestSell,
  requestProcess,
  requestCheckValid,
  pollCheckValidStatus,
  getLogDetail,
  refreshLogDetail,
  // Test helpers
  inventoryByAppid,
  topInventoryItems,
  serializeInventoryItem,
  serializeGames,
  buildDetail,
};
