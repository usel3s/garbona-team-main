const { ensureUser, isAdminTelegramId } = require("../services/userService");
const { upsertBotMessage } = require("../utils/message");
const { pe } = require("../utils/emoji");
const { clearPendingInputs } = require("../utils/session");
const { env } = require("../config/env");
const {
  feedbackMenuKeyboard,
  feedbackTypeKeyboard,
  feedbackCancelKeyboard,
  feedbackResultKeyboard,
  feedbackAdminReplyCancelKeyboard,
} = require("../keyboards/feedback");
const {
  createFeedback,
  notifyAdminsAboutFeedback,
  getFeedbackById,
  replyToFeedback,
  closeFeedback,
  typeLabel,
  typeEmojiKey,
  statusLabel,
  escapeHtml,
} = require("../services/feedbackService");

function isPrivateChat(ctx) {
  return ctx.chat?.type === "private";
}

function feedbackDeepLink() {
  const username = String(env.botUsername || "").replace(/^@/, "");
  return username ? `https://t.me/${username}?start=feedback` : "";
}

async function rejectIfNotPrivate(ctx) {
  if (isPrivateChat(ctx)) return false;
  const link = feedbackDeepLink();
  const text = [
    `${pe("lock")} Фидбек доступен только в личных сообщениях с ботом.`,
    link ? `\nОткройте: ${link}` : "",
  ].join("");
  if (ctx.callbackQuery) {
    try {
      await ctx.answerCbQuery("Только в ЛС с ботом", { show_alert: true });
    } catch (_) {
      /* ignore */
    }
    return true;
  }
  await ctx.reply(text, { parse_mode: "HTML", disable_web_page_preview: true });
  return true;
}

async function renderFeedbackMenu(ctx) {
  if (await rejectIfNotPrivate(ctx)) return;

  const user = await ensureUser(ctx.from);
  if (user.isBanned) {
    await upsertBotMessage(
      ctx,
      `${pe("userBlocked")} Ты заблокирован. Фидбек недоступен.`
    );
    return;
  }

  clearPendingInputs(ctx);
  if (ctx.session) ctx.session.feedbackDraft = null;

  const link = feedbackDeepLink();
  await upsertBotMessage(
    ctx,
    [
      `${pe("notification")} <b>Фидбек</b>`,
      "",
      "Здесь можно сообщить о баге, задать вопрос или предложить идею.",
      "",
      link ? `\n${pe("link")} Быстрый доступ: <code>${link}</code>` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    { reply_markup: feedbackMenuKeyboard().reply_markup }
  );
}

function ticketSummaryHtml(ticket) {
  const nick = ticket.username ? `@${ticket.username}` : "без username";
  return [
    `${pe(typeEmojiKey(ticket.type))} <b>${escapeHtml(typeLabel(ticket.type))}</b>`,
    `${pe("tag")} ID: <code>${ticket._id}</code>`,
    `${pe("profile")} ${escapeHtml(nick)} · <code>${escapeHtml(ticket.telegramId)}</code>`,
    `${pe("visible")} Статус: <b>${escapeHtml(statusLabel(ticket.status))}</b>`,
    "",
    escapeHtml(ticket.text),
  ].join("\n");
}

async function startFeedbackAdminReply(ctx, ticketId) {
  if (!(await ensureAdminPrivate(ctx))) return;

  const ticket = await getFeedbackById(ticketId);
  if (!ticket) {
    await upsertBotMessage(ctx, `${pe("error")} Обращение не найдено.`);
    return;
  }
  if (ticket.status === "closed" && ticket.adminReply) {
    await upsertBotMessage(
      ctx,
      [
        `${pe("info")} Это обращение уже закрыто с ответом.`,
        "",
        ticketSummaryHtml(ticket),
      ].join("\n")
    );
    return;
  }

  clearPendingInputs(ctx);
  ctx.session.adminInput = { type: "feedback_reply", ticketId: String(ticket._id) };

  await upsertBotMessage(
    ctx,
    [
      `${pe("edit")} <b>Ответ на обращение</b>`,
      "",
      ticketSummaryHtml(ticket),
      "",
      "Введите текст ответа одним сообщением — он будет отправлен пользователю.",
    ].join("\n"),
    { reply_markup: feedbackAdminReplyCancelKeyboard().reply_markup }
  );
}

async function startFeedbackAdminClose(ctx, ticketId) {
  if (!(await ensureAdminPrivate(ctx))) return;

  try {
    const ticket = await closeFeedback(ctx.telegram, ticketId, ctx.from.id);
    await upsertBotMessage(
      ctx,
      [
        `${pe("success")} <b>Обращение закрыто</b>`,
        "",
        ticketSummaryHtml(ticket),
      ].join("\n")
    );
  } catch (error) {
    await upsertBotMessage(ctx, `${pe("error")} ${error.message}`);
  }
}

async function ensureAdminPrivate(ctx) {
  if (!isPrivateChat(ctx)) {
    await ctx.reply(`${pe("lock")} Действие доступно только в ЛС с ботом.`, {
      parse_mode: "HTML",
    });
    return false;
  }
  if (!isAdminTelegramId(ctx.from.id)) {
    await upsertBotMessage(ctx, `${pe("error")} Недостаточно прав.`);
    return false;
  }
  return true;
}

async function handleFeedbackAdminTextInput(ctx, text) {
  const input = ctx.session?.adminInput;
  if (!input || input.type !== "feedback_reply") return false;
  if (!isPrivateChat(ctx)) return false;
  if (!isAdminTelegramId(ctx.from.id)) {
    ctx.session.adminInput = null;
    return false;
  }

  try {
    await ctx.deleteMessage(ctx.message.message_id);
  } catch (_) {
    /* ignore */
  }

  try {
    const ticket = await replyToFeedback(ctx.telegram, input.ticketId, ctx.from.id, text);
    ctx.session.adminInput = null;
    await upsertBotMessage(
      ctx,
      [
        `${pe("success")} <b>Ответ отправлен</b>`,
        "",
        ticketSummaryHtml(ticket),
        "",
        `${pe("success")} Пользователь получил сообщение, обращение закрыто.`,
      ].join("\n")
    );
  } catch (error) {
    await upsertBotMessage(
      ctx,
      `${pe("error")} ${error.message || "Не удалось отправить ответ."}`,
      { reply_markup: feedbackAdminReplyCancelKeyboard().reply_markup }
    );
  }

  return true;
}

function registerFeedbackCommand(bot) {
  const openFeedback = async (ctx) => {
    if (ctx.scene?.current) {
      try {
        await ctx.scene.leave();
      } catch (_) {
        /* ignore */
      }
    }
    await renderFeedbackMenu(ctx);
  };

  bot.command(["feedback", "fb"], openFeedback);

  bot.action("feedback:menu", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await renderFeedbackMenu(ctx);
  });

  bot.action("feedback:new", async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    if (await rejectIfNotPrivate(ctx)) return;

    const user = await ensureUser(ctx.from);
    if (user.isBanned) {
      await upsertBotMessage(
        ctx,
        `${pe("userBlocked")} Ты заблокирован. Фидбек недоступен.`
      );
      return;
    }

    clearPendingInputs(ctx);
    if (ctx.session) ctx.session.feedbackDraft = { step: "type" };

    await upsertBotMessage(
      ctx,
      [
        `${pe("edit")} <b>Новое обращение</b>`,
        "",
        "Выберите направление:",
      ].join("\n"),
      { reply_markup: feedbackTypeKeyboard().reply_markup }
    );
  });

  bot.action(/^feedback:inline:([a-f0-9]{24})$/i, async (ctx) => {
    await ctx.answerCbQuery("Карточка загружается…").catch(() => {});
  });

  bot.action(/^feedback:type:(bug|question|idea)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    if (await rejectIfNotPrivate(ctx)) return;

    const type = ctx.match[1];
    if (ctx.session) {
      ctx.session.feedbackDraft = { step: "text", type };
    }

    await upsertBotMessage(
      ctx,
      [
        `${pe(typeEmojiKey(type))} <b>${typeLabel(type)}</b>`,
        "",
        "Опишите обращение одним сообщением.",
        "Можно приложить детали: что делали, что ожидали, что получили.",
      ].join("\n"),
      { reply_markup: feedbackCancelKeyboard().reply_markup }
    );
  });

  bot.action(/^feedback:admin:reply:([a-f0-9]{24})$/i, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await startFeedbackAdminReply(ctx, ctx.match[1]);
  });

  bot.action(/^feedback:admin:close:([a-f0-9]{24})$/i, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await startFeedbackAdminClose(ctx, ctx.match[1]);
  });

  bot.action("feedback:admin:cancel", async (ctx) => {
    await ctx.answerCbQuery("Отменено").catch(() => {});
    if (ctx.session) ctx.session.adminInput = null;
    await upsertBotMessage(ctx, `${pe("info")} Ответ отменён.`);
  });
}

