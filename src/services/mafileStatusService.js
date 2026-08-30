const { Input } = require("telegraf");
const SteamLog = require("../models/SteamLog");
const User = require("../models/User");
const { env } = require("../config/env");
const { telegramHtmlCaption, pe } = require("../utils/emoji");
const { logger } = require("../utils/logger");
const { getSteamAccountById } = require("./steamApiService");
const { buildAdminMaFilePhoto } = require("./steamLogAdminService");
const { renderSteamProfitImage } = require("../utils/steamImageRenderer");
const { resolveWorkerPhotoUrl } = require("../utils/profilePhoto");
const { addProfitToUserByTelegramId, reverseProfitTransactionById } = require("./profitService");
const { formatProfileOwnerLinkHtml } = require("./profileAccessService");
const { normalizeFakeProfitTag, formatFakeProfitTagLabel, randomFakeProfitTag } = require("../utils/fakeProfitTag");
const { logMafilePanelStatus } = require("./steamActivityLogService");

const MAFILE_STATUSES = new Set(["pending", "withdrawn", "invalid", "sold"]);

function normalizeMafileStatus(value) {
  const status = String(value || "pending").trim().toLowerCase();
  return MAFILE_STATUSES.has(status) ? status : "pending";
}

function money(value) {
  return `$${Math.max(0, Number(value) || 0).toFixed(2)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function workerPercentOf(user) {
  const fromUser = Number(user?.profitPercent);
  if (Number.isFinite(fromUser) && fromUser > 0) return Math.max(1, Math.min(100, fromUser));
  return Math.max(1, Math.min(100, Number(env.steamWorkerPercent) || 70));
}

function mafileStatusLabel(status, amount = 0, { workerShare = 0, workerPercent = 70 } = {}) {
  const normalized = normalizeMafileStatus(status);
  if (normalized === "withdrawn" || normalized === "sold") {
    const share = Number(workerShare) > 0
      ? ` · воркеру ${Math.round(Number(workerPercent) || 70)}% ${money(workerShare)}`
      : "";
    const label = normalized === "withdrawn" ? "Успешно снят" : "Продан";
    return `${label} (${money(amount)})${share}`;
  }
  if (normalized === "invalid") return "Невалид";
  return "В ожидании снятия";
}

function resolveCaptionFakeTag({ fakeTag = "", user = null } = {}) {
  const fromSnapshot = normalizeFakeProfitTag(fakeTag);
  if (fromSnapshot) return fromSnapshot;
  if (user?.isAnonymous) {
    return normalizeFakeProfitTag(user?.fakeProfitTag);
  }
  return "";
}

function formatTypeIdLabel(sourceId) {
  const id = String(sourceId || "").trim();
  if (!id) return "—";
  return /^\d+$/.test(id) ? `#${id}` : id;
}

function buildTypeIdLine(sourceId) {
  const label = formatTypeIdLabel(sourceId);
  if (label === "—") return "";
  return `${pe("file")} Тип: <code>${escapeHtml(label)}</code>`;
}

function channelMafileStatusLabel(status) {
  const normalized = normalizeMafileStatus(status);
  if (normalized === "withdrawn") return "Успешно снят";
  if (normalized === "sold") return "Продан";
  if (normalized === "invalid") return "Невалид";
  return "В ожидании снятия";
}

function channelOwnerDisplayName(user, telegramId) {
  if (user?.username) return String(user.username);
  if (user?.firstName) return String(user.firstName);
  const id = String(telegramId || "").trim();
  return id || "Воркер";
}

function formatSteamChannelOwnerLine(kind, { user = null, ownerTelegramId = "", fakeTag = "" } = {}) {
  const label = String(kind || "Лог").trim() || "Лог";
  const tag = resolveCaptionFakeTag({ fakeTag, user });
  if (tag) {
    return `<b>${escapeHtml(label)} у ${escapeHtml(formatFakeProfitTagLabel(tag))}</b> <code>[ID: Аноним]</code>`;
  }

  const telegramId = String(ownerTelegramId || "").trim();
  const anonymous = !user || user.isAnonymous;
  if (anonymous) {
    const fallback = randomFakeProfitTag();
    return `<b>${escapeHtml(label)} у ${escapeHtml(formatFakeProfitTagLabel(fallback))}</b> <code>[ID: Аноним]</code>`;
  }

  const displayName = channelOwnerDisplayName(user, telegramId);
  const idSuffix = telegramId ? ` <code>[ID: ${escapeHtml(telegramId)}]</code>` : "";
  const nameHtml = formatProfileOwnerLinkHtml(displayName, telegramId, env.botUsername);
  return `<b>${escapeHtml(label)} у ${nameHtml}</b>${idSuffix}`;
}

