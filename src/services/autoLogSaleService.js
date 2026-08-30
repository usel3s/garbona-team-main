const SteamLog = require("../models/SteamLog");
const User = require("../models/User");
const { env } = require("../config/env");
const { logger } = require("../utils/logger");
const { createSteamTask, getSteamTask, getSteamAccountById, getSteamAccounts } = require("./steamApiService");
const { getUsdRubRate } = require("./settingsService");
const {
  reverseProfitTransactionById,
  creditWalletBalanceUsd,
} = require("./profitService");
const ProfitTransaction = require("../models/ProfitTransaction");
const { CREDIT_KINDS } = ProfitTransaction;
const {
  getItem,
  readPriceRub,
  resolveSaleAmounts,
  readHoldInfo,
  classifyLztSaleState,
  convertRubToUsd,
  workerShareFromGross,
  fetchActiveClaimByItemId,
  fetchLztOnSaleStats,
} = require("./lztMarketService");
const { logAutoSaleEvent } = require("./steamActivityLogService");
const { pe } = require("../utils/emoji");
const { syncProfitChannelCaption } = require("./adminTelegramLogService");
const {
  applyTeamShareDebits,
  sumTeamShareDebits,
} = require("./teamShareLedgerService");

const ACTIVE_LISTING = new Set(["queued", "listing"]);
const ACTIVE_MONITOR = new Set(["listed", "sold_held", "arbitration"]);
const UNCREDITED_SOLD = new Set(["sold_held", "arbitration", "released"]);
/** LZT lots reconciled per monitor tick (fair-rotated by autoSalePolledAt). */
const MONITOR_BATCH = Math.max(
  50,
  Number(process.env.AUTO_LOG_SALE_MONITOR_BATCH) || 120
);
const BLOCKED_ENQUEUE = new Set([
  "queued",
  "listing",
  "listed",
  "sold_held",
  "arbitration",
  "released",
]);
const AUTO_SALE_RANK = {
  none: 0,
  failed: 0,
  queued: 1,
  listing: 2,
  listed: 3,
  sold_held: 4,
  arbitration: 4,
  released: 5,
};

let monitorTimer = null;
let monitorRunning = false;
let syncRunning = false;
let telegramApi = null;

function bindTelegram(telegram) {
  if (telegram?.sendMessage) telegramApi = telegram;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function moneyUsdLabel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "$0.00";
  return `$${n.toFixed(2)}`;
}

const DEFAULT_HOLD_DURATION_SHORT = "12ч";

/** Short guarantee label for worker-facing copy: "12 часов" → "12ч". */
function shortHoldDurationPhrase(phrase, fallback = DEFAULT_HOLD_DURATION_SHORT) {
  const raw = String(phrase || "").trim();
  if (!raw) return fallback;
  const compact = raw.replace(/\s+/g, "");
  const shortMatch = compact.match(/^(\d+)([чмдhmd])$/i);
  if (shortMatch) {
    const unitMap = { ч: "ч", h: "ч", м: "м", m: "м", д: "д", d: "д" };
    const unit = unitMap[shortMatch[2].toLowerCase()] || "ч";
    return `${shortMatch[1]}${unit}`;
  }
  const hours = raw.match(/(\d+)\s*час/i);
  if (hours) return `${hours[1]}ч`;
  const days = raw.match(/(\d+)\s*д(ень|ня|ней)?/i);
  if (days) return `${days[1]}д`;
  const mins = raw.match(/(\d+)\s*мин/i);
  if (mins) return `${mins[1]}м`;
  if (raw.length <= 6) return raw;
  return fallback;
}

function autoSaleHoldSoldNote(durationPhrase) {
  return `Ваш лог был успешно продан, средства начислены и заморожены на ${shortHoldDurationPhrase(durationPhrase)}.`;
}

const AUTO_SALE_HOLD_RELEASED_NOTE = "Ваш лог продан · средства разморожены";

const AUTO_SALE_NOTIFY_EVENT_KEYS = {
  Выставление: "listing",
  "На продаже": "listed",
  "Продан · холд": "sold_held",
  Арбитраж: "arbitration",
  "Арбитраж закрыт": "arbitration_closed",
  "Холд снят": "released",
  "Продажа отменена": "refunded",
  Ошибка: "failed",
  Невалид: "invalid",
};

function autoSaleNotifyPath(key) {
  return `autoSaleActivityNotified.${key}`;
}

function isUnsetDateFilter(path) {
  return {
    $or: [{ [path]: null }, { [path]: { $exists: false } }],
  };
}

/**
 * Atomically claim a one-shot activity/DM notification slot.
 * Returns false if this event was already notified (restart-safe).
 */
async function claimAutoSaleNotify(log, key, options = {}) {
  if (!log?._id || !key) return false;
  const path = autoSaleNotifyPath(key);
  const filter = { _id: log._id };
  const $set = { [path]: new Date() };

  if (key === "failed" || key === "invalid") {
    const detail = String(options.detail || "").slice(0, 500);
    filter.$and = [
      {
        $or: [
          ...isUnsetDateFilter(path).$or,
          { "autoSaleActivityNotifyKeys.failedDetail": { $ne: detail } },
        ],
      },
    ];
    $set["autoSaleActivityNotifyKeys.failedDetail"] = detail;
  } else if (key === "arbitration") {
    const threadId = String(options.threadId || "").trim();
    filter.$and = [
      {
        $or: [
          ...isUnsetDateFilter(path).$or,
          { "autoSaleActivityNotifyKeys.arbitrationThreadId": { $ne: threadId } },
        ],
      },
    ];
    $set["autoSaleActivityNotifyKeys.arbitrationThreadId"] = threadId;
    // New claim cycle may close again later.
    $set[autoSaleNotifyPath("arbitration_closed")] = null;
  } else {
    Object.assign(filter, isUnsetDateFilter(path));
  }

  const updated = await SteamLog.findOneAndUpdate(filter, { $set }, { new: true });
  if (updated) {
    log.autoSaleActivityNotified = updated.autoSaleActivityNotified;
    log.autoSaleActivityNotifyKeys = updated.autoSaleActivityNotifyKeys;
  }
  return Boolean(updated);
}

function notifyAutoSale(log, event, detail = "") {
  const sourceId = String(log?.sourceId || "").trim();
  if (!sourceId) return;
  const key = AUTO_SALE_NOTIFY_EVENT_KEYS[event];
  if (!key) {
    void logAutoSaleEvent({ sourceId, event, detail }).catch(() => {});
    return;
  }
  void (async () => {
    const claimed = await claimAutoSaleNotify(log, key, {
      detail: key === "failed" || key === "invalid" ? detail : "",
      threadId:
        key === "arbitration"
          ? String(log?.autoSaleClaimThreadId || detail || "").replace(/[^\d]/g, "")
          : "",
    });
    if (!claimed) return;
    await logAutoSaleEvent({ sourceId, event, detail });
  })().catch(() => {});
}

/** Persist LZT listing price and refresh profit-channel caption. */
async function refreshListedSalePrice(log, itemOrNull = null) {
  if (!log) return false;
  let item = itemOrNull;
  if (!item) {
    const itemId = String(log.lztItemId || "").trim();
    if (!itemId) return false;
    try {
      item = await getItem(itemId);
    } catch (error) {
      logger.warn("Auto log sale price fetch failed", log.sourceId, error?.message || error);
      return false;
    }
  }
  const rate = await getUsdRubRate().catch(() => 0);
  const { priceRub, grossUsd } = resolveSaleAmounts(item, rate);
  let dirty = false;
  if (priceRub > 0 && Number(log.autoSalePriceRub || 0) !== priceRub) {
    log.autoSalePriceRub = priceRub;
    dirty = true;
  }
  if (grossUsd > 0 && Math.abs(Number(log.autoSaleGrossUsd || 0) - grossUsd) > 0.005) {
    log.autoSaleGrossUsd = grossUsd;
    dirty = true;
  }
  if (dirty && typeof log.save === "function") {
    await log.save();
  }
  // Always refresh caption on listing so status becomes «Продается».
  if (telegramApi) {
    void syncProfitChannelCaption(telegramApi, log).catch(() => {});
  }
  return dirty;
}

