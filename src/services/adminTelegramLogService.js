const { Input } = require("telegraf");
const SteamLog = require("../models/SteamLog");
const { env } = require("../config/env");
const { pe } = require("../utils/emoji");
const { logger } = require("../utils/logger");
const { getUserByTelegramId, getUserByPanelUsername } = require("./userService");
const { buildMafileChannelCaption, formatSteamChannelOwnerLine, workerShareForMafileImage } = require("./mafileStatusService");
const { getPanelToken } = require("../handlers/sitesHandler");
const { telegramHtmlCaption } = require("../utils/emoji");
const { renderSteamProfitImage } = require("../utils/steamImageRenderer");
const { resolveAccountGames } = require("../utils/steamAccountGames");
const { getSteamAccountById, getSteamAccountGames } = require("./steamApiService");
const { getCachedControlledAccount } = require("./steamControlService");
const {
  buildAdminLogPhoto,
  buildAdminMaFilePhoto,
  accountTotalUsd,
  classifyAccountLog,
  topItems,
} = require("./steamLogAdminService");
const { getUsdRubRate } = require("./settingsService");
const {
  getItem,
  resolveSaleAmounts,
  convertRubToUsd,
} = require("./lztMarketService");

const TARGETS = new Set(["profit", "worker", "chat"]);
const TELEGRAM_SEND_ATTEMPTS = 3;

function telegramErrorStatus(error) {
  return Number(
    error?.response?.error_code ||
    error?.response?.status ||
    error?.status ||
    0
  );
}

function isTransientTelegramError(error) {
  const status = telegramErrorStatus(error);
  const code = String(error?.code || "").toUpperCase();
  return (
    status === 429 ||
    status >= 500 ||
    ["ECONNRESET", "ECONNABORTED", "ETIMEDOUT", "EAI_AGAIN", "ENETUNREACH"].includes(code)
  );
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendPhotoWithRetry(
  telegram,
  { chatId, imageBuffer, filename, extra },
  { attempts = TELEGRAM_SEND_ATTEMPTS, sleep = wait } = {}
) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await telegram.sendPhoto(
        chatId,
        Input.fromBuffer(imageBuffer, filename),
        extra
      );
    } catch (error) {
      lastError = error;
      if (!isTransientTelegramError(error) || attempt + 1 >= attempts) throw error;
      const retryAfterSec = Number(error?.response?.parameters?.retry_after || 0);
      const delayMs = retryAfterSec > 0
        ? Math.min(5000, retryAfterSec * 1000)
        : 500 * (2 ** attempt);
      await sleep(delayMs);
    }
  }
  throw lastError;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function money(value) {
  return `$${Math.max(0, Number(value) || 0).toFixed(2)}`;
}