function buildMafileChannelCaption({
  sourceId = "",
  ownerTelegramId,
  user,
  total,
  balanceUsd = null,
  inventoryUsd = null,
  status,
  withdrawnAmount,
  workerShare = 0,
  workerPercent = 80,
  fakeTag = "",
}) {
  void withdrawnAmount;
  void workerShare;
  void workerPercent;
  void balanceUsd;
  void sourceId;

  const inventory = inventoryUsd == null
    ? Math.max(0, Number(total) || 0)
    : Math.max(0, Number(inventoryUsd) || 0);
  const statusLine = `└  Статус: <b>${channelMafileStatusLabel(status)}</b>`;
  const amountLine = `┌  Стоимость инвентаря: <b>${money(inventory)}</b>`;

  return [
    formatSteamChannelOwnerLine("MaFile", { user, ownerTelegramId, fakeTag }),
    "",
    amountLine,
    statusLine,
  ].join("\n");
}

async function getCaptionForLog(log) {
  let user = log.ownerTelegramId
    ? await User.findOne({ telegramId: String(log.ownerTelegramId) })
    : null;
  if (
    user?.isAnonymous &&
    !normalizeFakeProfitTag(log.mafileSnapshot?.fakeTag) &&
    !normalizeFakeProfitTag(user.fakeProfitTag)
  ) {
    user.fakeProfitTag = randomFakeProfitTag();
    await user.save();
  }
  const userLean = user ? (typeof user.toObject === "function" ? user.toObject() : user) : null;
  return buildMafileChannelCaption({
    sourceId: log.sourceId,
    ownerTelegramId: log.ownerTelegramId,
    user: userLean,
    total: log.totalProfit,
    balanceUsd: log.balanceUsd,
    inventoryUsd: log.inventoryUsd,
    status: log.mafileStatus,
    withdrawnAmount: log.mafileWithdrawnAmount,
    workerShare: log.mafileWorkerShare,
    workerPercent: log.mafileWorkerPercent || workerPercentOf(userLean),
    fakeTag: log.mafileSnapshot?.fakeTag || "",
  });
}

function serializeMafileLog(log, user) {
  const status = normalizeMafileStatus(log.mafileStatus);
  return {
    sourceId: String(log.sourceId || ""),
    createdAt: log.createdAt || null,
    updatedAt: log.updatedAt || null,
    accountUsername: String(log.accountUsername || ""),
    steamId: String(log.steamId || ""),
    ownerTelegramId: String(log.ownerTelegramId || ""),
    owner: user
      ? {
          telegramId: String(user.telegramId || ""),
          username: String(user.username || ""),
          firstName: String(user.firstName || ""),
          avatarUrl: resolveWorkerPhotoUrl(user),
        }
      : null,
    inventoryUsd: Number(log.inventoryUsd || 0),
    balanceUsd: Number(log.balanceUsd || 0),
    totalProfit: Number(log.totalProfit || 0),
    status,
    statusLabel: mafileStatusLabel(status, log.mafileWithdrawnAmount, {
      workerShare: log.mafileWorkerShare,
      workerPercent: log.mafileWorkerPercent || workerPercentOf(user),
    }),
    withdrawnAmount: Number(log.mafileWithdrawnAmount || 0),
    workerShare: Number(log.mafileWorkerShare || 0),
    workerPercent: Number(log.mafileWorkerPercent || 0),
    channelMessageId: String(log.channelMessageId || ""),
    statusUpdatedAt: log.mafileStatusUpdatedAt || null,
    isFake: Boolean(log.mafileSnapshot?.isFake),
    fakeTag: String(log.mafileSnapshot?.fakeTag || ""),
  };
}

