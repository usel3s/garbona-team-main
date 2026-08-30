const { Markup } = require("telegraf");
const { env } = require("../config/env");
const { logger } = require("../utils/logger");
const { changelogsUrl } = require("./launchAnnounceService");

function changelogsChatId() {
  return env.changelogsChatId || "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Сырой текст changelog (без HTML) — для monospace / <pre>. */
function buildChangelogPlainText() {
  return [
    "Garbona | ChangeLog",
    "## [1.0.0] - 2026-08-02",
    "",
    "### Added",
    "Bot:",
    "- Полное управление участника в ЛС с ботом (главное меню)",
    "- Заявки в команду + правила проекта",
    "- Профиль: статистика all / 24h / 7d / 30d",
    "- Кошелёк: баланс, история (inline), вывод USDT/TON",
    "- Сайты: домены, ссылки, шаблоны, параметры",
    "- Реферальные ссылки воркера на доменах команды",
    "- Фидбек: баг / вопрос / идея (/feedback + deep link)",
    "- История обращений в inline + красивая карточка",
    "- Ответ и закрытие фидбека админом из уведомления",
    "- Кастомный ID участника (до 12 символов)",
    "- Кураторы и прозвонщицы: карточки и привязка",
    "- Топ воркеров + публичные профили",
    "- О проекте: документация / чаты / инфоканал",
    "- Postbot: создание и отправка постов",
    "- Рассылка участникам команды",
    "- Служебный тред со ссылкой на документацию",
    "- Анонс бота: альбом 3x3 + кнопки в info-канал",
    "- Модерация: ban / mute / warn / kick",
    "",
    "Steam:",
    "- Мониторинг логов Steam (валид / mafile)",
    "- DM-карточки логов + заявка на продажу",
    "- Профиты в канал с рендером картинки",
    "- Админ-просмотр логов (inline) и recheck по ID",
    "- Фейк-профит / фейк-лог для тестов",
    "",
    "Admin panel:",
    "- Telegram Login для админов",
    "- Участники: роли, %, кошелёк, бан, панель-аккаунт",
    "- Коммуникация: рассылка, документация, анонс, changelog",
    "- Заявки, выплаты, экономика, Steam-логи, логи бота",
    "- Раздел Сайты для админа",
    "",
    "Worker panel (/app):",
    "- Панель воркера: дашборд, сайты, аналитика, топ, кошелёк, настройки",
    "",
    "Stability:",
    "- Кэш токенов и ответов панели uproject",
    "- Circuit breaker на 502/503",
    "- Опрос Steam через team API key",
    "",
    "### Changed",
    "- Опрос Steam: меньше нагрузка, тише логи при 503",
    "- Кэш сайтов/панели при повторных заходах",
    "- Фидбек: Ответить / Закрыть ведут в ЛС бота",
    "",
    "### Fixed",
    "- Флуд warn при недоступности uproject",
    "- Стабилизация auth панели сайтов (token + ownerId)",
    "",
    "Баги / идеи — /feedback в боте",
  ].join("\n");
}

function buildChangelogHtml() {
  return `<pre>${escapeHtml(buildChangelogPlainText())}</pre>`;
}

function buildChangelogKeyboard() {
  const url = changelogsUrl();
  const rows = [];
  if (url) {
    rows.push([Markup.button.url("Канал changelogs", url)]);
  }
  return Markup.inlineKeyboard(rows);
}

/**
 * Публикует changelog в канал.
 * Важно: parse_mode HTML + <pre>, иначе теги видны как текст.
 */
async function publishChangelog(telegram, options = {}) {
  const chatId = String(options.chatId || changelogsChatId() || "").trim();
  if (!chatId) {
    throw new Error(
      "Не задан CHANGELOGS_CHAT_ID (числовой id канала, не invite-ссылка)."
    );
  }

  const html = buildChangelogHtml();
  if (Buffer.byteLength(html, "utf8") > 4096) {
    throw new Error("Changelog слишком длинный для одного сообщения Telegram.");
  }

  const sent = await telegram.sendMessage(chatId, html, {
    parse_mode: "HTML",
    disable_web_page_preview: true,
    disable_notification: Boolean(options.silent),
  });

  let pinned = false;
  try {
    await telegram.pinChatMessage(chatId, sent.message_id, {
      disable_notification: true,
    });
    pinned = true;
  } catch (error) {
    logger.warn("changelog pin skipped", error?.response?.description || error.message);
  }

  return {
    chatId,
    messageId: sent.message_id,
    pinned,
    url: changelogsUrl(),
  };
}

module.exports = {
  changelogsChatId,
  buildChangelogPlainText,
  buildChangelogHtml,
  buildChangelogKeyboard,
  publishChangelog,
  escapeHtml,
};