function parseUsdNumber(value) {
  if (value && typeof value === "object") return parseUsdNumber(value.usd ?? value.value ?? value.amount ?? value.total ?? value.price);
  if (typeof value === "string") {
    const parsed = Number(value.replace(/\s+/g, "").replace(",", ".").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function inventoryUsd(account) {
  const price = account?.inventory?.price || {};
  for (const key of ["tradable", "marketable", "total"]) {
    const value = parseUsdNumber(price[key]);
    if (value > 0) return value;
  }
  return 0;
}

function balanceUsd(account) {
  const steam = account?.steamInfo || {};
  return Math.max(0, parseUsdNumber(steam.balanceUsd ?? steam.balance ?? 0));
}

async function resolveOwner(account) {
  const telegramId = String(account?.owner?.telegram || "").trim();
  if (telegramId) {
    return { telegramId, user: await getUserByTelegramId(telegramId) };
  }
  const panelUsername = String(account?.owner?.username || "").trim();
  if (panelUsername) {
    const user = await getUserByPanelUsername(panelUsername);
    if (user?.telegramId) return { telegramId: String(user.telegramId), user };
  }
  return { telegramId: "", user: null };
}

function ownerLink(owner) {
  const id = String(owner?.telegramId || "").trim();
  const user = owner?.user;
  const label = user?.firstName || (user?.username ? `@${user.username}` : "") || (id ? `ID ${id}` : "Не назначен");
  return id ? `<a href="tg://user?id=${escapeHtml(id)}">${escapeHtml(label)}</a>` : escapeHtml(label);
}

function accountStatus(account) {
  const value = String(account?.statusLabel || account?.status || "—");
  return value || "—";
}

function buildPrivateCaption(account) {
  const isMafile = classifyAccountLog(account) === "mafile";
  return [
    `${pe(isMafile ? "gift" : "celebrate")} <b>${isMafile ? "Найден новый MaFile" : "Получен новый лог"}</b>`,
    `<code>#${escapeHtml(account?.id || "—")}</code> · ${escapeHtml(account?.username || account?.steamInfo?.nickname || "Steam")}`,
    "",
    `${pe("coins")} Стоимость: <b>${money(accountTotalUsd(account))}</b>`,
    `└ Баланс: ${money(balanceUsd(account))}`,
    `└ Инвентарь: ${money(inventoryUsd(account))}`,
    `└ Статус: <b>${escapeHtml(accountStatus(account))}</b>`,
  ].join("\n");
}

function buildTeamCaption(account, owner) {
  const isMafile = classifyAccountLog(account) === "mafile";
  return [
    `${pe(isMafile ? "gift" : "package")} <b>${isMafile ? "Новый MaFile" : "Новый лог"}</b>`,
    `${pe("profile")} Воркер: ${ownerLink(owner)}`,
    `${pe("file")} ID: <code>${escapeHtml(account?.id || "—")}</code>`,
    `${pe("coins")} Стоимость: <b>${money(accountTotalUsd(account))}</b>`,
    `└ Статус: <b>${escapeHtml(accountStatus(account))}</b>`,
  ].join("\n");
}

async function buildMafileImageFromSnapshot(log, account, shareOpts = {}) {
  const snapshot = log?.mafileSnapshot || account?.mafileSnapshot || {};
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  if (!items.length) return null;
  return renderSteamProfitImage({
    items,
    games: Array.isArray(snapshot.games) ? snapshot.games : [],
    total: Number(log?.totalProfit || accountTotalUsd(account) || 0),
    balanceUsd: Number(log?.balanceUsd ?? balanceUsd(account) ?? 0),
    inventoryUsd: Number(log?.inventoryUsd ?? inventoryUsd(account) ?? 0),
    mafileTime: String(snapshot.mafileTime || ""),
    ...shareOpts,
  });
}

function enrichAccountForLocalImage(account, localLog) {
  if (!localLog) return account;
  const games = Array.isArray(localLog.mafileSnapshot?.games) ? localLog.mafileSnapshot.games : [];
  const inventoryUsdValue = Number(localLog.inventoryUsd || 0);
  const balanceUsdValue = Number(localLog.balanceUsd || 0);
  const steamId = String(localLog.steamId || account?.steamInfo?.steamid || "").trim();
  return {
    ...account,
    isMaFile: account?.isMaFile || localLog.logKind === "mafile",
    mafileSnapshot: account?.mafileSnapshot || localLog.mafileSnapshot || {},
    gamesInfo: games.length ? games : (account?.gamesInfo || account?.games || []),
    games: games.length ? games : (account?.games || account?.gamesInfo || []),
    gamesCount: games.length || account?.gamesCount || 0,
    steamInfo: {
      ...(account?.steamInfo || {}),
      steamid: account?.steamInfo?.steamid || (/^7656119\d{10}$/.test(steamId) ? steamId : ""),
      nickname: account?.steamInfo?.nickname || localLog.accountUsername || account?.username || "",
      balanceUsd: account?.steamInfo?.balanceUsd ?? balanceUsdValue,
    },
    inventory: {
      ...(account?.inventory || {}),
      price: account?.inventory?.price?.total
        ? account.inventory.price
        : {
            tradable: inventoryUsdValue,
            marketable: inventoryUsdValue,
            total: inventoryUsdValue,
          },
    },
  };
}

function firstMeaningful(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && !value.trim()) continue;
    if (Array.isArray(value) && !value.length) continue;
    return value;
  }
  return undefined;
}

/**
 * Загружает аккаунт из UProject. Строка, пришедшая из панели, содержит только те поля,
 * которые рисует таблица, поэтому она не заменяет запрос, а лишь дополняет ответ.
 */
async function fetchRemoteAccount(sourceId) {
  const id = String(sourceId || "").trim();
  if (!id) return null;
  try {
    const raw = await getSteamAccountById(null, id);
    const account = raw?.data || raw?.account || raw;
    if (account && typeof account === "object") return account;
  } catch (error) {
    logger.warn("Steam account fetch failed, falling back to cache", id, error?.message || error);
  }
  return getCachedControlledAccount(id) || null;
}

/**
 * Данные UProject приоритетнее локальных: строка панели несёт нулевые заглушки баланса
 * и инвентаря, которые иначе затёрли бы реальные значения.
 */
function mergeRemoteAccount(local, remote) {
  if (!remote) return local;
  const localSteam = local?.steamInfo || {};
  const remoteSteam = remote.steamInfo || {};

  return {
    ...local,
    ...remote,
    id: String(local?.id || remote.id || ""),
    isMaFile: local?.isMaFile === true || remote.isMaFile === true,
    username: firstMeaningful(remote.username, local?.username) || "",
    status: firstMeaningful(remote.status, local?.status) || "",
    statusLabel: firstMeaningful(remote.statusLabel, local?.statusLabel) || "",
    owner: firstMeaningful(remote.owner, local?.owner) || null,
    steamInfo: {
      ...localSteam,
      ...remoteSteam,
      steamid: firstMeaningful(remoteSteam.steamid, localSteam.steamid) || "",
      nickname: firstMeaningful(remoteSteam.nickname, localSteam.nickname) || "",
      balanceUsd: firstMeaningful(
        remoteSteam.balanceUsd,
        remoteSteam.balance,
        localSteam.balanceUsd,
      ) ?? 0,
    },
    inventory: inventoryUsd(remote) > 0
      ? remote.inventory
      : firstMeaningful(remote.inventory, local?.inventory) || {},
    gamesInfo: firstMeaningful(remote.gamesInfo, remote.games, local?.gamesInfo, local?.games) || [],
    games: firstMeaningful(remote.games, remote.gamesInfo, local?.games, local?.gamesInfo) || [],
    mafileSnapshot: firstMeaningful(local?.mafileSnapshot, remote.mafileSnapshot) || {},
    mafileSessionAvailableAt: firstMeaningful(
      remote.mafileSessionAvailableAt,
      local?.mafileSessionAvailableAt,
      local?.mafileSnapshot?.mafileTime,
    ) || "",
  };
}

async function resolvePanelToken(account) {
  const owner = await resolveOwner(account);
  if (!owner.user?.panelUsername || !owner.user?.panelPassword) return null;
  try {
    return (await getPanelToken(owner.user))?.token || null;
  } catch (_) {
    return null;
  }
}

async function persistMafileSnapshot(sourceId, snapshot, localLog, totals = {}) {
  if (!sourceId || !snapshot) return;
  try {
    await SteamLog.updateOne(
      { sourceId: String(sourceId) },
      {
        $set: {
          mafileSnapshot: {
            ...(localLog?.mafileSnapshot || {}),
            isFake: false,
            items: Array.isArray(snapshot.items) ? snapshot.items : [],
            games: Array.isArray(snapshot.games) ? snapshot.games : [],
            mafileTime: String(snapshot.mafileTime || localLog?.mafileSnapshot?.mafileTime || ""),
          },
          ...(totals.steamId ? { steamId: String(totals.steamId) } : {}),
          ...(Number.isFinite(Number(totals.balanceUsd)) ? { balanceUsd: Number(totals.balanceUsd) } : {}),
          ...(Number.isFinite(Number(totals.inventoryUsd)) ? { inventoryUsd: Number(totals.inventoryUsd) } : {}),
          ...(Number.isFinite(Number(totals.totalProfit)) ? { totalProfit: Number(totals.totalProfit) } : {}),
        },
      },
    );
  } catch (error) {
    logger.warn("MaFile snapshot persist failed", sourceId, error.message);
  }
}

function snapshotHasItems(log, account) {
  const snapshot = log?.mafileSnapshot || account?.mafileSnapshot || {};
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  return items.some((item) => Number(item?.price || 0) > 0);
}

function renderFallbackMafileImage(account, localLog, shareOpts = {}) {
  const enriched = enrichAccountForLocalImage(account, localLog);
  const snapshot = localLog?.mafileSnapshot || enriched?.mafileSnapshot || {};
  return renderSteamProfitImage({
    items: [],
    games: Array.isArray(snapshot.games) ? snapshot.games : [],
    total: Number(localLog?.totalProfit || accountTotalUsd(enriched) || 0),
    balanceUsd: Number(localLog?.balanceUsd ?? balanceUsd(enriched) ?? 0),
    inventoryUsd: Number(localLog?.inventoryUsd ?? inventoryUsd(enriched) ?? 0),
    mafileTime: String(snapshot.mafileTime || ""),
    ...shareOpts,
  });
}

async function enrichMafileTelegramImage(account, localLog, shareOpts = {}) {
  const sourceId = String(account?.id || localLog?.sourceId || "").trim();
  if (!sourceId || sourceId.startsWith("fake-mafile-")) return null;

  const remote = await fetchRemoteAccount(sourceId);
  const merged = mergeRemoteAccount(account, remote);
  merged.id = sourceId;
  merged.isMaFile = true;
  merged.status = merged.status || "MaFile";
  merged.statusLabel = merged.statusLabel || "MaFile";

  const hasEmbeddedItems = topItems(merged.inventory || {}).length > 0;
  if (!remote && !hasEmbeddedItems && !String(merged.steamInfo?.steamid || "").trim()) {
    return null;
  }

  const token = await resolvePanelToken(merged);

  try {
    const built = await buildAdminMaFilePhoto(merged, {
      enrich: !hasEmbeddedItems,
      token,
      returnSnapshot: true,
      ...shareOpts,
    });
    if (!built?.imageBuffer) return null;

    const snapshot = built.snapshot || {};
    const balanceUsdValue = Number(snapshot.balanceUsd ?? localLog?.balanceUsd ?? 0);
    const inventoryUsdValue = Number(snapshot.inventoryUsd ?? localLog?.inventoryUsd ?? 0);
    const steamId = String(snapshot.steamId || merged.steamInfo?.steamid || "");

    // Аккаунт синхронизируется с числами, которые уже нарисованы на карточке,
    // иначе подпись сообщения покажет устаревшие нули.
    merged.steamInfo = { ...merged.steamInfo, steamid: steamId, balanceUsd: balanceUsdValue };
    merged.inventory = {
      ...(merged.inventory || {}),
      price: { tradable: inventoryUsdValue, marketable: inventoryUsdValue, total: inventoryUsdValue },
    };

    if (snapshot.items?.length || snapshot.games?.length) {
      await persistMafileSnapshot(sourceId, snapshot, localLog, {
        steamId,
        balanceUsd: balanceUsdValue,
        inventoryUsd: inventoryUsdValue,
        totalProfit: Number(snapshot.total ?? (balanceUsdValue + inventoryUsdValue).toFixed(2)),
      });
    }

    return { imageBuffer: built.imageBuffer, account: merged };
  } catch (error) {
    logger.warn("MaFile telegram enrich failed", sourceId, error?.message || error);
    return null;
  }
}

async function buildLogTelegramImage(account, localLog) {
  const local = enrichAccountForLocalImage(account, localLog);
  const sourceId = String(account?.id || localLog?.sourceId || "").trim();
  const enriched = sourceId
    ? mergeRemoteAccount(local, await fetchRemoteAccount(sourceId))
    : local;

  if (!(enriched.gamesInfo || enriched.games || []).length && sourceId) {
    try {
      const games = await resolveAccountGames(enriched, sourceId, getSteamAccountGames, {
        retries: 3,
        retryDelayMs: 1800,
        fallbackItems: Array.isArray(enriched.inventory?.items) ? enriched.inventory.items : [],
        fallbackInventory: enriched.inventory || null,
      });
      if (games.length) {
        enriched.gamesInfo = games;
        enriched.games = games;
        enriched.gamesCount = games.length;
      }
    } catch (error) {
      logger.warn("Log telegram games fetch failed", sourceId, error?.message || error);
    }
  }

  return { imageBuffer: await buildAdminLogPhoto(enriched), account: enriched };
}

/**
 * Возвращает пикчу вместе с аккаунтом, на данных которого она построена, чтобы подпись
 * сообщения не расходилась с числами на карточке.
 */
async function buildLocalTelegramImage(account, localLog, shareOpts = {}) {
  const enriched = enrichAccountForLocalImage(account, localLog);
  if (classifyAccountLog(enriched) !== "mafile") {
    return buildLogTelegramImage(account, localLog);
  }

  if (snapshotHasItems(localLog, enriched)) {
    const snapGames = Array.isArray(localLog?.mafileSnapshot?.games)
      ? localLog.mafileSnapshot.games
      : Array.isArray(enriched?.mafileSnapshot?.games)
        ? enriched.mafileSnapshot.games
        : [];
    // Предметы без игр — не рисуем «пустой» блок: идём в live enrich.
    if (snapGames.length) {
      const snapshotImage = await buildMafileImageFromSnapshot(localLog, enriched, shareOpts);
      if (snapshotImage) return { imageBuffer: snapshotImage, account: enriched };
    }
  }

  const built = await enrichMafileTelegramImage(enriched, localLog, shareOpts);
  if (built) return built;

  return {
    imageBuffer: await renderFallbackMafileImage(enriched, localLog, shareOpts),
    account: enriched,
  };
}

function logChannelStatusLabel(account, localLog = null) {
  const auto = String(localLog?.autoSaleStatus || "").trim().toLowerCase();
  if (auto === "queued" || auto === "listing" || auto === "listed") return "Продается";
  if (auto === "sold_held" || auto === "arbitration") return "На холде";
  if (auto === "released") return "Продан";
  if (auto === "refunded") return "Возврат";
  if (auto === "failed") return "Невалид";

  const status = String(account?.statusLabel || account?.status || localLog?.accountStatus || "").trim();
  if (/onsell|on sell|on_sell|прода/i.test(status)) return "Продается";
  if (/sold|продан/i.test(status)) return "Продан";
  if (/onhold|on hold|холд/i.test(status)) return "На холде";
  if (/^(ok|valid|валид)$/i.test(status)) return "Ok";
  if (/invalid|невалид/i.test(status)) return "Невалид";
  if (/empty|пуст/i.test(status)) return "Пустой";
  if (/processing|обработ/i.test(status)) return "В обработке";
  return status || "—";
}

function pushLztItemId(target, value) {
  const id = String(value || "").trim();
  if (/^\d+$/.test(id)) target.push(id);
}

/** LZT lot ids from SteamLog / UProject (active or awaiting). */
function collectLztItemIds(account, localLog = null) {
  const ids = [];
  pushLztItemId(ids, localLog?.lztItemId);
  pushLztItemId(ids, account?.lztLinkId);
  pushLztItemId(ids, account?.lzt_link_id);
  for (const list of [
    account?.lztPossibleLinkIDs,
    account?.lztPossibleLinkIds,
    account?.lzt_possible_link_ids,
  ]) {
    if (Array.isArray(list)) list.forEach((value) => pushLztItemId(ids, value));
  }
  return [...new Set(ids)];
}

/**
 * Approximate LZT sale price (not Steam balance+inventory).
 * Prefer stored autosale amounts, then live LZT lot price.
 */
async function resolveApproximateSaleUsd(account, localLog = null) {
  const stored = Number(localLog?.autoSaleGrossUsd || 0);
  if (stored > 0) return Number(stored.toFixed(2));

  let rate = 0;
  try {
    rate = Number(await getUsdRubRate()) || 0;
  } catch (_) {
    /* rate optional when LZT returns USD */
  }

  const storedRub = Number(localLog?.autoSalePriceRub || 0);
  if (storedRub > 0 && rate > 0) {
    try {
      return convertRubToUsd(storedRub, rate);
    } catch (_) {
      /* continue to LZT */
    }
  }

  for (const itemId of collectLztItemIds(account, localLog)) {
    try {
      const item = await getItem(itemId);
      const { grossUsd, priceRub } = resolveSaleAmounts(item, rate);
      if (grossUsd > 0) return Number(grossUsd.toFixed(2));
      if (priceRub > 0 && rate > 0) return convertRubToUsd(priceRub, rate);
    } catch (error) {
      logger.warn("LZT sale price lookup failed", itemId, error?.message || error);
    }
  }

  return 0;
}

async function buildProfitCaption(account, owner, localLog) {
  if (localLog?.convertedFromMafile) {
    return buildMafileChannelCaption({
      sourceId: account?.id || localLog?.sourceId,
      ownerTelegramId: owner.telegramId,
      user: owner.user,
      total: accountTotalUsd(account),
      balanceUsd: balanceUsd(account),
      inventoryUsd: inventoryUsd(account),
      status: localLog?.mafileStatus || "pending",
      withdrawnAmount: Number(localLog?.mafileWithdrawnAmount || 0),
      workerShare: Number(localLog?.mafileWorkerShare || 0),
      workerPercent: Number(localLog?.mafileWorkerPercent || 0),
    });
  }
  if (classifyAccountLog(account) === "mafile") {
    return buildMafileChannelCaption({
      sourceId: account?.id || localLog?.sourceId,
      ownerTelegramId: owner.telegramId,
      user: owner.user,
      total: accountTotalUsd(account),
      balanceUsd: balanceUsd(account),
      inventoryUsd: inventoryUsd(account),
      status: localLog?.mafileStatus || "pending",
      withdrawnAmount: Number(localLog?.mafileWithdrawnAmount || 0),
      workerShare: Number(localLog?.mafileWorkerShare || 0),
      workerPercent: Number(localLog?.mafileWorkerPercent || 0),
    });
  }

  const saleUsd = await resolveApproximateSaleUsd(account, localLog);
  const saleLabel = saleUsd > 0 ? money(saleUsd) : "—";

  return [
    formatSteamChannelOwnerLine("Лог", {
      user: owner.user,
      ownerTelegramId: owner.telegramId,
      fakeTag: owner.user?.fakeProfitTag || localLog?.mafileSnapshot?.fakeTag || "",
    }),
    "",
    `┌  Примерная стоимость продажи: <b>${saleLabel}</b>`,
    `└  Статус: <b>${escapeHtml(logChannelStatusLabel(account, localLog))}</b>`,
  ].join("\n");
}

/**
 * Update profit-channel caption for a log or MaFile after status / price changes.
 * @param {object} telegramOrBot - Telegraf bot or telegram API
 * @param {object} log - SteamLog document
 * @param {object|null} account - optional UProject account
 */
async function syncProfitChannelCaption(telegramOrBot, log, account = null) {
  if (!log) return false;
  const telegram = telegramOrBot?.telegram || telegramOrBot;
  if (!telegram) return false;
  if (!String(log.channelMessageId || "").trim()) return false;
  if (log.convertedFromMafile) return false;

  if (String(log.logKind || "") === "mafile") {
    const { syncMafileChannelCaption } = require("./mafileStatusService");
    const bot = telegramOrBot?.telegram ? telegramOrBot : { telegram };
    return syncMafileChannelCaption(bot, log, { allowRepublish: false });
  }
  return syncValidLogProfitCaption(telegram, log, account);
}

/** Refresh profit-channel caption when LZT listing price becomes known. */
async function syncValidLogProfitCaption(telegram, log, account = null) {
  const messageId = Number(log?.channelMessageId || 0);
  const chatId = env.steamProfitChannelId || env.steamManualProfitChannelId;
  if (!telegram?.editMessageCaption || !messageId || !chatId) return false;
  if (String(log?.logKind || "") === "mafile") return false;
  if (log?.convertedFromMafile) return false;

  let acc = account;
  if (!acc || typeof acc !== "object") {
    acc = (await fetchRemoteAccount(log?.sourceId)) || {};
  }

  const ownerTelegramId = String(log?.ownerTelegramId || "").trim();
  const owner = {
    telegramId: ownerTelegramId,
    user: ownerTelegramId ? await getUserByTelegramId(ownerTelegramId) : null,
  };
  const caption = await buildProfitCaption(acc, owner, log);
  const entityCaption = telegramHtmlCaption(caption);
  try {
    await telegram.editMessageCaption(chatId, messageId, undefined, entityCaption.caption, {
      caption_entities: entityCaption.caption_entities,
    });
    return true;
  } catch (error) {
    const desc = String(error?.response?.description || error?.message || "");
    if (/message is not modified/i.test(desc)) return true;
    logger.warn("Valid log profit caption sync failed", log?.sourceId, desc);
    return false;
  }
}

async function sendAccountCardToTelegram(bot, account, target, { localLog: localLogOverride } = {}) {
  const destination = String(target || "").trim();
  if (!TARGETS.has(destination)) throw new Error("Неизвестный сценарий отправки");
  if (!bot?.telegram?.sendPhoto) throw new Error("Telegram-бот сейчас недоступен");
  const owner = await resolveOwner(account);
  if (destination === "worker" && !owner.telegramId) {
    throw new Error("У аккаунта не найден Telegram воркера");
  }
  const localLog = localLogOverride
    || await SteamLog.findOne({ sourceId: String(account?.id || "") }).lean();
  const isMafile = classifyAccountLog(enrichAccountForLocalImage(account, localLog)) === "mafile";
  const shareOpts = localLog && isMafile ? workerShareForMafileImage(localLog) : {};
  const { imageBuffer, account: cardAccount } = await buildLocalTelegramImage(account, localLog, shareOpts);
  if (!imageBuffer) throw new Error("Не удалось сформировать изображение аккаунта");

  const chatId = destination === "profit"
    ? env.steamManualProfitChannelId
    : destination === "chat"
      ? env.steamManualTeamChatId
      : owner.telegramId;
  if (!chatId) {
    const err = new Error(
      destination === "profit"
        ? "Не настроен канал профитов (STEAM_MANUAL_PROFIT_CHANNEL_ID)"
        : destination === "chat"
          ? "Не настроен чат команды (STEAM_MANUAL_TEAM_CHAT_ID)"
          : "Не настроен Telegram-чат для отправки"
    );
    err.status = 400;
    throw err;
  }

  const caption = destination === "profit"
    ? await buildProfitCaption(cardAccount, owner, localLog)
    : destination === "chat"
      ? buildTeamCaption(cardAccount, owner)
      : buildPrivateCaption(cardAccount);

  try {
    const message = await sendPhotoWithRetry(bot.telegram, {
      chatId,
      imageBuffer,
      filename: `garbona-${isMafile ? "mafile" : "log"}-${account?.id || Date.now()}.png`,
      extra: telegramHtmlCaption(caption),
    });
    return {
      target: destination,
      chatId: String(message?.chat?.id || chatId),
      messageId: String(message?.message_id || ""),
      ownerTelegramId: owner.telegramId,
    };
  } catch (error) {
    const desc = String(error?.response?.description || error?.message || "");
    const transient = isTransientTelegramError(error);
    const err = new Error(
      transient
        ? "Telegram временно недоступен. Отправка не прошла после 3 попыток"
        : /chat not found/i.test(desc)
        ? "Telegram не находит чат — проверьте ID канала и что бот добавлен админом"
        : /not enough rights|can't initiate|forbidden/i.test(desc)
          ? "У бота нет прав писать в этот канал"
          : desc || "Не удалось отправить в Telegram"
    );
    err.status = transient ? 503 : telegramErrorStatus(error) || 400;
    throw err;
  }
}

module.exports = {
  TARGETS,
  buildPrivateCaption,
  buildTeamCaption,
  buildProfitCaption,
  buildMafileImageFromSnapshot,
  buildLocalTelegramImage,
  enrichMafileTelegramImage,
  enrichAccountForLocalImage,
  resolveApproximateSaleUsd,
  syncValidLogProfitCaption,
  syncProfitChannelCaption,
  isTransientTelegramError,
  sendPhotoWithRetry,
  sendAccountCardToTelegram,
};