async function listMafileLogs({ q = "", status = "", limit = 50 } = {}) {
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  const query = { logKind: "mafile" };
  if (String(status) === "pending") {
    query.$or = [{ mafileStatus: "pending" }, { mafileStatus: { $exists: false } }];
  } else if (MAFILE_STATUSES.has(String(status))) {
    query.mafileStatus = String(status);
  }
  const rows = await SteamLog.find(query).sort({ createdAt: -1 }).limit(200).lean();
  const ownerIds = [...new Set(rows.map((row) => String(row.ownerTelegramId || "")).filter(Boolean))];
  const users = ownerIds.length
    ? await User.find({ telegramId: { $in: ownerIds } }, { telegramId: 1, username: 1, firstName: 1, avatarUrl: 1 }).lean()
    : [];
  const byTelegramId = new Map(users.map((user) => [String(user.telegramId), user]));
  const needle = String(q || "").trim().toLowerCase();
  return rows
    .map((row) => serializeMafileLog(row, byTelegramId.get(String(row.ownerTelegramId || ""))))
    .filter((row) => {
      if (!needle) return true;
      return [row.sourceId, row.accountUsername, row.steamId, row.ownerTelegramId, row.owner?.username, row.owner?.firstName]
        .some((value) => String(value || "").toLowerCase().includes(needle));
    })
    .slice(0, safeLimit);
}

async function getMafileStatusStats() {
  const rows = await SteamLog.aggregate([
    { $match: { logKind: "mafile" } },
    {
      $group: {
        _id: { $ifNull: ["$mafileStatus", "pending"] },
        count: { $sum: 1 },
        inventoryUsd: { $sum: "$totalProfit" },
        withdrawnUsd: { $sum: "$mafileWithdrawnAmount" },
      },
    },
  ]);
  const statuses = { pending: 0, withdrawn: 0, invalid: 0, sold: 0 };
  let inventoryUsd = 0;
  let withdrawnUsd = 0;
  let soldUsd = 0;
  for (const row of rows) {
    const key = normalizeMafileStatus(row._id);
    statuses[key] += Number(row.count || 0);
    inventoryUsd += Number(row.inventoryUsd || 0);
    if (key === "sold") soldUsd += Number(row.withdrawnUsd || 0);
    else withdrawnUsd += Number(row.withdrawnUsd || 0);
  }
  return {
    statuses,
    total: statuses.pending + statuses.withdrawn + statuses.invalid + statuses.sold,
    inventoryUsd: Number(inventoryUsd.toFixed(2)),
    withdrawnUsd: Number(withdrawnUsd.toFixed(2)),
    soldUsd: Number(soldUsd.toFixed(2)),
  };
}

function isMissingTelegramMessage(error) {
  const desc = String(error?.response?.description || error?.message || "");
  return /message to edit not found|message to be replied not found|MESSAGE_ID_INVALID|chat not found/i.test(desc);
}

function workerShareForMafileImage(log) {
  const status = normalizeMafileStatus(log?.mafileStatus);
  const amount = Number(log?.mafileWithdrawnAmount || 0);
  const share = Number(log?.mafileWorkerShare || 0);
  const pct = Number(log?.mafileWorkerPercent || 0);
  if ((status === "withdrawn" || status === "sold") && amount > 0 && share > 0) {
    return { workerShare: share, workerPercent: pct || workerPercentOf(null) };
  }
  return { workerShare: null, workerPercent: null };
}

