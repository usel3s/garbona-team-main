const fs = require("fs");
const path = require("path");
const { Markup } = require("telegraf");
const { env } = require("../config/env");
const { pe } = require("../utils/emoji");
const { logger } = require("../utils/logger");
const { docsSiteUrl } = require("../utils/panelLinks");

const POSTS_DIR = path.join(__dirname, "../../assets/posts");

/**
 * Порядок сетки 3×3 (слева направо, сверху вниз).
 * Figma: Mask group.png, Mask group-1.png … Mask group-8.png
 */
const LAUNCH_TILE_NAMES = [
  "Mask group.png",
  "Mask group-1.png",
  "Mask group-2.png",
  "Mask group-3.png",
  "Mask group-4.png",
  "Mask group-5.png",
  "Mask group-6.png",
  "Mask group-7.png",
  "Mask group-8.png",
];

function launchAnnounceChatId() {
  return (
    env.launchAnnounceChatId ||
    env.aboutInfoChatId ||
    "-1003600501278"
  );
}

function botDeepLink(payload = "") {
  const username = String(env.botUsername || "").replace(/^@/, "");
  if (!username) return "";
  const start = payload ? `?start=${encodeURIComponent(payload)}` : "";
  return `https://t.me/${username}${start}`;
}

function manualsDocsUrl() {
  return docsSiteUrl();
}

function changelogsUrl() {
  return env.changelogsUrl || "https://t.me/+-wlbGOWzsWo1YmIy";
}

function resolveLaunchTilePaths() {
  const paths = LAUNCH_TILE_NAMES.map((name) => path.join(POSTS_DIR, name));
  const missing = paths.filter((p) => !fs.existsSync(p));
  if (missing.length) {
    throw new Error(
      `Не хватает тайлов обложки (${missing.length}): ${missing.map((p) => path.basename(p)).join(", ")}`
    );
  }
  return paths;
}

function buildLaunchAnnounceHtml() {
  return [
    `${pe("celebrate")} <b>Garbona | Info</b>`,
    "",
    `${pe("broadcast")} <b>Первый анонс</b>`,
    "",
    "Запускаем <b>бота команды</b> — единую точку входа для участника.",
    "Всё управление в <b>личных сообщениях</b> с ботом: без лишних вкладок и хаоса.",
    "",
    `${pe("notification")} <b>Что уже внутри</b>`,
    "",
    `${pe("edit")} <b>Фидбек</b>`,
    "Баг, вопрос или идея — прямо в боте.",
    "Обращения в inline, ответы от команды в ЛС.",
    "",
    `${pe("file")} <b>Мануалы</b>`,
    "Все руководства доступны только на сайте документации.",
    "",
    `${pe("link")} <b>Сайты и ссылки</b>`,
    "Рабочие инструменты — из меню бота.",
    "",
    `${pe("profile")} <b>Профиль и кошелёк</b>`,
    "Статистика, баланс, вывод и история — в пару тапов.",
    "",
    `${pe("tag")} <b>Свой ID участника</b>`,
    "Короткий кастомный ID для поддержки и навигации.",
    "",
    `${pe("success")} <b>И ещё</b>`,
    "• понятное главное меню",
    "• роли и структура команды",
    "• прозрачные процессы от входа до работы",
    "",
    `${pe("calendar")} Старт — <b>сейчас</b>.`,
    "Это рабочий контур команды.",
    "",
    `${pe("gift")} Garbona. Пиши боту — и в работу.`,
  ].join("\n");
}

function buildLaunchAnnounceKeyboard() {
  const botUrl = botDeepLink();
  const feedbackUrl = botDeepLink("feedback");
  const docsUrl = manualsDocsUrl();
  const logsUrl = changelogsUrl();
  const rows = [];

  if (botUrl) {
    rows.push([Markup.button.url("Открыть бота", botUrl)]);
  }
  const mid = [];
  if (feedbackUrl) mid.push(Markup.button.url("Фидбек", feedbackUrl));
  if (logsUrl) mid.push(Markup.button.url("Changelogs", logsUrl));
  if (mid.length) rows.push(mid);
  if (docsUrl) {
    rows.push([Markup.button.url("Мануалы", docsUrl)]);
  }

  return Markup.inlineKeyboard(rows);
}

async function publishLaunchAnnounce(telegram, options = {}) {
  const chatId = String(options.chatId || launchAnnounceChatId());
  const tilePaths = resolveLaunchTilePaths();

  if (!env.botUsername) {
    try {
      const me = await telegram.getMe();
      if (me?.username) env.botUsername = me.username;
    } catch (_) {
      /* ignore */
    }
  }

  const html = buildLaunchAnnounceHtml();
  const keyboard = buildLaunchAnnounceKeyboard();
  const silent = Boolean(options.silent);

  // Альбом 3×3. Caption/кнопки на media group нельзя нормально повесить —
  // текст + кнопки отдельным сообщением сразу после альбома.
  const media = tilePaths.map((filePath) => ({
    type: "photo",
    media: { source: fs.createReadStream(filePath) },
  }));

  const album = await telegram.sendMediaGroup(chatId, media, {
    disable_notification: silent,
  });

  const textMsg = await telegram.sendMessage(chatId, html, {
    parse_mode: "HTML",
    disable_web_page_preview: true,
    disable_notification: silent,
    reply_markup: keyboard.reply_markup,
  });

  const photoMessageIds = (album || []).map((m) => m.message_id);
  const messageId = textMsg.message_id;

  let pinned = false;
  try {
    await telegram.pinChatMessage(chatId, messageId, { disable_notification: true });
    pinned = true;
  } catch (error) {
    logger.warn("launch announce pin skipped", error?.response?.description || error.message);
  }

  return {
    chatId,
    messageId,
    photoMessageIds,
    tiles: tilePaths.length,
    mode: "album9",
    pinned,
    botUrl: botDeepLink(),
    feedbackUrl: botDeepLink("feedback"),
    docsUrl: manualsDocsUrl(),
    changelogsUrl: changelogsUrl(),
  };
}

module.exports = {
  launchAnnounceChatId,
  POSTS_DIR,
  LAUNCH_TILE_NAMES,
  resolveLaunchTilePaths,
  buildLaunchAnnounceHtml,
  buildLaunchAnnounceKeyboard,
  publishLaunchAnnounce,
  changelogsUrl,
};