async function handleFeedbackTextInput(ctx, text) {
  const draft = ctx.session?.feedbackDraft;
  if (!draft || draft.step !== "text" || !draft.type) return false;
  if (!isPrivateChat(ctx)) return false;

  const user = await ensureUser(ctx.from);
  if (user.isBanned) {
    ctx.session.feedbackDraft = null;
    await upsertBotMessage(
      ctx,
      `${pe("userBlocked")} Ты заблокирован. Фидбек недоступен.`
    );
    return true;
  }

  try {
    await ctx.deleteMessage(ctx.message.message_id);
  } catch (_) {
    /* ignore */
  }

  try {
    const ticket = await createFeedback(user, { type: draft.type, text });
    ctx.session.feedbackDraft = null;
    await notifyAdminsAboutFeedback(ctx.telegram, ticket);

    await upsertBotMessage(
      ctx,
      [
        `${pe("success")} <b>Обращение отправлено</b>`,
        "",
        `${pe(typeEmojiKey(ticket.type))} ${typeLabel(ticket.type)}`,
        `${pe("tag")} ID: <code>${ticket._id}</code>`,
        "",
        "Мы получили сообщение. Статус смотрите в «Мои обращения».",
      ].join("\n"),
      { reply_markup: feedbackResultKeyboard().reply_markup }
    );
  } catch (error) {
    await upsertBotMessage(
      ctx,
      `${pe("error")} ${error.message || "Не удалось отправить обращение."}`,
      { reply_markup: feedbackCancelKeyboard().reply_markup }
    );
  }

  return true;
}

module.exports = {
  registerFeedbackCommand,
  renderFeedbackMenu,
  handleFeedbackTextInput,
  handleFeedbackAdminTextInput,
  startFeedbackAdminReply,
  startFeedbackAdminClose,
  isPrivateChat,
  feedbackDeepLink,
};