async function buildMafileProfitImage(log) {
  const shareOpts = workerShareForMafileImage(log);
  const snapshot = log?.mafileSnapshot;
  const isFake = String(log?.sourceId || "").startsWith("fake-mafile-") === true;
  let items = Array.isArray(snapshot?.items) ? snapshot.items : [];
  let games = Array.isArray(snapshot?.games) ? snapshot.games : [];
  const mafileTime = String(snapshot?.mafileTime || "");
  const missingIcons =
    items.length > 0 &&
    items.every((item) => !String(item?.icon || item?.icon_url || item?.iconUrl || "").trim());
  const needsLive = !isFake && (!items.length || !games.length || missingIcons);

  if (needsLive) {
    try {
      const raw = await getSteamAccountById(null, String(log.sourceId));
      const account = raw?.data || raw?.account || raw;
      const built = await buildAdminMaFilePhoto(account, {
        enrich: true,
        returnSnapshot: true,
        ...shareOpts,
      });
      if (built?.snapshot) {
        if (Array.isArray(built.snapshot.items) && built.snapshot.items.length) {
          if (missingIcons && items.length) {
            const iconByName = new Map(
              built.snapshot.items
                .map((item) => [
                  String(item?.itemHashName || item?.name || "").trim().toLowerCase(),
                  String(item?.icon || item?.icon_url || item?.iconUrl || "").trim(),
                ])
                .filter(([name, icon]) => name && icon)
            );
            items = items.map((item) => {
              const icon = String(item?.icon || item?.icon_url || item?.iconUrl || "").trim();
              if (icon) return item;
              const fallback = iconByName.get(
                String(item?.itemHashName || item?.name || "").trim().toLowerCase()
              );
              return fallback ? { ...item, icon: fallback } : item;
            });
          } else {
            items = built.snapshot.items;
          }
        }
        if (Array.isArray(built.snapshot.games) && built.snapshot.games.length) {
          games = built.snapshot.games;
        }
        log.mafileSnapshot = {
          ...(log.mafileSnapshot?.toObject?.() || log.mafileSnapshot || {}),
          isFake: false,
          items,
          games,
          mafileTime: built.snapshot.mafileTime || mafileTime,
        };
        await log.save();
        return renderSteamProfitImage({
          items,
          games,
          total: Number(log.totalProfit || built.snapshot.total || 0),
          balanceUsd: Number(log.balanceUsd ?? built.snapshot.balanceUsd ?? 0),
          inventoryUsd: Number(log.inventoryUsd ?? built.snapshot.inventoryUsd ?? 0),
          mafileTime: String(built.snapshot.mafileTime || mafileTime || ""),
          ...shareOpts,
        });
      }
    } catch (error) {
      logger.warn("MaFile profit image enrich failed", log.sourceId, error?.message || error);
    }
  }

  if (items.length || isFake) {
    return renderSteamProfitImage({
      items,
      games,
      total: Number(log.totalProfit || 0),
      balanceUsd: Number(log.balanceUsd || 0),
      inventoryUsd: Number(log.inventoryUsd || 0),
      mafileTime,
      ...shareOpts,
    });
  }

  return null;
}

async function republishMafileChannelCard(bot, log) {
  if (!env.steamProfitChannelId || !bot?.telegram?.sendPhoto) return false;
  const caption = await getCaptionForLog(log);
  const imageBuffer = await buildMafileProfitImage(log);
  if (!imageBuffer) return false;
  const sent = await bot.telegram.sendPhoto(
    env.steamProfitChannelId,
    Input.fromBuffer(imageBuffer, `steam-profit-${log.sourceId}.png`),
    telegramHtmlCaption(caption)
  );
  log.channelMessageId = String(sent.message_id || "");
  await log.save();
  return Boolean(log.channelMessageId);
}

/**
 * Обновление карточки в профит-канале.
 * allowRepublish=false (смена статуса): только edit — иначе дубликаты вместо правки.
 */
async function syncMafileChannelPhotoAndCaption(bot, log, { allowRepublish = false } = {}) {
  if (!env.steamProfitChannelId || !bot?.telegram) return false;
  const caption = await getCaptionForLog(log);
  const entityCaption = telegramHtmlCaption(caption);
  const imageBuffer = await buildMafileProfitImage(log);
  if (!imageBuffer) {
    return syncMafileChannelCaption(bot, log, { allowRepublish });
  }

  if (log.channelMessageId) {
    try {
      await bot.telegram.editMessageMedia(
        env.steamProfitChannelId,
        Number(log.channelMessageId),
        undefined,
        {
          type: "photo",
          media: Input.fromBuffer(imageBuffer, `steam-profit-${log.sourceId}.png`),
          caption: entityCaption.caption,
          caption_entities: entityCaption.caption_entities,
        }
      );
      return true;
    } catch (error) {
      const desc = error?.response?.description || error.message;
      if (/message is not modified/i.test(String(desc || ""))) return true;
      if (!isMissingTelegramMessage(error)) {
        // Иногда editMessageMedia падает на старых постах — пробуем хотя бы caption.
        const captionOk = await syncMafileChannelCaption(bot, log, { allowRepublish: false });
        if (captionOk) return true;
        logger.warn("MaFile channel photo update failed", log.sourceId, desc);
        return false;
      }
      logger.warn("MaFile channel message missing", log.sourceId, desc);
    }
  } else {
    logger.warn("MaFile channelMessageId missing, skip edit", log.sourceId);
  }

  if (!allowRepublish) return false;
  try {
    return await republishMafileChannelCard(bot, log);
  } catch (error) {
    logger.warn("MaFile channel republish failed", log.sourceId, error?.response?.description || error.message);
    return false;
  }
}

