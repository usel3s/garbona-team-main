const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { Markup } = require("telegraf");
const { env } = require("../config/env");
const { pe } = require("../utils/emoji");
const { logger } = require("../utils/logger");
const { docsSiteUrl } = require("../utils/panelLinks");
const AppSettings = require("../models/AppSettings");
const ProfitTransaction = require("../models/ProfitTransaction");
const User = require("../models/User");
const { getCurrencyContext, formatDisplayAmount } = require("./currencyService");
const { isServiceUnavailable, serviceUnavailableMsLeft } = require("./apiService");
const { listCurators, listCallers } = require("./userService");
const { profitStatsFilter } = require("./profitService");

const PIN_CHAT_KEY = "dynamicPinChatId";
const PIN_MESSAGE_KEY = "dynamicPinMessageId";
const PIN_IMAGE_PATH = path.join(__dirname, "../../assets/brand/dynamic-pin.png");

let refreshTimer = null;

function dynamicPinChatId() {
  return (
    env.dynamicPinChatId ||
    env.aboutWorkersChatId ||
    ""
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function staffLink(user) {
  const username = String(user?.username || "").trim();
  const name = username
    ? `@${username}`
    : user?.firstName || `ID ${user?.telegramId || "—"}`;
  if (username) {
    return `<a href="https://t.me/${encodeURIComponent(username)}">${escapeHtml(name)}</a>`;
  }
  return `<a href="tg://user?id=${escapeHtml(user.telegramId)}">${escapeHtml(name)}</a>`;
}

function startOfTodayMoscow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return new Date(`${map.year}-${map.month}-${map.day}T00:00:00+03:00`);
}

async function getSettingString(key) {
  const row = await AppSettings.findOne({ key });
  return row?.valueString ? String(row.valueString) : "";
}

async function setSettingString(key, value) {
  await AppSettings.findOneAndUpdate(
    { key },
    { valueString: String(value) },
    { upsert: true, new: true }
  );
}

async function getTodayProfitStats() {
  const from = startOfTodayMoscow();
  const [row] = await ProfitTransaction.aggregate([
    { $match: profitStatsFilter({ createdAt: { $gte: from } }) },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        totalAmount: { $sum: "$amount" },
        totalShare: { $sum: "$workerShare" },
      },
    },
  ]);
  return {
    count: Number(row?.count || 0),
    totalAmount: Number(row?.totalAmount || 0),
    totalShare: Number(row?.totalShare || 0),
  };
}

async function checkPanelApiStatus() {
  if (isServiceUnavailable()) {
    const sec = Math.ceil(serviceUnavailableMsLeft() / 1000);
    return {
      ok: false,
      label: "Пауза",
      detail: `circuit ${sec}s`,
    };
  }

  const started = Date.now();
  try {
    await axios.get(`${env.uprojectApiBase}/steam/info`, {
      timeout: 8000,
      headers: { "x-api-key": env.uprojectApiKey },
      validateStatus: (s) => s >= 200 && s < 500,
    });
    const ms = Date.now() - started;
    return { ok: true, label: "Онлайн", detail: `${ms}ms` };
  } catch (error) {
    const status = error?.response?.status;
    return {
      ok: false,
      label: "Оффлайн",
      detail: status ? `HTTP ${status}` : error.code || error.message || "error",
    };
  }
}

async function collectStaff() {
  const adminIds = env.adminIds || [];
  const admins = [];
  for (const id of adminIds.slice(0, 8)) {
    const user = await User.findOne({ telegramId: String(id) });
    if (user) admins.push(user);
    else admins.push({ telegramId: String(id), username: "", firstName: "Admin" });
  }

  const [curators, callers] = await Promise.all([listCurators(), listCallers()]);
  return {
    admins,
    curators: curators.slice(0, 10),
    callers: callers.slice(0, 10),
  };
}

function formatStaffInline(users) {
  if (!users.length) return "—";
  return users.map((u) => staffLink(u)).join(" · ");
}

async function buildDynamicPinHtml() {
  const [currencyCtx, profits, api, staff] = await Promise.all([
    getCurrencyContext(),
    getTodayProfitStats(),
    checkPanelApiStatus(),
    collectStaff(),
  ]);

  const updatedAt = new Date().toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const apiIcon = api.ok ? "success" : "error";
  return [
    `${pe("home")} <b>Garbona · Live Pin</b>`,
    `${pe("time")} ${escapeHtml(updatedAt)} МСК`,
    "",
    `${pe("code")} <b>Админы:</b> ${formatStaffInline(staff.admins)}`,
    `${pe("users")} <b>Кураторы:</b> ${formatStaffInline(staff.curators)}`,
    `${pe("broadcast")} <b>Прозвон:</b> ${formatStaffInline(staff.callers)}`,
    "",
    `${pe("coins")} <b>Профиты сегодня:</b> ${profits.count} шт · ${escapeHtml(formatDisplayAmount(profits.totalAmount, currencyCtx))}`,
    `${pe("analytics")} <b>Курс:</b> $1 = <b>${Number(currencyCtx.rate).toFixed(2)}₽</b>`,
    `${pe(apiIcon)} <b>API:</b> ${escapeHtml(api.label)} · <code>${escapeHtml(api.detail)}</code>`,
    "",
    `${pe("info")} Бот: /start · Фидбек: /feedback · документация на сайте`,
    `${pe("gift")} Garbona — работай системно.`,
  ].join("\n");
}

