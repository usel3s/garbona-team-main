const { topWorkersKeyboard, publicProfileKeyboard } = require("../keyboards/common");
const { getUserByTelegramId, ensureUser, isAdminTelegramId } = require("../services/userService");
const { getCurrencyContext } = require("../services/currencyService");
const {
  getTopWorkers,
  buildTopWorkersHtml,
  buildPublicProfileCaption,
  getPublicProfileImageData,
} = require("../services/topService");
const { renderProfileImage } = require("../utils/profileImageRenderer");
const { upsertBotMessage, upsertBotPhoto } = require("../utils/message");
const { upsertMenuSection } = require("../utils/menuBanner");
const { canViewOtherProfile, sendAccessDenied } = require("../services/profileAccessService");
const { logger } = require("../utils/logger");
const { pe } = require("../utils/emoji");

const TOP_DELETE_AFTER_MS = 10_000;

function botUsernameOf(ctx) {
  return String(ctx.botInfo?.username || "").replace(/^@/, "");
}

async function safeDeleteMessage(telegram, chatId, messageId) {
  if (!chatId || !messageId) return;
  try {
    await telegram.deleteMessage(chatId, messageId);
  } catch (_) {
    /* уже удалено / нет прав */
  }
}

function scheduleTopCleanup(telegram, chatId, messageIds) {
  const ids = [...new Set(messageIds.filter(Boolean).map(Number))];
  setTimeout(() => {
    for (const id of ids) {
      safeDeleteMessage(telegram, chatId, id);
    }
  }, TOP_DELETE_AFTER_MS);
}

async function buildTopHtml(ctx, period = "all") {
  const currencyCtx = await getCurrencyContext();
  const rows = await getTopWorkers(period, 10);
  return buildTopWorkersHtml(rows, period, currencyCtx, botUsernameOf(ctx));
}

/** Топ в меню бота (с кнопками периодов). */
async function renderTopWorkers(ctx, period = "all", options = {}) {
  const html = await buildTopHtml(ctx, period);
  const back = options.back || "menu:home";
  const periodPrefix = options.periodPrefix || "top:period";

  await upsertMenuSection(ctx, "top_workers", {
    caption: html,
    parse_mode: "HTML",
    reply_markup: topWorkersKeyboard(period, { back, periodPrefix }).reply_markup,
    link_preview_options: { is_disabled: true },
    disable_web_page_preview: true,
  });
}

async function canUseTopCommands(ctx) {
  const user = await ensureUser(ctx.from);
  return (
    isAdminTelegramId(ctx.from.id) ||
    user.role === "admin" ||
    user.isTeamMember
  );
}

/** Топ по команде в чате (/top, /topd, …) — без клавиатуры меню. */
async function replyTopCommand(ctx, period = "all") {
  if (!(await canUseTopCommands(ctx))) {
    await ctx.reply(`${pe("error")} Команда доступна участникам команды.`, {
      parse_mode: "HTML",
    });
    return;
  }

  const html = await buildTopHtml(ctx, period);
  const commandMessageId = ctx.message?.message_id;
  const chatId = ctx.chat?.id;

  const sent = await ctx.reply(html, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    disable_web_page_preview: true,
  });

  scheduleTopCleanup(ctx.telegram, chatId, [commandMessageId, sent?.message_id]);
}

async function renderPublicProfile(ctx, telegramId, period = "all", options = {}) {
  const tid = String(telegramId || "").trim();
  const back = options.back || "menu:top_workers";

  if (ctx.session) {
    ctx.session.ui = { ...(ctx.session.ui || {}), publicProfileBack: back };
  }

  const gate = await canViewOtherProfile(ctx.from, tid);
  if (!gate.ok) {
    await sendAccessDenied(ctx, gate, {
      reply_markup: publicProfileKeyboard(tid || "0", period, { back, hidden: true }).reply_markup,
    });
    return;
  }

  const user = tid ? await getUserByTelegramId(tid) : null;

  if (!user) {
    await upsertBotMessage(
      ctx,
      `${pe("error")} Пользователь не найден.`,
      { reply_markup: publicProfileKeyboard(tid || "0", period, { back, hidden: true }).reply_markup }
    );
    return;
  }

  const currencyCtx = await getCurrencyContext();
  const caption = await buildPublicProfileCaption(user, period, currencyCtx);
  const keyboard = {
    reply_markup: publicProfileKeyboard(user.telegramId, period, {
      back,
      hidden: Boolean(user.isAnonymous),
    }).reply_markup,
  };

  if (user.isAnonymous) {
    await upsertBotMessage(ctx, caption, keyboard);
    return;
  }

  try {
    const imageData = await getPublicProfileImageData(user);
    const imageBuffer = await renderProfileImage(imageData);
    await upsertBotPhoto(ctx, { source: imageBuffer, filename: "profile.png" }, {
      caption,
      parse_mode: "HTML",
      ...keyboard,
    });
  } catch (error) {
    logger.warn("public profile image render failed", error.message);
    await upsertBotMessage(ctx, caption, keyboard);
  }
}

function registerTopCommands(bot) {
  bot.command("top", async (ctx) => {
    await replyTopCommand(ctx, "all");
  });
  bot.command("topd", async (ctx) => {
    await replyTopCommand(ctx, "24h");
  });
  bot.command("topn", async (ctx) => {
    await replyTopCommand(ctx, "7d");
  });
  bot.command("topm", async (ctx) => {
    await replyTopCommand(ctx, "30d");
  });
}

module.exports = {
  renderTopWorkers,
  renderPublicProfile,
  replyTopCommand,
  registerTopCommands,
};