async function syncMafileChannelCaption(bot, log, { allowRepublish = false } = {}) {
  if (!env.steamProfitChannelId || !bot?.telegram) return false;
  const caption = await getCaptionForLog(log);
  const entityCaption = telegramHtmlCaption(caption);

  if (log.channelMessageId) {
    try {
      await bot.telegram.editMessageCaption(
        env.steamProfitChannelId,
        Number(log.channelMessageId),
        undefined,
        entityCaption.caption,
        { caption_entities: entityCaption.caption_entities }
      );
      return true;
    } catch (error) {
      const desc = error?.response?.description || error.message;
      if (/message is not modified/i.test(String(desc || ""))) return true;
      if (!isMissingTelegramMessage(error)) {
        logger.warn("MaFile channel caption update failed", log.sourceId, desc);
        return false;
      }
      logger.warn("MaFile channel message missing", log.sourceId, desc);
    }
  } else {
    logger.warn("MaFile channelMessageId missing, skip caption edit", log.sourceId);
  }

  if (!allowRepublish) return false;
  try {
    return await republishMafileChannelCard(bot, log);
  } catch (error) {
    logger.warn("MaFile channel republish failed", log.sourceId, error?.response?.description || error.message);
    return false;
  }
}

async function creditMafileProfit(log, amount, adminId, status) {
  const telegramId = String(log.ownerTelegramId || "").trim();
  if (!telegramId) throw new Error("У MaFile нет воркера — начислить 80% нельзя");
  const action = status === "withdrawn" ? "успешно снят" : "продан";
  const result = await addProfitToUserByTelegramId(
    telegramId,
    amount,
    adminId,
    `MaFile #${log.sourceId} ${action}`
  );
  if (!result?.user) throw new Error("Воркер не найден — начислить профит нельзя");
  log.mafileWorkerShare = Number(result.workerShare || 0);
  log.mafileWorkerPercent = Number(result.user.profitPercent || workerPercentOf(result.user));
  log.mafileProfitTransactionId = String(result.transaction?._id || "");
  return result;
}

async function reverseMafileProfit(log) {
  const txId = String(log.mafileProfitTransactionId || "").trim();
  if (txId) {
    await reverseProfitTransactionById(txId);
  }
  log.mafileProfitTransactionId = "";
  log.mafileWorkerShare = 0;
  log.mafileWorkerPercent = 0;
}

async function notifyWorkerMafileProfit(bot, telegramId, sourceId, amount, workerShare, workerPercent, status) {
  if (!bot?.telegram || !telegramId) return;
  const action = status === "withdrawn" ? "успешно снят" : "продан";
  try {
    await bot.telegram.sendMessage(
      telegramId,
      [
        `${pe("gift")} <b>MaFile ${action}</b>`,
        `ID: <code>${escapeHtml(sourceId)}</code>`,
        `Сумма: <b>${money(amount)}</b>`,
        `${pe("coins")} Твоя доля ${Math.round(workerPercent)}%: <b>${money(workerShare)}</b>`,
      ].join("\n"),
      { parse_mode: "HTML" }
    );
  } catch (error) {
    logger.warn("MaFile worker profit notify failed", sourceId, error?.response?.description || error.message);
  }
}