function manualsUrl() {
  return docsSiteUrl();
}

function botUrl(payload = "") {
  const username = String(env.botUsername || "").replace(/^@/, "");
  if (!username) return "";
  return payload
    ? `https://t.me/${username}?start=${encodeURIComponent(payload)}`
    : `https://t.me/${username}`;
}

function buildDynamicPinKeyboard() {
  const rows = [];
  const bot = botUrl();
  const feedback = botUrl("feedback");
  const manuals = manualsUrl();
  const info = env.aboutInfoChannelUrl || "";
  const changelogs = env.changelogsUrl || "";

  if (bot) rows.push([Markup.button.url("Открыть бота", bot)]);
  const mid = [];
  if (feedback) mid.push(Markup.button.url("Фидбек", feedback));
  if (manuals) mid.push(Markup.button.url("Мануалы", manuals));
  if (mid.length) rows.push(mid);
  const mid2 = [];
  if (info) mid2.push(Markup.button.url("Info", info));
  if (changelogs) mid2.push(Markup.button.url("Changelogs", changelogs));
  if (mid2.length) rows.push(mid2);
  return Markup.inlineKeyboard(rows);
}

async function resolvePinTargets(options = {}) {
  const chatId = String(options.chatId || (await getSettingString(PIN_CHAT_KEY)) || dynamicPinChatId());
  const messageIdRaw = options.messageId || (await getSettingString(PIN_MESSAGE_KEY));
  const messageId = messageIdRaw ? Number(messageIdRaw) : null;
  return { chatId, messageId: Number.isFinite(messageId) ? messageId : null };
}

async function publishOrRefreshDynamicPin(telegram, options = {}) {
  const { chatId, messageId } = await resolvePinTargets(options);
  if (!chatId) {
    throw new Error("Не задан DYNAMIC_PIN_CHAT_ID / ABOUT_WORKERS_CHAT_ID");
  }

  if (!env.botUsername) {
    try {
      const me = await telegram.getMe();
      if (me?.username) env.botUsername = me.username;
    } catch (_) {
      /* ignore */
    }
  }

  let html = await buildDynamicPinHtml();
  const keyboard = buildDynamicPinKeyboard();
  html = fitCaptionHtml(html, 1024);

  const hasImage = fs.existsSync(PIN_IMAGE_PATH);
  let sentMessageId = messageId;
  let refreshed = false;

  if (messageId) {
    try {
      if (hasImage) {
        await telegram.editMessageCaption(chatId, messageId, undefined, html, {
          parse_mode: "HTML",
          reply_markup: keyboard.reply_markup,
        });
      } else {
        await telegram.editMessageText(chatId, messageId, undefined, html, {
          parse_mode: "HTML",
          disable_web_page_preview: true,
          reply_markup: keyboard.reply_markup,
        });
      }
      refreshed = true;
    } catch (error) {
      const desc = String(error?.response?.description || error.message || "");
      if (/message is not modified/i.test(desc)) {
        refreshed = true;
      } else {
        logger.warn("dynamic pin edit failed, recreating", desc);
        sentMessageId = null;
      }
    }
  }

  if (!sentMessageId) {
    let sent;
    if (hasImage) {
      sent = await telegram.sendPhoto(
        chatId,
        { source: fs.createReadStream(PIN_IMAGE_PATH) },
        {
          caption: html,
          parse_mode: "HTML",
          reply_markup: keyboard.reply_markup,
        }
      );
    } else {
      sent = await telegram.sendMessage(chatId, html, {
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: keyboard.reply_markup,
      });
    }
    sentMessageId = sent.message_id;
    try {
      await telegram.pinChatMessage(chatId, sentMessageId, { disable_notification: true });
    } catch (error) {
      logger.warn("dynamic pin pin skipped", error?.response?.description || error.message);
    }
  }

  await setSettingString(PIN_CHAT_KEY, chatId);
  await setSettingString(PIN_MESSAGE_KEY, String(sentMessageId));

  return { chatId, messageId: sentMessageId, refreshed };
}

function fitCaptionHtml(html, maxBytes = 1024) {
  if (Buffer.byteLength(html, "utf8") <= maxBytes) return html;
  const lines = String(html).split("\n");
  const out = [];
  for (const line of lines) {
    const candidate = [...out, line, "…"].join("\n");
    if (Buffer.byteLength(candidate, "utf8") > maxBytes) break;
    out.push(line);
  }
  return `${out.join("\n")}\n…`;
}

function startDynamicPinScheduler(bot, intervalMs) {
  const ms = Math.max(60_000, Number(intervalMs || env.dynamicPinIntervalMs || 5 * 60_000));
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    publishOrRefreshDynamicPin(bot.telegram).catch((error) => {
      logger.warn("dynamic pin refresh failed", error?.response?.description || error.message);
    });
  }, ms);
  // First refresh shortly after boot (don't block startup).
  setTimeout(() => {
    publishOrRefreshDynamicPin(bot.telegram).catch((error) => {
      logger.warn("dynamic pin initial refresh failed", error?.response?.description || error.message);
    });
  }, 15_000);
  logger.info("Dynamic pin scheduler started", `${Math.round(ms / 1000)}s`);
}

module.exports = {
  PIN_IMAGE_PATH,
  dynamicPinChatId,
  buildDynamicPinHtml,
  buildDynamicPinKeyboard,
  publishOrRefreshDynamicPin,
  startDynamicPinScheduler,
  getTodayProfitStats,
  checkPanelApiStatus,
};