async function notifyWorkerSaleHold(log, { grossUsd, expectedShare, percent }) {
  const telegramId = String(log?.ownerTelegramId || "").trim();
  if (!telegramApi?.sendMessage || !telegramId) return;
  const claimed = await claimAutoSaleNotify(log, "sold_held_dm");
  if (!claimed) return;
  const sourceId = String(log.sourceId || "");
  const lines = [
    `${pe("gift")} ${escapeHtml(autoSaleHoldSoldNote(log.autoSaleHoldDurationPhrase))}`,
  ];
  if (Number(expectedShare) > 0) {
    lines.push(`${pe("coins")} На холде: <b>${moneyUsdLabel(expectedShare)}</b>`);
    if (Number(grossUsd) > 0 && Number(percent) > 0 && Math.abs(expectedShare - grossUsd) > 0.005) {
      lines.push(
        `Доля ${Math.round(percent)}% от продажи <b>${moneyUsdLabel(grossUsd)}</b>`
      );
    }
  }
  if (sourceId) lines.push(`ID: <code>${escapeHtml(sourceId)}</code>`);
  try {
    await telegramApi.sendMessage(telegramId, lines.join("\n"), {
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  } catch (error) {
    logger.warn(
      "Auto sale hold DM failed",
      sourceId,
      error?.response?.description || error.message
    );
  }
}

async function notifyWorkerSaleRefunded(log, { clawedBackUsd, reason }) {
  const telegramId = String(log?.ownerTelegramId || "").trim();
  if (!telegramApi?.sendMessage || !telegramId) return;
  const claimed = await claimAutoSaleNotify(log, "refunded_dm");
  if (!claimed) return;
  const sourceId = String(log.sourceId || "");
  const reasonLine =
    reason === "arbitration_lost"
      ? "Арбитраж проигран · лот удалён"
      : reason === "unknown"
        ? "Статус лота неизвестен · продажа отменена"
        : "Лот удалён · продажа отменена";
  try {
    await telegramApi.sendMessage(
      telegramId,
      [
        `${pe("error")} <b>Продажа отменена</b>`,
        escapeHtml(reasonLine),
        clawedBackUsd > 0
          ? `${pe("coins")} С баланса списано: <b>${moneyUsdLabel(clawedBackUsd)}</b>`
          : "",
        `ID: <code>${escapeHtml(sourceId)}</code>`,
      ]
        .filter(Boolean)
        .join("\n"),
      { parse_mode: "HTML", disable_web_page_preview: true }
    );
  } catch (error) {
    logger.warn(
      "Auto sale refund DM failed",
      sourceId,
      error?.response?.description || error.message
    );
  }
}

async function notifyWorkerHoldReleased(log, { workerShare, grossUsd }) {
  const telegramId = String(log?.ownerTelegramId || "").trim();
  if (!telegramApi?.sendMessage || !telegramId) return;
  const claimed = await claimAutoSaleNotify(log, "released_dm");
  if (!claimed) return;
  const sourceId = String(log.sourceId || "");
  try {
    await telegramApi.sendMessage(
      telegramId,
      [
        `${pe("coins")} <b>Холд снят</b>`,
        `ID: <code>${escapeHtml(sourceId)}</code>`,
        `Продажа: <b>${moneyUsdLabel(grossUsd)}</b>`,
        `Доступно тебе: <b>${moneyUsdLabel(workerShare)}</b>`,
      ].join("\n"),
      { parse_mode: "HTML", disable_web_page_preview: true }
    );
  } catch (error) {
    logger.warn(
      "Auto sale release DM failed",
      sourceId,
      error?.response?.description || error.message
    );
  }
}

/**
 * Автоматический перевод "казна → персональный кошелёк воркера" сразу после
 * снятия холда — без участия админа (см. план). Идемпотентна: атомарный клейм
 * на SteamLog.autoPayoutStatus гарантирует ровно один перевод на лог, даже
 * если её вызовут из нескольких мест (creditSoldHeld / releaseHold fast path /
 * releaseHold full path) или при рестарте.
 */
async function triggerInternalTransfer(log, { user, workerShare }) {
  if (!(Number(workerShare) > 0)) return;
  if (!env.treasuryPayoutEnabled) return;

  const claimed = await SteamLog.findOneAndUpdate(
    { _id: log._id, autoPayoutStatus: { $in: [null, "none"] } },
    { $set: { autoPayoutStatus: "pending" } },
    { new: true }
  );
  if (!claimed) return;

  // Всё, что происходит после успешного клейма, должно закончиться сменой
  // autoPayoutStatus на что-то, отличное от "pending" — иначе запись зависнет
  // в pending навсегда (клейм-гард выше пропускает только none/null).
  let method = "unknown";
  try {
    const owner =
      user || (log.ownerTelegramId ? await User.findOne({ telegramId: String(log.ownerTelegramId) }) : null);
    if (!owner) {
      await SteamLog.updateOne(
        { _id: log._id },
        { $set: { autoPayoutStatus: "skipped", autoPayoutError: "owner_not_found" } }
      );
      return;
    }

    const { ensureWorkerWallet, sendFromTreasury } = require("./treasuryWalletService");
    const { SUPPORTED_AUTO_PAYOUT_METHODS } = require("./treasuryPayoutService");
    const { listPayoutRequisites } = require("./withdrawalService");

    const requisites = listPayoutRequisites(owner);
    const preferred = requisites.find((r) => SUPPORTED_AUTO_PAYOUT_METHODS.has(r.method));
    method = preferred?.method || "usdt_trc20";

    await ensureWorkerWallet(owner);
    const freshOwner = await User.findById(owner._id);
    const toAddress = freshOwner?.treasuryAddresses?.[method];
    if (!toAddress) {
      await SteamLog.updateOne(
        { _id: log._id },
        { $set: { autoPayoutStatus: "skipped", autoPayoutError: `no_treasury_address:${method}` } }
      );
      return;
    }

    const { txId, explorerUrl } = await sendFromTreasury({ method, toAddress, amountUsd: workerShare });
    await User.updateOne(
      { _id: freshOwner._id },
      { $inc: { [`treasuryWalletBalanceUsd.${method}`]: Number(workerShare) } }
    );
    await SteamLog.updateOne(
      { _id: log._id },
      { $set: { autoPayoutStatus: "paid", autoPayoutTxId: txId } }
    );
    notifyAutoSale(log, "Выплата отправлена", explorerUrl || txId);
  } catch (error) {
    const reason = String(error?.message || error).slice(0, 500);
    await SteamLog.updateOne(
      { _id: log._id },
      { $set: { autoPayoutStatus: "failed", autoPayoutError: reason } }
    ).catch(() => {});
    notifyAutoSale(log, "Выплата не удалась", reason);
    logger.error("triggerInternalTransfer failed", log.sourceId, reason);
    void alertAdminsAutoPayoutFailed(log, { reason, method, workerShare }).catch(() => {});
  }
}

async function alertAdminsAutoPayoutFailed(log, { reason, method, workerShare }) {
  if (!telegramApi?.sendMessage) return;
  const ids = env.treasuryPayoutAlertTelegramIds.length
    ? env.treasuryPayoutAlertTelegramIds
    : env.adminIds;
  const text = [
    `${pe("error")} <b>Авто-перевод в кошелёк воркера не удался</b>`,
    `Лог: <code>${escapeHtml(String(log.sourceId || log._id))}</code>`,
    `Воркер: <code>${escapeHtml(String(log.ownerTelegramId || ""))}</code>`,
    `Метод: <b>${escapeHtml(String(method))}</b>`,
    `Сумма: <b>${moneyUsdLabel(workerShare)}</b>`,
    `Причина: ${escapeHtml(String(reason || ""))}`,
  ].join("\n");
  for (const id of ids) {
    try {
      await telegramApi.sendMessage(id, text, { parse_mode: "HTML" });
    } catch (_) {
      /* best-effort */
    }
  }
}

function applyHoldInfo(log, item) {
  const hold = readHoldInfo(item);
  if (hold.holdUntil) log.autoSaleHoldUntil = hold.holdUntil;
  if (hold.remainingPhrase) log.autoSaleHoldRemainingPhrase = hold.remainingPhrase;
  if (hold.durationPhrase) log.autoSaleHoldDurationPhrase = hold.durationPhrase;
  return hold;
}

function clearClaimInfo(log) {
  log.autoSaleClaimThreadId = "";
  log.autoSaleClaimAt = null;
}

async function markArbitration(log, claim) {
  const was = String(log.autoSaleStatus || "");
  log.autoSaleStatus = "arbitration";
  log.autoSaleClaimThreadId = String(claim?.threadId || log.autoSaleClaimThreadId || "");
  if (claim?.claimDate) log.autoSaleClaimAt = claim.claimDate;
  else if (!log.autoSaleClaimAt) log.autoSaleClaimAt = new Date();
  log.autoSaleError = "";
  await log.save();
  if (was !== "arbitration") {
    notifyAutoSale(
      log,
      "Арбитраж",
      log.autoSaleClaimThreadId
        ? `https://lolz.live/threads/${log.autoSaleClaimThreadId}/`
        : ""
    );
  }
  return log;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unwrapPayload(payload, keys = []) {
  let value = payload;
  for (let i = 0; i < 5 && value && typeof value === "object"; i += 1) {
    if (keys.some((key) => value[key] != null)) break;
    const next = ["data", "result", "task", "account", "row"]
      .map((key) => value[key])
      .find((candidate) => candidate && typeof candidate === "object");
    if (!next || next === value) break;
    value = next;
  }
  return value || {};
}

function extractTaskId(payload) {
  const task = unwrapPayload(payload, ["id", "taskId", "_id"]);
  const id = task.id ?? task.taskId ?? task._id ?? payload?.id;
  return id != null && String(id).trim() ? String(id) : "";
}

function extractLztItemId(account) {
  const row = unwrapPayload(account, ["lztLinkId", "lzt_link_id", "id"]);
  const raw =
    row.lztLinkId ??
    row.lzt_link_id ??
    row.lztItemId ??
    row.lzt_item_id ??
    account?.lztLinkId ??
    account?.lzt_link_id;
  if (raw == null || raw === "") return "";
  const match = String(raw).match(/(\d{5,})/);
  return match ? match[1] : String(raw).trim();
}

/** SellLZT subtask may expose item_id before account.lztLinkId syncs. */
function extractLztItemIdFromTask(task) {
  const root = unwrapPayload(task, ["id", "state", "steam"]);
  const steam = root.steam || root;
  const subtasks = Array.isArray(steam?.tasks) ? steam.tasks : [];
  for (const sub of subtasks) {
    if (String(sub?.task || "").toLowerCase() !== "selllzt") continue;
    const data = sub.data || {};
    const raw = data.item_id ?? data.itemId ?? data.lztLinkId ?? data.lzt_link_id;
    if (raw == null || raw === "") continue;
    const match = String(raw).match(/(\d{5,})/);
    return match ? match[1] : String(raw).trim();
  }
  const data = root.data || task?.data || {};
  const raw = data.item_id ?? data.itemId ?? data.lztLinkId ?? data.lzt_link_id;
  if (raw == null || raw === "") return "";
  const match = String(raw).match(/(\d{5,})/);
  return match ? match[1] : String(raw).trim();
}

function lztMarketUrl(itemId) {
  return itemId ? `https://lzt.market/${itemId}` : "";
}

function isTaskFailed(task) {
  const state = String(task?.state || task?.status || "").toLowerCase();
  if (!state) return false;
  return /fail|error|cancel|abort|reject/.test(state);
}

function isTaskDone(task) {
  const state = String(task?.state || task?.status || "").toLowerCase();
  return /success|done|completed|finished|ok/.test(state);
}

function isTaskInProgress(task) {
  const state = String(task?.state || task?.status || "").toLowerCase();
  if (!state) return false;
  if (isTaskFailed(task) || isTaskDone(task)) return false;
  return /process|pending|wait|running|queue|progress|addto/.test(state);
}

async function markLogListed(log, lztItemId) {
  log.lztItemId = lztItemId;
  log.lztMarketUrl = lztMarketUrl(lztItemId);
  log.autoSaleStatus = "listed";
  if (!log.autoSaleListedAt) log.autoSaleListedAt = new Date();
  log.autoSaleError = "";
  await log.save();
  logger.info("Auto log sale listed", log.sourceId, log.lztMarketUrl);
  notifyAutoSale(log, "На продаже", log.lztMarketUrl || lztItemId);
  void refreshListedSalePrice(log).catch(() => {});
  return log;
}

async function resolveListingLztItemId(log) {
  try {
    const account = await getSteamAccountById(null, log.sourceId);
    const fromAccount = extractLztItemId(account);
    if (fromAccount) return fromAccount;
  } catch (error) {
    logger.warn("Auto log sale account poll failed", log.sourceId, error.message);
  }

  if (!log.autoSaleTaskId) return "";

  try {
    const task = unwrapPayload(await getSteamTask(log.autoSaleTaskId), [
      "id",
      "state",
      "status",
    ]);
    return extractLztItemIdFromTask(task);
  } catch (error) {
    logger.warn("Auto log sale task poll failed", log.sourceId, error.message);
    return "";
  }
}

async function isAutoSaleTaskStillActive(log) {
  if (!log.autoSaleTaskId) return false;
  try {
    const task = unwrapPayload(await getSteamTask(log.autoSaleTaskId), [
      "id",
      "state",
      "status",
    ]);
    if (extractLztItemIdFromTask(task)) return true;
    return isTaskInProgress(task);
  } catch (error) {
    logger.warn("Auto log sale task active check failed", log.sourceId, error.message);
    return false;
  }
}

/**
 * Whether this log should start auto-sale (pure helper for tests).
 */
function shouldEnqueueAutoSell(log, user) {
  if (user?.autoSellLogs === false) return false;
  if (!user) return false;
  if (!log) return false;
  if (String(log.logKind || "") !== "valid") return false;
  if (String(log.status || "") !== "processed") return false;
  if (BLOCKED_ENQUEUE.has(String(log.autoSaleStatus || "none"))) return false;
  if (!String(log.sourceId || "").trim()) return false;
  return true;
}

async function maybeEnqueueAutoSell(log) {
  if (!log?.ownerTelegramId) return null;
  const user = await User.findOne({ telegramId: String(log.ownerTelegramId) }).lean();
  if (!shouldEnqueueAutoSell(log, user)) return null;
  return enqueueAutoSell(log);
}

async function enqueueAutoSell(log) {
  const sourceId = String(log.sourceId || "").trim();
  if (!sourceId) throw new Error("sourceId отсутствует.");

  const claimed = await SteamLog.findOneAndUpdate(
    {
      _id: log._id,
      autoSaleStatus: { $nin: [...BLOCKED_ENQUEUE] },
      logKind: "valid",
    },
    {
      $set: {
        autoSaleStatus: "queued",
        autoSaleError: "",
        autoSaleTaskId: "",
        // Allow a fresh listing cycle to notify again after failure/retry.
        "autoSaleActivityNotified.listing": null,
        "autoSaleActivityNotified.listed": null,
        "autoSaleActivityNotified.failed": null,
        "autoSaleActivityNotified.invalid": null,
        "autoSaleActivityNotifyKeys.failedDetail": "",
      },
    },
    { new: true }
  );
  if (!claimed) return null;

  try {
    const taskResult = await createSteamTask({
      tasks: [{ task: "SellLZT" }],
      ids: [Number(sourceId)],
      name: "Продажа",
    });
    const taskId = extractTaskId(taskResult);
    claimed.autoSaleStatus = "listing";
    claimed.autoSaleTaskId = taskId;
    await claimed.save();
    logger.info("Auto log sale SellLZT queued", sourceId, taskId || "(no task id)");
    notifyAutoSale(claimed, "Выставление", taskId ? `task ${taskId}` : "");
    // Kick listing poll without waiting for the minute worker.
    void progressListing(claimed).catch((error) => {
      logger.warn("Auto log sale listing progress failed", sourceId, error.message);
    });
    return claimed;
  } catch (error) {
    claimed.autoSaleStatus = "failed";
    claimed.autoSaleError = String(error.message || error).slice(0, 500);
    await claimed.save();
    logger.warn("Auto log sale SellLZT create failed", sourceId, claimed.autoSaleError);
    notifyAutoSale(claimed, "Ошибка", claimed.autoSaleError);
    return claimed;
  }
}

async function progressListing(logDoc, options = {}) {
  const once = Boolean(options.once);
  const log =
    logDoc?.save
      ? logDoc
      : await SteamLog.findById(logDoc?._id || logDoc);
  if (!log) return null;
  if (!ACTIVE_LISTING.has(String(log.autoSaleStatus || ""))) return log;

  const maxWait = Math.max(30_000, env.steamTaskMaxWaitMs || 120_000);
  const interval = Math.max(2_000, env.steamTaskPollIntervalMs || 3_000);
  const startedAt = Date.now();
  const deadline = once ? Date.now() : startedAt + maxWait;

  do {
    if (log.autoSaleTaskId) {
      try {
        const task = unwrapPayload(await getSteamTask(log.autoSaleTaskId), [
          "id",
          "state",
          "status",
        ]);
        if (isTaskFailed(task)) {
          log.autoSaleStatus = "failed";
          log.autoSaleError = String(
            task.error || task.message || task.state || "SellLZT failed"
          ).slice(0, 500);
          await log.save();
          notifyAutoSale(log, "Ошибка", log.autoSaleError);
          return log;
        }
        const fromTask = extractLztItemIdFromTask(task);
        if (fromTask) {
          return markLogListed(log, fromTask);
        }
      } catch (error) {
        logger.warn("Auto log sale task poll failed", log.sourceId, error.message);
      }
    }

    try {
      const lztItemId = await resolveListingLztItemId(log);
      if (lztItemId) {
        return markLogListed(log, lztItemId);
      }

      if (log.autoSaleTaskId) {
        const task = unwrapPayload(await getSteamTask(log.autoSaleTaskId), [
          "id",
          "state",
          "status",
        ]);
        if (isTaskDone(task) && !extractLztItemIdFromTask(task)) {
          if (once) {
            // Minute worker: give account sync another tick before failing.
            const listedAt = log.updatedAt ? new Date(log.updatedAt).getTime() : 0;
            if (listedAt && Date.now() - listedAt > maxWait) {
              if (await isAutoSaleTaskStillActive(log)) return log;
              log.autoSaleStatus = "failed";
              log.autoSaleError = "SellLZT завершён без lztLinkId";
              await log.save();
              notifyAutoSale(log, "Ошибка", log.autoSaleError);
            }
            return log;
          }
          await sleep(interval);
          const retryId = await resolveListingLztItemId(log);
          if (retryId) {
            return markLogListed(log, retryId);
          }
          if (await isAutoSaleTaskStillActive(log)) {
            await sleep(interval);
            continue;
          }
          log.autoSaleStatus = "failed";
          log.autoSaleError = "SellLZT завершён без lztLinkId";
          await log.save();
          notifyAutoSale(log, "Ошибка", log.autoSaleError);
          return log;
        }
      }
    } catch (error) {
      logger.warn("Auto log sale account poll failed", log.sourceId, error.message);
    }

    if (once) {
      const age = Date.now() - new Date(log.updatedAt || log.createdAt || Date.now()).getTime();
      if (age > maxWait) {
        if (await isAutoSaleTaskStillActive(log)) return log;
        log.autoSaleStatus = "failed";
        log.autoSaleError = "Таймаут ожидания выставления на продажу";
        await log.save();
        notifyAutoSale(log, "Ошибка", log.autoSaleError);
      }
      return log;
    }

    await sleep(interval);
    const fresh = await SteamLog.findById(log._id);
    if (!fresh || !ACTIVE_LISTING.has(String(fresh.autoSaleStatus || ""))) {
      return fresh || log;
    }
    Object.assign(log, fresh.toObject());
  } while (Date.now() < deadline);

  if (await isAutoSaleTaskStillActive(log)) return log;
  log.autoSaleStatus = "failed";
  log.autoSaleError = "Таймаут ожидания выставления на продажу";
  await log.save();
  notifyAutoSale(log, "Ошибка", log.autoSaleError);
  return log;
}

function hasAutoSaleProfitTx(log) {
  return Boolean(String(log?.autoSaleProfitTxId || "").trim());
}

function shouldPollLztStatus(status, hasProfitTx, force = false) {
  if (force) return true;
  if (ACTIVE_MONITOR.has(String(status || ""))) return true;
  return UNCREDITED_SOLD.has(String(status || "")) && !hasProfitTx;
}

function shouldFreezeOnCredit(holdEnded, status) {
  if (holdEnded) return false;
  return String(status || "") !== "released";
}

async function creditSoldHeld(log, item, options = {}) {
  const holdEnded = Boolean(options.holdEnded) || String(log.autoSaleStatus) === "released";
  if (hasAutoSaleProfitTx(log)) {
    if (String(log.autoSaleStatus) === "released") return log;
    if (String(log.autoSaleStatus) === "sold_held") return log;
    if (String(log.autoSaleStatus) === "arbitration") return log;
    // listed + existing tx (e.g. poll after partial reconcile): never double-credit.
    log.autoSaleStatus = holdEnded ? "released" : "sold_held";
    if (!log.autoSaleSoldAt) log.autoSaleSoldAt = new Date();
    if (holdEnded && !log.autoSaleReleasedAt) log.autoSaleReleasedAt = new Date();
    applyHoldInfo(log, item);
    await log.save();
    return log;
  }

  const rate = await getUsdRubRate();
  const { priceRub, grossUsd } = resolveSaleAmounts(item, rate);
  if (!(grossUsd > 0)) {
    throw new Error("Нет цены лота для начисления.");
  }

  const user = await User.findOne({ telegramId: String(log.ownerTelegramId) });
  if (!user) {
    throw new Error("Владелец лога не найден для начисления.");
  }
  const percent = Math.max(1, Math.min(100, Number(user.profitPercent) || 70));
  const expectedShare = Number(((grossUsd * percent) / 100).toFixed(2));
  const freeze = shouldFreezeOnCredit(holdEnded, log.autoSaleStatus);

  applyHoldInfo(log, item);
  const creditNote = freeze
    ? autoSaleHoldSoldNote(log.autoSaleHoldDurationPhrase)
    : AUTO_SALE_HOLD_RELEASED_NOTE;

  // Сразу зачисляем только долю воркера; доля команды не попадает на баланс воркера.
  // Филиал срезает комиссию с доли воркера (если участник состоит в филиале).
  const { creditComputedWorkerShare } = require("./profitService");
  const result = await creditComputedWorkerShare(user, expectedShare, {
    actorTelegramId: "system",
    gross: grossUsd,
    workerPercent: percent,
    note: creditNote,
  });
  const creditedShare = Number(result.workerShare || expectedShare);

  if (freeze && creditedShare > 0 && log.ownerTelegramId) {
    await User.updateOne(
      { telegramId: String(log.ownerTelegramId) },
      { $inc: { frozenSaleUsd: creditedShare } }
    );
  }

  if (result?.transaction?._id) {
    await ProfitTransaction.updateOne(
      { _id: result.transaction._id },
      { $set: { workerPercent: percent, amount: grossUsd, workerShare: creditedShare } }
    );
  }

  log.autoSalePriceRub = priceRub;
  log.autoSaleGrossUsd = grossUsd;
  log.autoSaleWorkerShareUsd = expectedShare;
  log.autoSaleProfitTxId = String(result.transaction?._id || "");
  log.autoSaleStatus = freeze ? "sold_held" : "released";
  log.autoSaleSoldAt = log.autoSaleSoldAt || new Date();
  if (!freeze) log.autoSaleReleasedAt = log.autoSaleReleasedAt || new Date();
  log.autoSaleError = "";
  if (!freeze && log.autoSaleActivityNotified) {
    log.autoSaleActivityNotified.released = null;
    log.autoSaleActivityNotified.released_dm = null;
    if (typeof log.markModified === "function") {
      log.markModified("autoSaleActivityNotified");
    }
  }
  await log.save();
  logger.info(
    freeze ? "Auto log sale credited (worker share held)" : "Auto log sale credited (hold already ended)",
    log.sourceId,
    `gross=$${grossUsd}`,
    `worker=$${expectedShare}`,
    log.lztMarketUrl
  );
  notifyAutoSale(
    log,
    freeze ? "Продан · холд" : "Холд снят",
    `$${grossUsd.toFixed(2)}${log.lztMarketUrl ? ` · ${log.lztMarketUrl}` : ""}`
  );
  if (freeze) {
    void notifyWorkerSaleHold(log, {
      grossUsd,
      expectedShare,
      percent,
    }).catch(() => {});
  } else {
    void notifyWorkerHoldReleased(log, { workerShare: expectedShare, grossUsd }).catch(() => {});
    void triggerInternalTransfer(log, { user, workerShare: expectedShare }).catch(() => {});
  }
  void syncProfitChannelCaption(telegramApi, log).catch(() => {});
  return log;
}

/**
 * Fix wrongly credited sales where LZT `price` (USD) was treated as RUB.
 */
async function reconcileSaleAmounts(log, item) {
  applyHoldInfo(log, item);
  const rate = await getUsdRubRate();
  const { priceRub, grossUsd } = resolveSaleAmounts(item, rate);
  if (!(grossUsd > 0)) {
    await log.save();
    return log;
  }

  const oldGross = Number(log.autoSaleGrossUsd || 0);
  const oldShare = Number(log.autoSaleWorkerShareUsd || 0);
  const storedRub = Number(log.autoSalePriceRub || 0);
  const looksLikeUsdAsRubBug =
    storedRub > 0 &&
    storedRub < 80 &&
    priceRub >= storedRub * 10 &&
    grossUsd >= 1 &&
    oldGross > 0 &&
    oldGross < 1;
  const mismatch =
    Boolean(log.autoSaleProfitTxId) &&
    Math.abs(oldGross - grossUsd) >= 0.5 &&
    (looksLikeUsdAsRubBug || oldGross * 5 < grossUsd);

  if (mismatch) {
    try {
      let frozenToRemove = oldGross > 0 ? oldGross : oldShare;
      if (log.autoSaleProfitTxId) {
        const tx = await ProfitTransaction.findById(log.autoSaleProfitTxId).lean();
        if (tx) frozenToRemove = Number(tx.workerShare || frozenToRemove);
        await reverseProfitTransactionById(log.autoSaleProfitTxId);
      }
      if (frozenToRemove > 0 && log.ownerTelegramId) {
        await User.updateOne(
          { telegramId: String(log.ownerTelegramId) },
          { $inc: { frozenSaleUsd: -frozenToRemove } }
        );
        await User.updateOne(
          { telegramId: String(log.ownerTelegramId), frozenSaleUsd: { $lt: 0 } },
          { $set: { frozenSaleUsd: 0 } }
        );
      }
      log.autoSaleProfitTxId = "";
      log.autoSaleWorkerShareUsd = 0;
      log.autoSaleGrossUsd = 0;
      log.autoSalePriceRub = 0;
      log.autoSaleStatus = "listed";
      await log.save();
      logger.warn(
        "Auto sale amount corrected (USD/RUB mixup)",
        log.sourceId,
        `was $${oldGross} → $${grossUsd}`
      );
      return creditSoldHeld(log, item);
    } catch (error) {
      logger.warn("Auto sale recredit failed", log.sourceId, error.message);
      await log.save();
      return log;
    }
  }

  let dirty = false;
  if (priceRub > 0 && storedRub !== priceRub) {
    log.autoSalePriceRub = priceRub;
    dirty = true;
  }
  if (!log.autoSaleProfitTxId && Math.abs(oldGross - grossUsd) > 0.005) {
    log.autoSaleGrossUsd = grossUsd;
    dirty = true;
  }
  await log.save();
  return log;
}

function isLegacyFullGrossHold(txWorkerShare, grossUsd) {
  const credited = Number(txWorkerShare || 0);
  const gross = Number(grossUsd || 0);
  if (!(gross > 0) || !(credited > 0)) return false;
  return credited + 0.01 >= gross;
}

const CLAWBACK_STATUSES = new Set(["sold_held", "arbitration", "released"]);

/**
 * Whether poll/migration should claw back a credited auto-sale for this LZT phase.
 */
function shouldClawbackForLztPhase(phase, autoSaleStatus, hasProfitTx) {
  const status = String(autoSaleStatus || "");
  if (!hasProfitTx || !CLAWBACK_STATUSES.has(status)) return false;
  if (phase === "terminal_unsold") return true;
  if (phase === "unknown") return true;
  return false;
}

function clawbackReasonLabel(reason) {
  if (reason === "arbitration_lost") return "арбитраж проигран · лот удалён";
  if (reason === "unknown") return "статус лота неизвестен";
  if (reason === "admin") return "снято администратором";
  return "лот удалён";
}

async function clawbackAutoSaleHold(log, options = {}) {
  if (String(log.autoSaleStatus) === "refunded") return log;

  const reason = String(options.reason || "deleted");
  const wasArbitration =
    Boolean(options.wasArbitration) || String(log.autoSaleStatus) === "arbitration";
  const notifyReason =
    wasArbitration && reason === "deleted" ? "arbitration_lost" : reason;
  const statusBefore = String(log.autoSaleStatus || "");
  const gross = Number(log.autoSaleGrossUsd || 0);
  const txId = String(log.autoSaleProfitTxId || "").trim();

  if (!txId) {
    clearClaimInfo(log);
    if (statusBefore === "listed") {
      log.autoSaleStatus = "failed";
      log.autoSaleError =
        reason === "admin"
          ? "Продажа отменена администратором"
          : reason === "unknown"
            ? "Продажа отменена (статус неизвестен)"
            : "Невалид (лот удалён)";
      await log.save();
      notifyAutoSale(log, "Невалид", clawbackReasonLabel(reason));
      void syncProfitChannelCaption(telegramApi, log).catch(() => {});
    } else if (CLAWBACK_STATUSES.has(statusBefore)) {
      log.autoSaleStatus = "refunded";
      log.autoSaleError =
        reason === "admin"
          ? "Продажа отменена администратором · начисление не найдено"
          : "Продажа отменена · начисление не найдено";
      await log.save();
      notifyAutoSale(log, "Продажа отменена", clawbackReasonLabel(notifyReason));
    }
    return log;
  }

  const tx = await ProfitTransaction.findById(txId).lean();
  const legacyFullGross = isLegacyFullGrossHold(tx?.workerShare, gross);
  const workerShare = Number(
    tx?.workerShare || log.autoSaleWorkerShareUsd || 0
  );
  const frozenAmt = legacyFullGross
    ? gross > 0
      ? gross
      : workerShare
    : workerShare;
  const holdActive = statusBefore === "sold_held" || statusBefore === "arbitration";

  if (holdActive && frozenAmt > 0 && log.ownerTelegramId) {
    await User.updateOne(
      { telegramId: String(log.ownerTelegramId) },
      { $inc: { frozenSaleUsd: -frozenAmt } }
    );
    await User.updateOne(
      { telegramId: String(log.ownerTelegramId), frozenSaleUsd: { $lt: 0 } },
      { $set: { frozenSaleUsd: 0 } }
    );
  }

  let clawedBackUsd = 0;
  try {
    const result = await reverseProfitTransactionById(txId);
    clawedBackUsd = Number(result?.removedShare || workerShare || 0);
  } catch (error) {
    log.autoSaleError = String(error.message || error).slice(0, 500);
    await log.save();
    logger.warn("Auto sale clawback failed", log.sourceId, log.autoSaleError);
    return log;
  }

  clearClaimInfo(log);
  log.autoSaleProfitTxId = "";
  log.autoSaleWorkerShareUsd = 0;
  log.autoSaleStatus = "refunded";
  log.autoSaleError =
    notifyReason === "arbitration_lost"
      ? "Арбитраж проигран · средства возвращены покупателю"
      : notifyReason === "unknown"
        ? "Продажа отменена · статус лота неизвестен"
        : notifyReason === "admin"
          ? "Продажа отменена администратором"
          : "Продажа отменена · лот удалён";
  await log.save();

  logger.info(
    "Auto log sale clawback",
    log.sourceId,
    `reason=${notifyReason}`,
    `clawed=$${clawedBackUsd.toFixed(2)}`,
    `was=${statusBefore}`
  );
  notifyAutoSale(
    log,
    "Продажа отменена",
    `${clawbackReasonLabel(notifyReason)} · −$${clawedBackUsd.toFixed(2)}`
  );
  void notifyWorkerSaleRefunded(log, { clawedBackUsd, reason: notifyReason }).catch(() => {});
  return log;
}

async function releaseHold(log) {
  if (String(log.autoSaleStatus) === "released") return log;
  if (String(log.autoSaleStatus) !== "sold_held") return log;

  // Sync used to pull UProject Sold/OnHold back onto released rows. If we already
  // released once, restore status silently — do not unfreeze / re-notify.
  if (log.autoSaleReleasedAt) {
    log.autoSaleStatus = "released";
    await log.save();
    void triggerInternalTransfer(log, { user: null, workerShare: Number(log.autoSaleWorkerShareUsd || 0) }).catch(
      () => {}
    );
    return log;
  }

  const gross = Number(log.autoSaleGrossUsd || 0);
  const user = log.ownerTelegramId
    ? await User.findOne({ telegramId: String(log.ownerTelegramId) })
    : null;
  const percent = Math.max(
    1,
    Math.min(100, Number(user?.profitPercent) || Number(env.steamWorkerPercent) || 70)
  );
  const tx = log.autoSaleProfitTxId
    ? await ProfitTransaction.findById(log.autoSaleProfitTxId).lean()
    : null;
  const creditedShare = Number(tx?.workerShare || 0);
  const computedShare =
    gross > 0
      ? Number(((gross * percent) / 100).toFixed(2))
      : Number(log.autoSaleWorkerShareUsd || 0);
  const workerShare = creditedShare > 0 ? creditedShare : computedShare;
  const teamCut = Number(Math.max(0, gross - computedShare).toFixed(2));
  const legacyFullGross = isLegacyFullGrossHold(tx?.workerShare, gross);
  const frozenAmt = legacyFullGross
    ? gross > 0
      ? gross
      : Number(tx?.workerShare || log.autoSaleWorkerShareUsd || 0)
    : Number(tx?.workerShare || log.autoSaleWorkerShareUsd || workerShare || 0);

  if (frozenAmt > 0 && log.ownerTelegramId) {
    await User.updateOne(
      { telegramId: String(log.ownerTelegramId) },
      { $inc: { frozenSaleUsd: -frozenAmt } }
    );
    await User.updateOne(
      { telegramId: String(log.ownerTelegramId), frozenSaleUsd: { $lt: 0 } },
      { $set: { frozenSaleUsd: 0 } }
    );
  }

  // Старые холды (полный gross на балансе): при снятии вычитаем долю команды.
  if (legacyFullGross && teamCut > 0 && user) {
    user.totalProfit = Number(Math.max(0, Number(user.totalProfit || 0) - teamCut).toFixed(2));
    await user.save();
  }

  if (log.autoSaleProfitTxId) {
    await ProfitTransaction.updateOne(
      { _id: log.autoSaleProfitTxId },
      {
        $set: {
          workerShare,
          workerPercent: percent,
          amount: gross > 0 ? gross : workerShare,
          note: AUTO_SALE_HOLD_RELEASED_NOTE,
        },
      }
    );
  }

  log.autoSaleWorkerShareUsd = workerShare;
  log.autoSaleStatus = "released";
  log.autoSaleReleasedAt = new Date();
  await log.save();
  logger.info(
    "Auto log sale hold released",
    log.sourceId,
    `gross=$${gross}`,
    `worker=$${workerShare}`,
    `cut=$${teamCut}`
  );
  notifyAutoSale(log, "Холд снят", `$${Number(workerShare || 0).toFixed(2)}`);
  void notifyWorkerHoldReleased(log, { workerShare, grossUsd: gross }).catch(() => {});
  void triggerInternalTransfer(log, { user, workerShare }).catch(() => {});
  void syncProfitChannelCaption(telegramApi, log).catch(() => {});
  return log;
}

async function pollLztStatus(logDoc, options = {}) {
  const log =
    logDoc?.save
      ? logDoc
      : await SteamLog.findById(logDoc?._id || logDoc);
  if (!log) return null;
  const statusNow = String(log.autoSaleStatus || "");
  if (
    !shouldPollLztStatus(statusNow, hasAutoSaleProfitTx(log), Boolean(options.force))
  ) {
    return log;
  }
  if (!log.lztItemId) {
    log.autoSaleStatus = "failed";
    log.autoSaleError = "Нет lztItemId для проверки";
    await log.save();
    notifyAutoSale(log, "Ошибка", log.autoSaleError);
    return log;
  }
  if (!env.lztMarketToken) {
    logger.warn("Auto log sale LZT poll skipped: LZT_MARKET_TOKEN empty");
    return log;
  }

  const claimMap = options.claimMap instanceof Map ? options.claimMap : null;
  const claim = claimMap?.get(String(log.lztItemId)) || null;
  if (claim) {
    // Sold with open claim: credit first if needed, then keep frozen under arbitration.
    if (String(log.autoSaleStatus) === "listed") {
      try {
        const item = await getItem(log.lztItemId);
        applyHoldInfo(log, item);
        const phase = classifyLztSaleState(item);
        if (phase === "sold_held" || phase === "released") {
          await creditSoldHeld(log, item);
        }
      } catch (_) {
        /* claim still wins — mark arbitration even if item fetch fails */
      }
    } else if (String(log.autoSaleStatus) === "sold_held" || String(log.autoSaleStatus) === "arbitration") {
      try {
        const item = await getItem(log.lztItemId);
        applyHoldInfo(log, item);
        await log.save();
      } catch (_) {
        /* ignore item refresh errors while claim is open */
      }
    }
    return markArbitration(log, claim);
  }

  let item;
  try {
    item = await getItem(log.lztItemId);
  } catch (error) {
    if (error.code === "LZT_NOT_FOUND") {
      const status = String(log.autoSaleStatus || "");
      if (status === "listed") {
        log.autoSaleStatus = "failed";
        log.autoSaleError = "Невалид (лот удалён)";
        await log.save();
        notifyAutoSale(log, "Невалид", "лот удалён");
        void syncProfitChannelCaption(telegramApi, log).catch(() => {});
        return log;
      }
      if (CLAWBACK_STATUSES.has(status)) {
        return clawbackAutoSaleHold(log, {
          reason: "deleted",
          wasArbitration: status === "arbitration",
        });
      }
    }
    throw error;
  }

  applyHoldInfo(log, item);
  const phase = classifyLztSaleState(item);
  const wasArbitration = String(log.autoSaleStatus) === "arbitration";

  if (phase === "listed") {
    const rate = await getUsdRubRate().catch(() => 0);
    const { priceRub, grossUsd } = resolveSaleAmounts(item, rate);
    let dirty = false;
    if (priceRub > 0 && Number(log.autoSalePriceRub || 0) !== priceRub) {
      log.autoSalePriceRub = priceRub;
      dirty = true;
    }
    if (grossUsd > 0 && Math.abs(Number(log.autoSaleGrossUsd || 0) - grossUsd) > 0.005) {
      log.autoSaleGrossUsd = grossUsd;
      dirty = true;
    }
    await log.save();
    if (dirty) {
      void syncProfitChannelCaption(telegramApi, log).catch(() => {});
    }
    return log;
  }

  if (phase === "sold_held") {
    if (wasArbitration) clearClaimInfo(log);
    if (!log.autoSaleProfitTxId || String(log.autoSaleStatus) === "listed") {
      await creditSoldHeld(log, item);
    } else {
      await reconcileSaleAmounts(log, item);
    }
    if (wasArbitration && String(log.autoSaleStatus) === "arbitration") {
      log.autoSaleStatus = "sold_held";
      await log.save();
    }
    if (wasArbitration) notifyAutoSale(log, "Арбитраж закрыт", "снова холд");
    return log;
  }

  if (phase === "released") {
    if (wasArbitration) clearClaimInfo(log);
    if (!hasAutoSaleProfitTx(log)) {
      await creditSoldHeld(log, item, { holdEnded: true });
      return log;
    }
    if (
      wasArbitration ||
      String(log.autoSaleStatus) === "listed" ||
      String(log.autoSaleStatus) === "arbitration"
    ) {
      log.autoSaleStatus = "sold_held";
      await log.save();
    }
    return releaseHold(log);
  }

  if (phase === "terminal_unsold") {
    if (String(log.autoSaleStatus) === "listed") {
      log.autoSaleStatus = "failed";
      log.autoSaleError = "Невалид (лот удалён)";
      await log.save();
      notifyAutoSale(log, "Невалид", "лот удалён");
      void syncProfitChannelCaption(telegramApi, log).catch(() => {});
      return log;
    }
    if (shouldClawbackForLztPhase(phase, log.autoSaleStatus, Boolean(log.autoSaleProfitTxId))) {
      return clawbackAutoSaleHold(log, { reason: "deleted", wasArbitration });
    }
    return log;
  }

  if (
    shouldClawbackForLztPhase(phase, log.autoSaleStatus, Boolean(log.autoSaleProfitTxId))
  ) {
    return clawbackAutoSaleHold(log, { reason: "unknown", wasArbitration });
  }

  if (wasArbitration) {
    await log.save();
  }

  return log;
}

async function recoverFailedAutoSales() {
  const failed = await SteamLog.find({
    autoSaleStatus: "failed",
    autoSaleTaskId: { $nin: ["", null] },
    $or: [{ lztItemId: "" }, { lztItemId: null }, { lztItemId: { $exists: false } }],
  })
    .sort({ updatedAt: 1 })
    .limit(15);

  for (const log of failed) {
    try {
      const task = unwrapPayload(await getSteamTask(log.autoSaleTaskId), [
        "id",
        "state",
        "status",
      ]);
      const itemId = extractLztItemIdFromTask(task);
      if (itemId) {
        await markLogListed(log, itemId);
        logger.info("Auto log sale recovered from failed", log.sourceId, itemId);
        continue;
      }
      if (isTaskInProgress(task)) {
        log.autoSaleStatus = "listing";
        log.autoSaleError = "";
        await log.save();
        logger.info("Auto log sale resumed listing after false timeout", log.sourceId);
        await progressListing(log, { once: true });
      }
    } catch (error) {
      logger.warn("Auto log sale failed recovery", log.sourceId, error.message);
    }
  }
}

async function tickAutoLogSales() {
  if (monitorRunning) return;
  monitorRunning = true;
  try {
    await recoverFailedAutoSales();

    const listing = await SteamLog.find({
      autoSaleStatus: { $in: [...ACTIVE_LISTING] },
    })
      .sort({ updatedAt: 1 })
      .limit(20);

    for (const log of listing) {
      try {
        await progressListing(log, { once: true });
      } catch (error) {
        logger.warn("Auto log sale listing tick failed", log.sourceId, error.message);
      }
    }

    const [uncredited, monitoring] = await Promise.all([
      SteamLog.find({
        autoSaleStatus: { $in: [...UNCREDITED_SOLD] },
        lztItemId: { $ne: "" },
        $or: [{ autoSaleProfitTxId: "" }, { autoSaleProfitTxId: null }],
      })
        .sort({ updatedAt: 1 })
        .limit(20),
      SteamLog.find({
        autoSaleStatus: { $in: [...ACTIVE_MONITOR] },
        lztItemId: { $ne: "" },
      })
        // Fair rotation by poll cursor (never-polled/oldest first). Sorting by
        // updatedAt starved newer sold/deleted lots behind always-active
        // listings whose updatedAt never advances.
        .sort({ autoSalePolledAt: 1, updatedAt: 1 })
        .limit(MONITOR_BATCH),
    ]);

    const seen = new Set();
    const queue = [];
    for (const log of [...uncredited, ...monitoring]) {
      const id = String(log._id);
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push(log);
    }

    if (queue.length && !env.lztMarketToken) {
      logger.warn(
        "Auto log sale LZT poll skipped: LZT_MARKET_TOKEN empty",
        `(${queue.length} lots pending)`
      );
    } else if (queue.length) {
      let claimMap = new Map();
      try {
        claimMap = await fetchActiveClaimByItemId();
      } catch (error) {
        logger.warn("Auto log sale claims fetch failed", error.message);
      }

      for (const log of queue) {
        try {
          await pollLztStatus(log, { claimMap });
        } catch (error) {
          logger.warn("Auto log sale LZT tick failed", log.sourceId, error.message);
        } finally {
          // Always advance the poll cursor (even on error / unchanged active
          // lots) so the next tick rotates to the rest of the backlog.
          try {
            await SteamLog.updateOne(
              { _id: log._id },
              { $set: { autoSalePolledAt: new Date() } },
              { timestamps: false }
            );
          } catch (_) {
            /* cursor stamp is best-effort */
          }
          await sleep(250);
        }
      }
    }
  } finally {
    monitorRunning = false;
  }
}

function startAutoLogSaleMonitor() {
  if (monitorTimer) return;
  const interval = Math.max(15_000, env.autoLogSalePollMs || 60_000);
  void (async () => {
    try {
      const stamped = await backfillAutoSaleActivityNotifyFlags();
      if (stamped?.total) {
        logger.info("Auto sale activity notify flags backfilled", stamped);
      }
    } catch (error) {
      logger.warn("Auto sale notify flag backfill failed", error.message);
    }
    try {
      await tickAutoLogSales();
    } catch (error) {
      logger.warn("Auto log sale initial tick failed", error.message);
    }
    try {
      const { syncUprojectTeamShareDebits } = require("./uprojectTeamShareService");
      await syncUprojectTeamShareDebits();
    } catch (error) {
      logger.warn("UProject team-share sync failed", error.message);
    }
  })();
  monitorTimer = setInterval(() => {
    tickAutoLogSales().catch((error) => {
      logger.warn("Auto log sale tick failed", error.message);
    });
    try {
      const { syncUprojectTeamShareDebits } = require("./uprojectTeamShareService");
      syncUprojectTeamShareDebits().catch((error) => {
        logger.warn("UProject team-share sync failed", error.message);
      });
    } catch (error) {
      logger.warn("UProject team-share sync failed", error.message);
    }
  }, interval);
  logger.info("Auto log sale monitor started", `interval=${interval}ms`);
}

function accountRowsFromPayload(payload) {
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  return [];
}

function canAdvanceAutoSaleStatus(current, next) {
  const from = AUTO_SALE_RANK[String(current || "none")] ?? 0;
  const to = AUTO_SALE_RANK[String(next || "none")] ?? 0;
  return to >= from;
}

function mapUprojectStatusToAutoSale(uprojectStatus, lztItemId) {
  const status = String(uprojectStatus || "").trim();
  if (/^onsell$/i.test(status)) return lztItemId ? "listed" : "listing";
  // OnHold and Sold on UProject both mean the lot was sold; money stays on LZT hold
  // until the market guarantee ends (confirmed only via LZT API → released).
  if (/^onhold$/i.test(status) || /^sold$/i.test(status)) return "sold_held";
  if (lztItemId) return "listed";
  return "";
}

function shouldApplyUprojectAutoSaleStatus(current, next) {
  const from = String(current || "none");
  const to = String(next || "");
  if (!to) return false;
  if (from === to) return true;
  // Never pull released back to sold_held: UProject often stays Sold/OnHold after
  // LZT guarantee ends; reverting caused releaseHold to re-post on every restart.
  if (from === "released") return false;
  if (from === "failed") return true;
  return canAdvanceAutoSaleStatus(from, to);
}

function extractSalePriceRub(account) {
  const candidates = [
    account?.lztPrice,
    account?.lzt_price,
    account?.sellPrice,
    account?.sell_price,
    account?.priceRub,
    account?.price_rub,
    account?.lzt?.price,
    account?.market?.price,
    account?.salePrice,
    account?.sale_price,
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

async function fetchUprojectSaleAccounts() {
  const statuses = ["OnSell", "OnHold", "Sold"];
  const byId = new Map();

  for (const status of statuses) {
    for (let page = 0; page < 40; page += 1) {
      const payload = await getSteamAccounts(null, {
        statuses: status,
        page,
        limit: 100,
        skipCache: true,
      });
      const rows = accountRowsFromPayload(payload);
      if (!rows.length) break;
      for (const row of rows) {
        const id = String(row?.id || "").trim();
        if (!id) continue;
        byId.set(id, row);
      }
      const totalPages = Number(payload?.totalPages ?? payload?.pages ?? 0);
      if (Number.isFinite(totalPages) && totalPages > 0 && page + 1 >= totalPages) break;
      if (rows.length < 100) break;
      await sleep(150);
    }
  }

  return [...byId.values()];
}

/**
 * Import existing UProject OnSell / OnHold / Sold accounts into auto-sale tracking.
 * Does not credit wallets for already-sold/hold accounts (historical import).
 * Never posts to the activity channel — stamps notify flags for already-known rows.
 */
async function syncExistingAutoSalesFromUproject() {
  if (syncRunning) {
    return { ok: false, skipped: true, reason: "already_running" };
  }
  syncRunning = true;
  const summary = {
    scanned: 0,
    imported: 0,
    updated: 0,
    unchanged: 0,
    listed: 0,
    sold_held: 0,
    released: 0,
    listing: 0,
    errors: 0,
  };

  try {
    const { upsertSteamLogFromAccount } = require("./steamMonitorService");
    const accounts = await fetchUprojectSaleAccounts();
    summary.scanned = accounts.length;

    for (const account of accounts) {
      try {
        const lztItemId = extractLztItemId(account);
        const nextStatus = mapUprojectStatusToAutoSale(account?.status, lztItemId);
        if (!nextStatus) {
          summary.unchanged += 1;
          continue;
        }

        const log = await upsertSteamLogFromAccount(account, {});
        if (!log) {
          summary.errors += 1;
          continue;
        }

        const current = String(log.autoSaleStatus || "none");
        const priceRub = extractSalePriceRub(account);
        if (!shouldApplyUprojectAutoSaleStatus(current, nextStatus) && current !== nextStatus) {
          // Still refresh link/price if missing.
          let touched = false;
          if (lztItemId && !log.lztItemId) {
            log.lztItemId = lztItemId;
            log.lztMarketUrl = lztMarketUrl(lztItemId);
            touched = true;
          }
          if (priceRub > 0 && !(Number(log.autoSalePriceRub || 0) > 0)) {
            log.autoSalePriceRub = priceRub;
            touched = true;
          }
          // Keep released rows silent even when UProject still says Sold/OnHold.
          if (stampAutoSaleNotifyFlags(log, current)) touched = true;
          if (touched) {
            await log.save();
            summary.updated += 1;
          } else {
            summary.unchanged += 1;
          }
          continue;
        }

        const wasTracked = current !== "none" && current !== "";
        const statusChanged = current !== nextStatus;
        log.autoSaleStatus = nextStatus;
        if (lztItemId) {
          log.lztItemId = lztItemId;
          log.lztMarketUrl = lztMarketUrl(lztItemId);
        }
        if (priceRub > 0) {
          log.autoSalePriceRub = priceRub;
          if (!(Number(log.autoSaleGrossUsd || 0) > 0)) {
            try {
              const rate = await getUsdRubRate();
              log.autoSaleGrossUsd = convertRubToUsd(priceRub, rate);
            } catch (_) {
              /* keep price rub only */
            }
          }
        }
        if (nextStatus === "listed" && !log.autoSaleListedAt) {
          log.autoSaleListedAt = new Date();
        }
        if (nextStatus === "sold_held") {
          if (!log.autoSaleSoldAt) log.autoSaleSoldAt = new Date();
        }
        if (nextStatus === "released") {
          if (!log.autoSaleSoldAt) log.autoSaleSoldAt = new Date();
          if (!log.autoSaleReleasedAt) log.autoSaleReleasedAt = new Date();
        }
        if (current === "failed") {
          log.autoSaleError = "";
        }
        if (log.status === "new") {
          log.status = "processed";
        }
        if (!log.logKind || log.logKind === "other") {
          log.logKind = "valid";
        }
        // Already-tracked rows: silence activity posts on restart sync.
        // Brand-new imports of active sold_held may still notify once via LZT credit.
        if (wasTracked || !statusChanged || nextStatus === "listed" || nextStatus === "listing") {
          stampAutoSaleNotifyFlags(log, nextStatus);
        }
        await log.save();

        if (wasTracked) summary.updated += 1;
        else summary.imported += 1;
        if (summary[nextStatus] != null) summary[nextStatus] += 1;
      } catch (error) {
        summary.errors += 1;
        logger.warn(
          "Auto sale UProject sync row failed",
          account?.id,
          error.message
        );
      }
    }

    logger.info("Auto sale UProject sync done", summary);
    return { ok: true, ...summary };
  } catch (error) {
    logger.error("Auto sale UProject sync failed", error.message);
    throw error;
  } finally {
    syncRunning = false;
  }
}

/** Stamp notify flags in-memory for a reached auto-sale status (no Telegram post). */
function stampAutoSaleNotifyFlags(log, status) {
  const key = String(status || "");
  const now = new Date();
  if (!log.autoSaleActivityNotified) log.autoSaleActivityNotified = {};
  const n = log.autoSaleActivityNotified;
  let dirty = false;
  const set = (field) => {
    if (!n[field]) {
      n[field] = now;
      dirty = true;
    }
  };
  if (["listed", "sold_held", "arbitration", "released"].includes(key)) {
    set("listing");
    set("listed");
  }
  if (["sold_held", "arbitration", "released"].includes(key)) {
    set("sold_held");
    set("sold_held_dm");
  }
  if (key === "arbitration") set("arbitration");
  if (key === "released") {
    set("released");
    set("released_dm");
    set("arbitration_closed");
  }
  if (key === "refunded") {
    set("refunded");
    set("refunded_dm");
  }
  return dirty;
}

/**
 * One-shot on boot: mark existing lifecycle states as already notified so the
 * first post-deploy poll does not re-flood the activity channel.
 */
async function backfillAutoSaleActivityNotifyFlags() {
  const now = new Date();
  const [listed, held, arbitration, released] = await Promise.all([
    SteamLog.updateMany(
      {
        autoSaleStatus: "listed",
        $or: [
          { "autoSaleActivityNotified.listed": null },
          { "autoSaleActivityNotified.listed": { $exists: false } },
        ],
      },
      {
        $set: {
          "autoSaleActivityNotified.listing": now,
          "autoSaleActivityNotified.listed": now,
        },
      }
    ),
    SteamLog.updateMany(
      {
        autoSaleStatus: "sold_held",
        $or: [
          { "autoSaleActivityNotified.sold_held": null },
          { "autoSaleActivityNotified.sold_held": { $exists: false } },
        ],
      },
      {
        $set: {
          "autoSaleActivityNotified.listing": now,
          "autoSaleActivityNotified.listed": now,
          "autoSaleActivityNotified.sold_held": now,
          "autoSaleActivityNotified.sold_held_dm": now,
        },
      }
    ),
    SteamLog.updateMany(
      {
        autoSaleStatus: "arbitration",
        $or: [
          { "autoSaleActivityNotified.arbitration": null },
          { "autoSaleActivityNotified.arbitration": { $exists: false } },
        ],
      },
      {
        $set: {
          "autoSaleActivityNotified.listing": now,
          "autoSaleActivityNotified.listed": now,
          "autoSaleActivityNotified.sold_held": now,
          "autoSaleActivityNotified.sold_held_dm": now,
          "autoSaleActivityNotified.arbitration": now,
        },
      }
    ),
    SteamLog.updateMany(
      {
        autoSaleStatus: "released",
        $or: [
          { "autoSaleActivityNotified.released": null },
          { "autoSaleActivityNotified.released": { $exists: false } },
        ],
      },
      {
        $set: {
          "autoSaleActivityNotified.listing": now,
          "autoSaleActivityNotified.listed": now,
          "autoSaleActivityNotified.sold_held": now,
          "autoSaleActivityNotified.sold_held_dm": now,
          "autoSaleActivityNotified.released": now,
          "autoSaleActivityNotified.released_dm": now,
          "autoSaleActivityNotified.arbitration_closed": now,
        },
      }
    ),
  ]);
  const summary = {
    listed: listed.modifiedCount || 0,
    sold_held: held.modifiedCount || 0,
    arbitration: arbitration.modifiedCount || 0,
    released: released.modifiedCount || 0,
  };
  summary.total =
    summary.listed + summary.sold_held + summary.arbitration + summary.released;
  return summary;
}

const AUTO_SALE_STATUSES = new Set([
  "queued",
  "listing",
  "listed",
  "sold_held",
  "arbitration",
  "released",
  "refunded",
  "failed",
]);

const AUTO_SALE_STATUS_LABELS = {
  queued: "В очереди",
  listing: "Выставляется",
  listed: "На продаже",
  sold_held: "Продан · холд",
  arbitration: "Арбитраж",
  released: "Продан · холд снят",
  refunded: "Продажа отменена",
  failed: "Ошибка",
};

function autoSaleStatusLabel(status) {
  const key = String(status || "none");
  return AUTO_SALE_STATUS_LABELS[key] || key || "—";
}

function formatHoldUntilRu(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildHoldTooltip(row) {
  const status = String(row.autoSaleStatus || "");
  if (status === "arbitration") {
    const parts = ["Открыт арбитраж"];
    if (row.autoSaleClaimAt) {
      parts.push(`с ${formatHoldUntilRu(row.autoSaleClaimAt)}`);
    }
    if (row.autoSaleClaimThreadId) {
      parts.push(`тред #${row.autoSaleClaimThreadId}`);
    }
    if (row.autoSaleHoldUntil) {
      parts.push(`гарантия до ${formatHoldUntilRu(row.autoSaleHoldUntil)}`);
    }
    return parts.join(" · ");
  }
  if (status !== "sold_held") return "";
  const parts = [];
  if (row.autoSaleHoldUntil) {
    parts.push(`Холд до ${formatHoldUntilRu(row.autoSaleHoldUntil)}`);
  }
  const holdMs = row.autoSaleHoldUntil
    ? new Date(row.autoSaleHoldUntil).getTime() - Date.now()
    : 0;
  if (row.autoSaleHoldRemainingPhrase && holdMs > 0) {
    parts.push(`осталось ${row.autoSaleHoldRemainingPhrase}`);
  } else if (row.autoSaleHoldUntil) {
    if (holdMs > 0) {
      const hours = Math.floor(holdMs / 3_600_000);
      const mins = Math.floor((holdMs % 3_600_000) / 60_000);
      parts.push(hours > 0 ? `осталось ~${hours} ч ${mins} мин` : `осталось ~${mins} мин`);
    } else {
      parts.push("срок холда истёк — ждём подтверждение");
    }
  }
  if (row.autoSaleHoldDurationPhrase) {
    parts.push(`гарантия ${row.autoSaleHoldDurationPhrase}`);
  }
  return parts.join(" · ");
}

function describeAutoSaleActions(row, { credited, needsCredit } = {}) {
  const status = String(row?.autoSaleStatus || "");
  const hasLot = Boolean(String(row?.lztItemId || "").trim());
  const hasCredit = credited != null ? Boolean(credited) : hasAutoSaleProfitTx(row);
  const miss = needsCredit != null ? Boolean(needsCredit) : UNCREDITED_SOLD.has(status) && !hasCredit;
  const holdish = status === "sold_held" || status === "arbitration";
  const syncable = new Set(["listing", "listed", "sold_held", "arbitration", "released", "failed"]);
  return {
    canSync: hasLot && syncable.has(status),
    canCredit: miss && hasLot,
    canReleaseHold: holdish,
    canClawback: CLAWBACK_STATUSES.has(status),
  };
}

function ownerProfitPercent(owner) {
  const percent = Number(owner?.profitPercent);
  if (Number.isFinite(percent) && percent > 0) return Math.min(100, percent);
  return Math.max(1, Math.min(100, Number(env.steamWorkerPercent) || 70));
}

function computedWorkerShareFromOwner(log, owner) {
  if (!owner) return 0;
  const gross = Number(log?.autoSaleGrossUsd || 0);
  if (!(gross > 0)) return 0;
  return workerShareFromGross(gross, ownerProfitPercent(owner));
}

function resolveDisplayWorkerShare(log, owner, tx = null) {
  const stored = Number(log?.autoSaleWorkerShareUsd || 0);
  if (stored > 0) return roundAutosaleUsd(stored);
  const txShare = Number(tx?.workerShare || 0);
  if (txShare > 0) return roundAutosaleUsd(txShare);
  return roundAutosaleUsd(computedWorkerShareFromOwner(log, owner));
}

function serializeAutoSaleLog(row, owner) {
  const status = String(row.autoSaleStatus || "none");
  const holdTooltip = buildHoldTooltip(row);
  const credited = hasAutoSaleProfitTx(row);
  const needsCredit = UNCREDITED_SOLD.has(status) && !credited;
  const workerShare = resolveDisplayWorkerShare(row, owner);
  return {
    sourceId: String(row.sourceId || ""),
    steamId: String(row.steamId || ""),
    accountUsername: String(row.accountUsername || ""),
    ownerTelegramId: String(row.ownerTelegramId || ""),
    owner: owner
      ? {
          telegramId: String(owner.telegramId || ""),
          username: String(owner.username || ""),
          firstName: String(owner.firstName || ""),
          customId: String(owner.customId || ""),
          isAnonymous: Boolean(owner.isAnonymous),
          fakeProfitTag: String(owner.fakeProfitTag || ""),
          profitPercent: ownerProfitPercent(owner),
          frozenSaleUsd: Number(owner.frozenSaleUsd || 0),
        }
      : null,
    lztItemId: String(row.lztItemId || ""),
    lztMarketUrl: String(row.lztMarketUrl || (row.lztItemId ? lztMarketUrl(row.lztItemId) : "")),
    autoSaleStatus: status,
    statusLabel: autoSaleStatusLabel(status),
    statusTooltip: holdTooltip,
    autoSaleError: String(row.autoSaleError || ""),
    autoSaleTaskId: String(row.autoSaleTaskId || ""),
    autoSalePriceRub: Number(row.autoSalePriceRub || 0),
    autoSaleGrossUsd: Number(row.autoSaleGrossUsd || 0),
    autoSaleWorkerShareUsd: workerShare,
    totalProfit: Number(row.totalProfit || 0),
    credited,
    needsCredit,
    holdActive: status === "sold_held" || status === "arbitration",
    actions: describeAutoSaleActions(row, { credited, needsCredit }),
    autoSaleHoldUntil: row.autoSaleHoldUntil || null,
    autoSaleHoldRemainingPhrase: String(row.autoSaleHoldRemainingPhrase || ""),
    autoSaleHoldDurationPhrase: String(row.autoSaleHoldDurationPhrase || ""),
    autoSaleClaimThreadId: String(row.autoSaleClaimThreadId || ""),
    autoSaleClaimAt: row.autoSaleClaimAt || null,
    autoSaleListedAt: row.autoSaleListedAt || null,
    autoSaleSoldAt: row.autoSaleSoldAt || null,
    autoSaleReleasedAt: row.autoSaleReleasedAt || null,
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
  };
}

async function listAutoSaleLogs({ q = "", status = "", limit = 20, page = 0 } = {}) {
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const requestedPage = Math.max(0, Number.parseInt(page, 10) || 0);
  const query = {
    autoSaleStatus: { $exists: true, $nin: ["none", null, ""] },
  };
  const statusKey = String(status || "").trim();
  if (AUTO_SALE_STATUSES.has(statusKey)) {
    query.autoSaleStatus = statusKey;
  } else if (statusKey === "active") {
    query.autoSaleStatus = { $in: ["queued", "listing", "listed", "sold_held", "arbitration"] };
  } else if (statusKey === "on_sale") {
    query.autoSaleStatus = "listed";
  } else if (statusKey === "sold") {
    query.autoSaleStatus = { $in: ["sold_held", "arbitration", "released"] };
  } else if (statusKey === "needs_credit") {
    query.autoSaleStatus = { $in: [...UNCREDITED_SOLD] };
    query.$and = [{ $or: [{ autoSaleProfitTxId: "" }, { autoSaleProfitTxId: null }] }];
  } else if (statusKey === "guarantee_active") {
    query.autoSaleStatus = "sold_held";
    query.autoSaleHoldUntil = { $gt: new Date() };
  } else if (statusKey === "guarantee_12h") {
    query.autoSaleStatus = "sold_held";
    query.autoSaleHoldUntil = { $gt: new Date() };
    query.$and = [
      ...(query.$and || []),
      {
        $or: [
          { autoSaleHoldDurationPhrase: TWELVE_HOUR_HOLD_PHRASE_RX },
          { autoSaleHoldDurationPhrase: "" },
          { autoSaleHoldDurationPhrase: null },
          { autoSaleHoldDurationPhrase: { $exists: false } },
        ],
      },
    ];
  }

  const needle = String(q || "").trim();
  if (needle) {
    const rx = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const matchedOwners = await User.find({
      $or: [{ username: rx }, { firstName: rx }, { customId: rx }, { telegramId: rx }],
    })
      .select("telegramId")
      .limit(80)
      .lean();
    const ownerIds = matchedOwners
      .map((user) => String(user.telegramId || ""))
      .filter(Boolean);
    const searchOr = [
      { sourceId: rx },
      { accountUsername: rx },
      { steamId: rx },
      { ownerTelegramId: rx },
      { lztItemId: rx },
      { lztMarketUrl: rx },
    ];
    if (ownerIds.length) searchOr.push({ ownerTelegramId: { $in: ownerIds } });
    query.$and = [...(query.$and || []), { $or: searchOr }];
  }

  const total = await SteamLog.countDocuments(query);
  const pageCount = Math.max(1, Math.ceil(total / safeLimit) || 1);
  const pageIndex = Math.min(requestedPage, pageCount - 1);
  const sort = statusKey === "guarantee_active" || statusKey === "guarantee_12h"
    ? { autoSaleHoldUntil: 1 }
    : { updatedAt: -1 };
  const rows = await SteamLog.find(query)
    .sort(sort)
    .skip(pageIndex * safeLimit)
    .limit(safeLimit)
    .lean();
  const ownerIds = [...new Set(rows.map((row) => String(row.ownerTelegramId || "")).filter(Boolean))];
  const users = ownerIds.length
    ? await User.find(
        { telegramId: { $in: ownerIds } },
        {
          telegramId: 1,
          username: 1,
          firstName: 1,
          customId: 1,
          isAnonymous: 1,
          fakeProfitTag: 1,
          profitPercent: 1,
          frozenSaleUsd: 1,
        }
      ).lean()
    : [];
  const byTelegramId = new Map(users.map((user) => [String(user.telegramId), user]));

  return {
    rows: rows.map((row) =>
      serializeAutoSaleLog(row, byTelegramId.get(String(row.ownerTelegramId || "")))
    ),
    total,
    page: pageIndex,
    pageCount,
    limit: safeLimit,
  };
}

const SOLD_AUTOSALE_STATUSES = ["sold_held", "arbitration", "released"];
const TWELVE_HOUR_HOLD_PHRASE_RX = /^12\s*(?:ч|час|h|hour)/i;
const AUTO_SALE_STATS_PERIODS = Object.freeze({
  "24h": { hours: 24, label: "24 часа" },
  "7d": { hours: 24 * 7, label: "7 дней" },
  "30d": { hours: 24 * 30, label: "30 дней" },
});

function resolveAutoSaleStatsPeriod(value = "7d", now = new Date()) {
  const key = Object.prototype.hasOwnProperty.call(AUTO_SALE_STATS_PERIODS, value)
    ? value
    : "7d";
  const config = AUTO_SALE_STATS_PERIODS[key];
  const end = now instanceof Date ? now : new Date(now);
  const since = new Date(end.getTime() - config.hours * 60 * 60 * 1000);
  return { key, label: config.label, since, until: end };
}

function roundAutosaleUsd(value) {
  return Number(Number(value || 0).toFixed(2));
}

function isLikelyTwelveHourHold(row, nowMs = Date.now()) {
  const phrase = String(row?.autoSaleHoldDurationPhrase || "").trim();
  if (TWELVE_HOUR_HOLD_PHRASE_RX.test(phrase)) return true;
  if (phrase) return false;

  const holdUntil = new Date(row?.autoSaleHoldUntil || 0).getTime();
  if (!holdUntil || holdUntil <= nowMs) return false;

  const soldAt = new Date(row?.autoSaleSoldAt || 0).getTime();
  if (soldAt > 0) {
    const durationHours = (holdUntil - soldAt) / 36e5;
    if (durationHours > 0 && durationHours <= 13) return true;
  }

  return true;
}

async function mapWithConcurrency(items, limit, worker) {
  const rows = Array.isArray(items) ? items : [];
  const safeLimit = Math.max(1, Math.min(Number(limit) || 4, 10));
  const results = new Array(rows.length);
  let cursor = 0;
  async function runNext() {
    while (cursor < rows.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(rows[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(safeLimit, rows.length) }, () => runNext())
  );
  return results;
}

function resolveSoldWorkerShare(log, tx, owner = null) {
  const stored = Number(log?.autoSaleWorkerShareUsd || 0);
  if (stored > 0) return roundAutosaleUsd(stored);
  const txShare = Number(tx?.workerShare || 0);
  if (txShare > 0) return roundAutosaleUsd(txShare);
  const gross = Number(log?.autoSaleGrossUsd || 0);
  if (gross > 0 && isLegacyFullGrossHold(txShare, gross)) return roundAutosaleUsd(gross);
  if (gross > 0) return roundAutosaleUsd(computedWorkerShareFromOwner(log, owner));
  return 0;
}

function accumulateAutoSaleMoney(soldLogs, txById, ownerByTelegramId = new Map()) {
  let heldUsd = 0;
  let releasedUsd = 0;
  let grossSoldUsd = 0;
  let workerShareUsd = 0;
  let workerShareReleasedUsd = 0;
  let workerShareOnHoldUsd = 0;
  let teamShareUsd = 0;
  let teamShareReleasedUsd = 0;
  let teamShareOnHoldUsd = 0;
  let releasedGrossUsd = 0;
  let heldGrossUsd = 0;
  let missingCreditCount = 0;
  const shareByOwner = new Map();

  for (const log of soldLogs) {
    const tx = txById.get(String(log.autoSaleProfitTxId || ""));
    const owner = ownerByTelegramId.get(String(log.ownerTelegramId || "")) || null;
    const share = resolveSoldWorkerShare(log, tx, owner);
    const gross = roundAutosaleUsd(log.autoSaleGrossUsd);
    const team = roundAutosaleUsd(Math.max(0, gross - share));
    const status = String(log.autoSaleStatus || "");
    grossSoldUsd = roundAutosaleUsd(grossSoldUsd + gross);
    workerShareUsd = roundAutosaleUsd(workerShareUsd + share);
    if (!hasAutoSaleProfitTx(log)) missingCreditCount += 1;
    if (status === "sold_held" || status === "arbitration") {
      heldUsd = roundAutosaleUsd(heldUsd + share);
      workerShareOnHoldUsd = heldUsd;
      heldGrossUsd = roundAutosaleUsd(heldGrossUsd + gross);
      teamShareOnHoldUsd = roundAutosaleUsd(teamShareOnHoldUsd + team);
    } else if (status === "released") {
      releasedUsd = roundAutosaleUsd(releasedUsd + share);
      workerShareReleasedUsd = releasedUsd;
      releasedGrossUsd = roundAutosaleUsd(releasedGrossUsd + gross);
      teamShareReleasedUsd = roundAutosaleUsd(teamShareReleasedUsd + team);
    }
    const ownerId = String(log.ownerTelegramId || "");
    if (ownerId) {
      shareByOwner.set(ownerId, roundAutosaleUsd((shareByOwner.get(ownerId) || 0) + share));
    }
  }

  teamShareUsd = teamShareReleasedUsd;

  return {
    shareByOwner,
    heldUsd,
    releasedUsd,
    grossSoldUsd,
    workerShareUsd,
    workerShareReleasedUsd,
    workerShareOnHoldUsd,
    teamShareUsd,
    teamShareReleasedUsd,
    teamShareOnHoldUsd,
    releasedGrossUsd,
    heldGrossUsd,
    missingCreditCount,
  };
}

async function loadOwnerShareMap(logs) {
  const ownerIds = [
    ...new Set((logs || []).map((row) => String(row.ownerTelegramId || "")).filter(Boolean)),
  ];
  if (!ownerIds.length) return new Map();
  const users = await User.find(
    { telegramId: { $in: ownerIds } },
    { telegramId: 1, profitPercent: 1 }
  ).lean();
  return new Map(users.map((user) => [String(user.telegramId), user]));
}

async function loadSoldAutosaleShareContext() {
  const [soldLogs, frozenAgg, statusRows, listedAgg] = await Promise.all([
    SteamLog.find({ autoSaleStatus: { $in: SOLD_AUTOSALE_STATUSES } })
      .select(
        "ownerTelegramId autoSaleStatus autoSaleWorkerShareUsd autoSaleGrossUsd autoSaleProfitTxId autoSaleHoldUntil autoSaleSoldAt autoSaleHoldDurationPhrase"
      )
      .lean(),
    User.aggregate([
      {
        $group: {
          _id: null,
          frozenBalancesUsd: { $sum: { $ifNull: ["$frozenSaleUsd", 0] } },
        },
      },
    ]),
    SteamLog.aggregate([
      {
        $match: {
          autoSaleStatus: { $exists: true, $nin: ["none", null, ""] },
        },
      },
      { $group: { _id: "$autoSaleStatus", count: { $sum: 1 } } },
    ]),
    SteamLog.aggregate([
      {
        $match: { autoSaleStatus: { $in: ["queued", "listing", "listed"] } },
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          usd: { $sum: { $ifNull: ["$autoSaleGrossUsd", 0] } },
        },
      },
    ]),
  ]);

  const txIds = [
    ...new Set(
      soldLogs.map((row) => String(row.autoSaleProfitTxId || "")).filter(Boolean)
    ),
  ];
  const txs = txIds.length
    ? await ProfitTransaction.find({ _id: { $in: txIds } })
        .select("_id workerShare amount")
        .lean()
    : [];
  const txById = new Map(txs.map((tx) => [String(tx._id), tx]));
  const ownerByTelegramId = await loadOwnerShareMap(soldLogs);
  const money = accumulateAutoSaleMoney(soldLogs, txById, ownerByTelegramId);
  const now = Date.now();
  const activeGuarantee = soldLogs.filter((row) => {
    if (String(row.autoSaleStatus || "") !== "sold_held") return false;
    const holdUntil = new Date(row.autoSaleHoldUntil || 0).getTime();
    return holdUntil > now;
  });
  const activeGuarantee12h = soldLogs.filter((row) => {
    if (String(row.autoSaleStatus || "") !== "sold_held") return false;
    const holdUntil = new Date(row.autoSaleHoldUntil || 0).getTime();
    if (!holdUntil || holdUntil <= now) return false;
    return isLikelyTwelveHourHold(row, now);
  });
  const activeGuaranteeMoney = accumulateAutoSaleMoney(activeGuarantee, txById, ownerByTelegramId);
  const guarantee12hMoney = accumulateAutoSaleMoney(activeGuarantee12h, txById, ownerByTelegramId);

  return {
    soldLogs,
    frozenBalancesUsd: roundAutosaleUsd(frozenAgg[0]?.frozenBalancesUsd || 0),
    statusRows,
    listedCount: Number(listedAgg[0]?.count || 0),
    listedUsd: roundAutosaleUsd(listedAgg[0]?.usd || 0),
    activeGuaranteeCount: activeGuarantee.length,
    activeGuaranteeGrossUsd: activeGuaranteeMoney.heldGrossUsd,
    activeGuaranteeWorkerShareUsd: activeGuaranteeMoney.workerShareOnHoldUsd,
    activeGuaranteeTeamShareUsd: activeGuaranteeMoney.teamShareOnHoldUsd,
    activeGuarantee12hCount: activeGuarantee12h.length,
    activeGuarantee12hGrossUsd: guarantee12hMoney.heldGrossUsd,
    activeGuarantee12hWorkerShareUsd: guarantee12hMoney.workerShareOnHoldUsd,
    activeGuarantee12hTeamShareUsd: guarantee12hMoney.teamShareOnHoldUsd,
    ...money,
  };
}

async function loadPeriodAutosaleStats(since) {
  const soldMatch = {
    autoSaleStatus: { $in: SOLD_AUTOSALE_STATUSES },
    autoSaleSoldAt: { $gte: since },
  };
  const releasedMatch = {
    autoSaleStatus: "released",
    autoSaleReleasedAt: { $gte: since },
  };
  const fields = "ownerTelegramId autoSaleStatus autoSaleWorkerShareUsd autoSaleGrossUsd autoSaleProfitTxId";
  const [soldLogs, releasedLogs, failedCount, refundedCount] = await Promise.all([
    SteamLog.find(soldMatch).select(fields).lean(),
    SteamLog.find(releasedMatch).select(fields).lean(),
    SteamLog.countDocuments({ autoSaleStatus: "failed", updatedAt: { $gte: since } }),
    SteamLog.countDocuments({ autoSaleStatus: "refunded", updatedAt: { $gte: since } }),
  ]);
  const txIds = [
    ...new Set(
      [...soldLogs, ...releasedLogs]
        .map((row) => String(row.autoSaleProfitTxId || ""))
        .filter(Boolean)
    ),
  ];
  const txs = txIds.length
    ? await ProfitTransaction.find({ _id: { $in: txIds } })
        .select("_id workerShare amount")
        .lean()
    : [];
  const txById = new Map(txs.map((tx) => [String(tx._id), tx]));
  const ownerByTelegramId = await loadOwnerShareMap([...soldLogs, ...releasedLogs]);
  return {
    soldCount: soldLogs.length,
    releasedCount: releasedLogs.length,
    failedCount,
    refundedCount,
    soldMoney: accumulateAutoSaleMoney(soldLogs, txById, ownerByTelegramId),
    releasedMoney: accumulateAutoSaleMoney(releasedLogs, txById, ownerByTelegramId),
  };
}

async function sumAutosaleWorkerShareByOwner() {
  const { shareByOwner } = await loadSoldAutosaleShareContext();
  return shareByOwner;
}

function mergeOnSaleStats(lztOnSale, pendingRows) {
  const matched = new Set(lztOnSale?.matchedIds || []);
  let pendingCount = 0;
  let pendingUsd = 0;
  for (const row of pendingRows || []) {
    const id = String(row.lztItemId || "").trim();
    if (id && matched.has(id)) continue;
    pendingCount += 1;
    pendingUsd += Number(row.autoSaleGrossUsd || 0);
  }
  const lztCount = Number(lztOnSale?.count || 0);
  const lztUsd = Number(lztOnSale?.usd || 0);
  return {
    onSale: lztCount + pendingCount,
    onSaleUsd: roundAutosaleUsd(lztUsd + pendingUsd),
    onSalePendingCount: pendingCount,
    onSaleOtherCount: Number(lztOnSale?.otherCount || 0),
    onSaleOtherUsd: roundAutosaleUsd(lztOnSale?.otherUsd || 0),
  };
}

let lztOnSaleCache = { at: 0, data: null };
let lztOnSaleRefreshPromise = null;
const LZT_ON_SALE_TTL_MS = 45_000;
const LZT_ON_SALE_INITIAL_WAIT_MS = 250;

function invalidateLztOnSaleCache() {
  lztOnSaleCache = { at: 0, data: lztOnSaleCache.data };
}

async function loadPanelOnSaleItemIds() {
  const ids = await SteamLog.distinct("lztItemId", {
    autoSaleStatus: { $in: ["listed", "listing"] },
    lztItemId: { $nin: ["", null] },
  });
  return new Set(
    (ids || []).map((id) => String(id || "").trim()).filter(Boolean)
  );
}

async function refreshLztOnSaleStats() {
  try {
    const [rate, allowedItemIds] = await Promise.all([
      getUsdRubRate().catch(() => 0),
      loadPanelOnSaleItemIds(),
    ]);
    const data = await fetchLztOnSaleStats(rate, { allowedItemIds });
    lztOnSaleCache = { at: Date.now(), data };
    return data;
  } catch (error) {
    logger.warn("LZT on-sale stats failed", error.message);
    return lztOnSaleCache.data || null;
  }
}

function startLztOnSaleRefresh() {
  if (lztOnSaleRefreshPromise) return lztOnSaleRefreshPromise;
  lztOnSaleRefreshPromise = refreshLztOnSaleStats().finally(() => {
    lztOnSaleRefreshPromise = null;
  });
  return lztOnSaleRefreshPromise;
}

async function loadLztOnSaleStats() {
  if (!env.lztMarketToken) return null;
  if (lztOnSaleCache.data && Date.now() - lztOnSaleCache.at < LZT_ON_SALE_TTL_MS) {
    return lztOnSaleCache.data;
  }
  const refresh = startLztOnSaleRefresh();
  // Stale-while-revalidate: never make the admin wait for the full LZT pagination.
  if (lztOnSaleCache.data) return lztOnSaleCache.data;
  return Promise.race([
    refresh,
    new Promise((resolve) => setTimeout(() => resolve(null), LZT_ON_SALE_INITIAL_WAIT_MS)),
  ]);
}

async function getFreshLztOnSaleStats() {
  if (!env.lztMarketToken) return null;
  if (lztOnSaleCache.data && Date.now() - lztOnSaleCache.at < LZT_ON_SALE_TTL_MS) {
    return lztOnSaleCache.data;
  }
  return startLztOnSaleRefresh();
}

async function refreshActiveGuaranteeHolds({ limit = 120 } = {}) {
  const logs = await SteamLog.find({
    autoSaleStatus: { $in: ["sold_held", "arbitration"] },
    lztItemId: { $nin: ["", null] },
  })
    .sort({ autoSaleHoldUntil: -1, updatedAt: -1 })
    .limit(Math.min(200, Math.max(1, Number(limit) || 120)));

  let checked = 0;
  let changed = 0;
  let failed = 0;
  const activeRows = [];

  await mapWithConcurrency(logs, 5, async (log) => {
    const beforeStatus = String(log.autoSaleStatus || "");
    const beforeHoldUntil = log.autoSaleHoldUntil ? new Date(log.autoSaleHoldUntil).getTime() : 0;
    try {
      const updated = await pollLztStatus(log, { force: true });
      checked += 1;
      const afterStatus = String(updated?.autoSaleStatus || "");
      const afterHoldUntil = updated?.autoSaleHoldUntil ? new Date(updated.autoSaleHoldUntil).getTime() : 0;
      if (beforeStatus !== afterStatus || beforeHoldUntil !== afterHoldUntil) changed += 1;
      if (afterStatus !== "sold_held") return;
      const now = Date.now();
      if (afterHoldUntil > 0 && afterHoldUntil <= now) return;
      activeRows.push(updated);
    } catch (error) {
      failed += 1;
      logger.warn("Auto sale guarantee refresh failed", log.sourceId, error?.message || error);
    }
  });

  const txIds = [
    ...new Set(
      activeRows.map((row) => String(row.autoSaleProfitTxId || "")).filter(Boolean)
    ),
  ];
  const txs = txIds.length
    ? await ProfitTransaction.find({ _id: { $in: txIds } })
        .select("_id workerShare amount")
        .lean()
    : [];
  const txById = new Map(txs.map((tx) => [String(tx._id), tx]));
  const activeGuarantee12h = activeRows.filter((row) =>
    isLikelyTwelveHourHold(row, Date.now())
  );
  const activeGuaranteeMoney = accumulateAutoSaleMoney(activeRows, txById);
  const guarantee12hMoney = accumulateAutoSaleMoney(activeGuarantee12h, txById);

  return {
    checked,
    changed,
    failed,
    activeGuaranteeCount: activeRows.length,
    activeGuaranteeGrossUsd: activeGuaranteeMoney.heldGrossUsd,
    activeGuaranteeWorkerShareUsd: activeGuaranteeMoney.workerShareOnHoldUsd,
    activeGuaranteeTeamShareUsd: activeGuaranteeMoney.teamShareOnHoldUsd,
    activeGuarantee12hCount: activeGuarantee12h.length,
    activeGuarantee12hGrossUsd: guarantee12hMoney.heldGrossUsd,
    activeGuarantee12hWorkerShareUsd: guarantee12hMoney.workerShareOnHoldUsd,
    activeGuarantee12hTeamShareUsd: guarantee12hMoney.teamShareOnHoldUsd,
  };
}

async function serializeAutoSaleBySourceId(sourceId) {
  const row = await SteamLog.findOne({ sourceId: String(sourceId || "") }).lean();
  if (!row) return null;
  const owner = row.ownerTelegramId
    ? await User.findOne(
        { telegramId: String(row.ownerTelegramId) },
        {
          telegramId: 1,
          username: 1,
          firstName: 1,
          customId: 1,
          isAnonymous: 1,
          fakeProfitTag: 1,
          frozenSaleUsd: 1,
        }
      ).lean()
    : null;
  return serializeAutoSaleLog(row, owner);
}

async function findAutoSaleBySourceId(sourceId) {
  const id = String(sourceId || "").trim();
  if (!id) throw new Error("Не указан лог.");
  const log = await SteamLog.findOne({ sourceId: id });
  if (!log) throw new Error("Лог не найден.");
  return log;
}

async function adminAutoSaleAction(sourceId, action) {
  const log = await findAutoSaleBySourceId(sourceId);
  const act = String(action || "").trim();
  invalidateLztOnSaleCache();

  if (act === "sync") {
    if (!String(log.lztItemId || "").trim()) {
      throw new Error("У лога нет лота LZT.");
    }
    if (String(log.autoSaleStatus || "") === "refunded") {
      throw new Error("Отменённую продажу нельзя синхронизировать.");
    }
    await pollLztStatus(log, { force: true });
    return serializeAutoSaleBySourceId(log.sourceId);
  }

  if (act === "credit") {
    if (!String(log.lztItemId || "").trim()) {
      throw new Error("У лога нет лота LZT.");
    }
    if (hasAutoSaleProfitTx(log)) {
      throw new Error("Начисление уже есть.");
    }
    const item = await getItem(log.lztItemId);
    const phase = classifyLztSaleState(item);
    if (phase !== "sold_held" && phase !== "released") {
      throw new Error("LZT ещё не подтвердил продажу этого лота.");
    }
    await creditSoldHeld(log, item, { holdEnded: phase === "released" });
    return serializeAutoSaleBySourceId(log.sourceId);
  }

  if (act === "release-hold") {
    const status = String(log.autoSaleStatus || "");
    if (status !== "sold_held" && status !== "arbitration") {
      throw new Error("Холд уже не активен.");
    }
    if (status === "arbitration") {
      log.autoSaleStatus = "sold_held";
      await log.save();
    }
    if (!hasAutoSaleProfitTx(log)) {
      log.autoSaleStatus = "released";
      log.autoSaleReleasedAt = log.autoSaleReleasedAt || new Date();
      log.autoSaleError = "Холд закрыт без начисления";
      await log.save();
      logger.info("Admin closed hold without credit", log.sourceId);
      notifyAutoSale(log, "Холд снят", "без начисления · админ");
      return serializeAutoSaleBySourceId(log.sourceId);
    }
    await releaseHold(log);
    return serializeAutoSaleBySourceId(log.sourceId);
  }

  if (act === "clawback") {
    const status = String(log.autoSaleStatus || "");
    if (!CLAWBACK_STATUSES.has(status)) {
      throw new Error("С этого лота нельзя забрать холд.");
    }
    await clawbackAutoSaleHold(log, {
      reason: "admin",
      wasArbitration: status === "arbitration",
    });
    return serializeAutoSaleBySourceId(log.sourceId);
  }

  throw new Error("Неизвестное действие.");
}

async function getAutoSaleStats({ period = "7d" } = {}) {
  const periodCtx = resolveAutoSaleStatsPeriod(String(period || "7d"));
  const [ctx, lztOnSale, pendingRows, teamDebitedUsd, periodStats, periodTeamDebitedUsd] = await Promise.all([
    loadSoldAutosaleShareContext(),
    loadLztOnSaleStats(),
    SteamLog.find({ autoSaleStatus: { $in: ["queued", "listing"] } })
      .select("lztItemId autoSaleGrossUsd")
      .lean(),
    sumTeamShareDebits(),
    loadPeriodAutosaleStats(periodCtx.since),
    sumTeamShareDebits({ start: periodCtx.since, end: periodCtx.until }),
  ]);
  const {
    frozenBalancesUsd,
    statusRows,
    listedUsd,
    heldUsd,
    releasedUsd,
    grossSoldUsd,
    workerShareUsd,
    workerShareReleasedUsd,
    workerShareOnHoldUsd,
    teamShareUsd,
    teamShareReleasedUsd,
    teamShareOnHoldUsd,
    releasedGrossUsd,
    heldGrossUsd,
    missingCreditCount,
    activeGuaranteeCount,
    activeGuaranteeGrossUsd,
    activeGuaranteeWorkerShareUsd,
    activeGuaranteeTeamShareUsd,
    activeGuarantee12hCount,
    activeGuarantee12hGrossUsd,
    activeGuarantee12hWorkerShareUsd,
    activeGuarantee12hTeamShareUsd,
  } = ctx;

  const statuses = {
    queued: 0,
    listing: 0,
    listed: 0,
    sold_held: 0,
    arbitration: 0,
    released: 0,
    failed: 0,
    refunded: 0,
  };
  for (const row of statusRows) {
    const key = String(row._id || "");
    if (Object.prototype.hasOwnProperty.call(statuses, key)) {
      statuses[key] += Number(row.count || 0);
    }
  }

  const onSaleDb = statuses.queued + statuses.listing + statuses.listed;
  const merged = lztOnSale
    ? mergeOnSaleStats(lztOnSale, pendingRows)
    : {
        onSale: onSaleDb,
        onSaleUsd: listedUsd,
        onSalePendingCount: statuses.queued + statuses.listing,
        onSaleOtherCount: 0,
        onSaleOtherUsd: 0,
      };
  const sold = statuses.sold_held + statuses.arbitration + statuses.released;
  const total = onSaleDb + sold + statuses.failed + statuses.refunded;
  const teamNet = applyTeamShareDebits(
    teamShareReleasedUsd ?? teamShareUsd,
    teamDebitedUsd
  );
  const periodTeamNet = applyTeamShareDebits(
    periodStats.releasedMoney.teamShareReleasedUsd,
    periodTeamDebitedUsd
  );

  return {
    statuses,
    total,
    onSale: merged.onSale,
    lztOnSaleCount: lztOnSale ? Number(lztOnSale.count || 0) : statuses.listed,
    lztOnSaleUsd: lztOnSale ? roundAutosaleUsd(lztOnSale.usd || 0) : listedUsd,
    onSaleDb,
    onSaleUsd: merged.onSaleUsd,
    onSalePendingCount: merged.onSalePendingCount,
    onSaleOtherCount: merged.onSaleOtherCount,
    onSaleOtherUsd: merged.onSaleOtherUsd,
    onSaleSource: lztOnSale ? "lzt" : "db",
    sold,
    heldUsd,
    frozenBalancesUsd,
    workerShareUsd: workerShareReleasedUsd,
    workerShareTotalUsd: workerShareUsd,
    workerShareOnHoldUsd: workerShareOnHoldUsd ?? heldUsd,
    workerShareReleasedUsd: workerShareReleasedUsd ?? releasedUsd,
    teamShareUsd: teamNet.teamShareUsd,
    teamShareGrossUsd: teamNet.teamShareGrossUsd,
    teamShareDebitedUsd: teamNet.teamShareDebitedUsd,
    teamShareReleasedUsd: teamShareReleasedUsd ?? teamShareUsd,
    teamShareOnHoldUsd,
    releasedUsd,
    releasedGrossUsd,
    heldGrossUsd,
    grossSoldUsd,
    missingCreditCount,
    activeGuaranteeCount,
    activeGuaranteeGrossUsd,
    activeGuaranteeWorkerShareUsd,
    activeGuaranteeTeamShareUsd,
    activeGuarantee12hCount,
    activeGuarantee12hGrossUsd,
    activeGuarantee12hWorkerShareUsd,
    activeGuarantee12hTeamShareUsd,
    period: periodCtx.key,
    periodLabel: periodCtx.label,
    periodSince: periodCtx.since.toISOString(),
    periodUntil: periodCtx.until.toISOString(),
    periodSoldCount: periodStats.soldCount,
    periodReleasedCount: periodStats.releasedCount,
    periodFailedCount: periodStats.failedCount,
    periodRefundedCount: periodStats.refundedCount,
    periodGrossSoldUsd: periodStats.soldMoney.grossSoldUsd,
    periodReleasedGrossUsd: periodStats.releasedMoney.releasedGrossUsd,
    periodWorkerShareReleasedUsd: periodStats.releasedMoney.workerShareReleasedUsd,
    periodTeamShareGrossUsd: periodTeamNet.teamShareGrossUsd,
    periodTeamShareDebitedUsd: periodTeamNet.teamShareDebitedUsd,
    periodTeamShareUsd: periodTeamNet.teamShareUsd,
  };
}

module.exports = {
  bindTelegram,
  shouldEnqueueAutoSell,
  maybeEnqueueAutoSell,
  enqueueAutoSell,
  progressListing,
  pollLztStatus,
  creditSoldHeld,
  releaseHold,
  clawbackAutoSaleHold,
  shouldClawbackForLztPhase,
  isLegacyFullGrossHold,
  hasAutoSaleProfitTx,
  shouldFreezeOnCredit,
  accumulateAutoSaleMoney,
  tickAutoLogSales,
  recoverFailedAutoSales,
  startAutoLogSaleMonitor,
  extractLztItemId,
  extractLztItemIdFromTask,
  extractTaskId,
  lztMarketUrl,
  isTaskInProgress,
  listAutoSaleLogs,
  getAutoSaleStats,
  getFreshLztOnSaleStats,
  refreshActiveGuaranteeHolds,
  adminAutoSaleAction,
  describeAutoSaleActions,
  mergeOnSaleStats,
  shouldPollLztStatus,
  sumAutosaleWorkerShareByOwner,
  autoSaleStatusLabel,
  AUTO_SALE_STATUS_LABELS,
  syncExistingAutoSalesFromUproject,
  backfillAutoSaleActivityNotifyFlags,
  mapUprojectStatusToAutoSale,
  shortHoldDurationPhrase,
  resolveAutoSaleStatsPeriod,
  autoSaleHoldSoldNote,
  AUTO_SALE_HOLD_RELEASED_NOTE,
  DEFAULT_HOLD_DURATION_SHORT,
};