function parseSkipCredit(value) {
  if (value === true || value === 1) return true;
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

async function listPendingMafilesForOwner(telegramId, limit = 40) {
  const owner = String(telegramId || "").trim();
  if (!owner) return [];
  const rows = await SteamLog.find({
    ownerTelegramId: owner,
    logKind: "mafile",
    $or: [{ mafileStatus: "pending" }, { mafileStatus: { $exists: false } }, { mafileStatus: "" }],
  })
    .sort({ createdAt: -1 })
    .limit(Math.min(80, Math.max(1, Number(limit) || 40)))
    .lean();
  return rows.map((row) => ({
    sourceId: String(row.sourceId || ""),
    accountUsername: String(row.accountUsername || ""),
    inventoryUsd: Number(row.inventoryUsd || 0),
    totalProfit: Number(row.totalProfit || 0),
    createdAt: row.createdAt || null,
    status: normalizeMafileStatus(row.mafileStatus),
  }));
}

async function updateMafileStatus({
  bot,
  sourceId,
  status,
  amount,
  adminId,
  skipCredit = false,
  profitTransactionId = "",
  workerShare = null,
  workerPercent = null,
}) {
  const normalized = normalizeMafileStatus(status);
  if (String(status || "").toLowerCase() !== normalized) throw new Error("Неизвестный статус MaFile");
  const needsAmount = normalized === "withdrawn" || normalized === "sold";
  const withdrawnAmount = needsAmount ? Number(amount) : 0;
  if (needsAmount && (!Number.isFinite(withdrawnAmount) || withdrawnAmount < 0)) {
    throw new Error(normalized === "sold" ? "Укажите сумму продажи" : "Укажите корректную сумму снятия");
  }
  if (needsAmount && withdrawnAmount <= 0) {
    throw new Error(normalized === "sold" ? "Укажите сумму продажи больше 0" : "Укажите сумму снятия больше 0");
  }
  const log = await SteamLog.findOne({ sourceId: String(sourceId), logKind: "mafile" });
  if (!log) throw new Error("MaFile не найден");

  const skip = parseSkipCredit(skipCredit);
  const previousStatus = normalizeMafileStatus(log.mafileStatus);
  const previousAmount = Number(log.mafileWithdrawnAmount || 0);
  const alreadyCredited = Boolean(String(log.mafileProfitTransactionId || "").trim());
  const previousCreditable = previousStatus === "withdrawn" || previousStatus === "sold";
  const nextCreditable = normalized === "withdrawn" || normalized === "sold";
  const sameCredit = previousCreditable
    && nextCreditable
    && alreadyCredited
    && Math.abs(previousAmount - withdrawnAmount) < 0.005;

  if (alreadyCredited && !sameCredit && !skip) {
    await reverseMafileProfit(log);
  }

  log.mafileStatus = normalized;
  log.mafileWithdrawnAmount = Number((withdrawnAmount || 0).toFixed(2));
  log.mafileStatusUpdatedAt = new Date();
  log.mafileStatusUpdatedBy = String(adminId || "");

  let credited = null;
  if (nextCreditable && !sameCredit && !skip) {
    const telegramId = String(log.ownerTelegramId || "").trim();
    if (telegramId) {
      credited = await creditMafileProfit(log, withdrawnAmount, adminId, normalized);
    } else {
      const pct = workerPercentOf(null);
      log.mafileWorkerShare = Number((withdrawnAmount * pct / 100).toFixed(2));
      log.mafileWorkerPercent = pct;
    }
  } else if (nextCreditable && skip) {
    const txId = String(profitTransactionId || "").trim();
    if (txId) log.mafileProfitTransactionId = txId;
    if (workerShare != null && Number.isFinite(Number(workerShare))) {
      log.mafileWorkerShare = Number(Number(workerShare).toFixed(2));
    }
    if (workerPercent != null && Number.isFinite(Number(workerPercent))) {
      log.mafileWorkerPercent = Number(workerPercent);
    }
  }
  if (!nextCreditable && !skip) {
    log.mafileWorkerShare = 0;
    log.mafileWorkerPercent = 0;
    log.mafileProfitTransactionId = "";
  }
  await log.save();

  if (previousStatus !== normalized || Math.abs(previousAmount - withdrawnAmount) > 0.005) {
    void logMafilePanelStatus({
      sourceId: log.sourceId,
      fromStatus: previousStatus,
      toStatus: normalized,
      amount: withdrawnAmount,
    }).catch(() => {});
  }

  if (credited) {
    await notifyWorkerMafileProfit(
      bot,
      log.ownerTelegramId,
      log.sourceId,
      withdrawnAmount,
      credited.workerShare,
      credited.user.profitPercent,
      normalized
    );
  }

  // Смена статуса — только edit существующего поста, без sendPhoto-дубликата.
  const telegramUpdated = previousStatus !== normalized
    ? await syncMafileChannelPhotoAndCaption(bot, log, { allowRepublish: false })
    : await syncMafileChannelCaption(bot, log, { allowRepublish: false });
  const user = log.ownerTelegramId
    ? await User.findOne({ telegramId: String(log.ownerTelegramId) }).lean()
    : null;
  return {
    log: serializeMafileLog(log.toObject(), user),
    telegramUpdated,
    workerShare: Number(log.mafileWorkerShare || 0),
    workerPercent: Number(log.mafileWorkerPercent || 0),
  };
}

module.exports = {
  normalizeMafileStatus,
  mafileStatusLabel,
  formatSteamChannelOwnerLine,
  buildMafileChannelCaption,
  buildTypeIdLine,
  formatTypeIdLabel,
  workerShareForMafileImage,
  listMafileLogs,
  listPendingMafilesForOwner,
  getMafileStatusStats,
  parseSkipCredit,
  updateMafileStatus,
};
