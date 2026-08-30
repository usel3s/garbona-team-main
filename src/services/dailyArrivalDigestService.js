const { env } = require("../config/env");
const { pe, telegramHtmlCaption } = require("../utils/emoji");
const { logger } = require("../utils/logger");
const AppSettings = require("../models/AppSettings");
const {
  getTeamArrivalForMoscowDay,
  summarizeArrivals,
  moscowDayKey,
  formatMoscowDayLabel,
  moscowDayRange,
} = require("./adminOverviewService");

const LAST_SENT_KEY = "dailyArrivalDigestLastDay";
let digestTimer = null;

function digestTelegramId() {
  return String(env.dailyArrivalDigestTelegramId || "").trim();
}

function formatUsd(usd) {
  const n = Number(usd) || 0;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function buildComparisonLine(todayInv, yesterdayInv) {
  const diff = Number(todayInv || 0) - Number(yesterdayInv || 0);
  const pct = yesterdayInv > 0
    ? Math.round((diff / yesterdayInv) * 100)
    : (todayInv > 0 ? 100 : 0);

  if (Math.abs(diff) < 1) {
    return `${pe("info")} Примерно как вчера по инвентарю`;
  }
  if (diff > 0) {
    return `${pe("analytics")} На <b>${formatUsd(diff)}</b> больше, чем вчера <b>(+${pct}%)</b>`;
  }
  return `${pe("statistics")} На <b>${formatUsd(Math.abs(diff))}</b> меньше, чем вчера <b>(${pct}%)</b>`;
}

function buildDailyArrivalDigestHtml({ today, yesterday, dayLabel }) {
  const lines = [
    `${pe("calendar")} <b>Итоги дня · ${dayLabel}</b>`,
    "",
    `${pe("package")} За сегодня команда занесла:`,
    `• <b>${today.count}</b> ID · ${summarizeArrivals(today)}`,
    `• Инвентарь: <b>${formatUsd(today.inventoryUsd)}</b>`,
  ];

  if (Number(today.balanceUsd) > 0) {
    lines.push(`• Баланс Steam: <b>${formatUsd(today.balanceUsd)}</b>`);
  }

  lines.push(
    "",
    buildComparisonLine(today.inventoryUsd, yesterday.inventoryUsd)
  );

  if (Number(yesterday.count) > 0) {
    lines.push(
      `${pe("time")} Вчера: <b>${formatUsd(yesterday.inventoryUsd)}</b> инвентаря · ${yesterday.count} ID`
    );
  }

  return lines.join("\n");
}

async function getLastSentDayKey() {
  const row = await AppSettings.findOne({ key: LAST_SENT_KEY }).lean();
  return row?.valueString ? String(row.valueString) : "";
}

async function setLastSentDayKey(dayKey) {
  await AppSettings.findOneAndUpdate(
    { key: LAST_SENT_KEY },
    { valueString: String(dayKey) },
    { upsert: true, new: true }
  );
}

async function loadDailyArrivalDigestStats(dayOffset = 0) {
  const [today, yesterday] = await Promise.all([
    getTeamArrivalForMoscowDay(dayOffset),
    getTeamArrivalForMoscowDay(dayOffset - 1),
  ]);
  const { start } = moscowDayRange(dayOffset);
  return {
    today,
    yesterday,
    dayLabel: formatMoscowDayLabel(dayOffset),
    dayKey: moscowDayKey(start),
  };
}

async function sendDailyArrivalDigest(telegram, { force = false, dayOffset = 0 } = {}) {
  const chatId = digestTelegramId();
  if (!chatId) {
    throw new Error("DAILY_ARRIVAL_DIGEST_TELEGRAM_ID is not configured");
  }
  if (!telegram?.sendMessage) {
    throw new Error("Telegram API is not available");
  }

  const stats = await loadDailyArrivalDigestStats(dayOffset);
  if (!force) {
    const lastSent = await getLastSentDayKey();
    if (lastSent === stats.dayKey) {
      return { skipped: true, reason: "already_sent_today", dayKey: stats.dayKey };
    }
  }

  const html = buildDailyArrivalDigestHtml(stats);
  const entityMessage = telegramHtmlCaption(html);
  const sent = await telegram.sendMessage(chatId, entityMessage.caption, {
    entities: entityMessage.caption_entities,
    disable_web_page_preview: true,
  });

  if (!force) {
    await setLastSentDayKey(stats.dayKey);
  }

  return {
    skipped: false,
    chatId,
    messageId: sent?.message_id,
    dayKey: stats.dayKey,
    today: stats.today,
    yesterday: stats.yesterday,
    html,
  };
}

function msUntilNextDigestRun() {
  const hour = Math.min(23, Math.max(0, Number(env.dailyArrivalDigestHourMsk) || 23));
  const minute = Math.min(59, Math.max(0, Number(env.dailyArrivalDigestMinuteMsk) || 59));
  const now = new Date();
  const todayKey = moscowDayKey(now);
  let target = new Date(
    `${todayKey}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+03:00`
  );
  if (target <= now) {
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowKey = moscowDayKey(tomorrow);
    target = new Date(
      `${tomorrowKey}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+03:00`
    );
  }
  return Math.max(1000, target.getTime() - now.getTime());
}

function scheduleDailyArrivalDigest(bot) {
  if (digestTimer) {
    clearTimeout(digestTimer);
    digestTimer = null;
  }
  if (!digestTelegramId()) {
    logger.warn("Daily arrival digest disabled: DAILY_ARRIVAL_DIGEST_TELEGRAM_ID is empty");
    return;
  }

  const run = async () => {
    try {
      const result = await sendDailyArrivalDigest(bot.telegram);
      if (!result.skipped) {
        logger.info(
          "Daily arrival digest sent",
          result.chatId,
          result.dayKey,
          `${result.today.count} ID · $${result.today.inventoryUsd} inv`
        );
      }
    } catch (error) {
      logger.warn("Daily arrival digest failed", error?.response?.description || error.message);
    } finally {
      digestTimer = setTimeout(run, msUntilNextDigestRun());
    }
  };

  digestTimer = setTimeout(run, msUntilNextDigestRun());
  logger.info(
    "Daily arrival digest scheduler started",
    digestTelegramId(),
    `${env.dailyArrivalDigestHourMsk}:${String(env.dailyArrivalDigestMinuteMsk).padStart(2, "0")} MSK`
  );
}

module.exports = {
  buildDailyArrivalDigestHtml,
  loadDailyArrivalDigestStats,
  sendDailyArrivalDigest,
  scheduleDailyArrivalDigest,
};
