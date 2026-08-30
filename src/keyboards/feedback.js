const { Markup } = require("telegraf");
const { btn, urlBtn, switchInlineBtn } = require("../utils/emoji");
const { env } = require("../config/env");

function feedbackMenuKeyboard() {
  return Markup.inlineKeyboard([
    [switchInlineBtn("Мои обращения", "feedback", "file")],
    [btn("Написать обращение", "feedback:new", "edit")],
    [btn("В главное меню", "menu:home", "home")],
  ]);
}

function feedbackTypeKeyboard() {
  return Markup.inlineKeyboard([
    [
      btn("Баг", "feedback:type:bug", "error"),
      btn("Вопрос", "feedback:type:question", "info"),
    ],
    [btn("Предложить идею", "feedback:type:idea", "gift")],
    [btn("Назад", "feedback:menu", "home")],
  ]);
}

function feedbackCancelKeyboard() {
  return Markup.inlineKeyboard([
    [btn("Отменить", "feedback:menu", "error")],
    [btn("В главное меню", "menu:home", "home")],
  ]);
}

function feedbackResultKeyboard() {
  return Markup.inlineKeyboard([
    [switchInlineBtn("Мои обращения", "feedback", "file")],
    [btn("Ещё обращение", "feedback:new", "edit")],
    [btn("В меню фидбека", "feedback:menu", "notification")],
    [btn("В главное меню", "menu:home", "home")],
  ]);
}

function feedbackTicketKeyboard() {
  return Markup.inlineKeyboard([
    [switchInlineBtn("Мои обращения", "feedback", "file")],
    [btn("Написать ещё", "feedback:new", "edit")],
    [btn("В меню фидбека", "feedback:menu", "notification")],
  ]);
}

function feedbackAdminDeepLink(action, ticketId) {
  const username = String(env.botUsername || "").replace(/^@/, "");
  if (!username) return "";
  return `https://t.me/${username}?start=fb_${action}_${ticketId}`;
}

/** Кнопки в уведомлении: открывают ЛС бота через deep link. */
function feedbackAdminNotifyKeyboard(ticketId) {
  const id = String(ticketId);
  const replyUrl = feedbackAdminDeepLink("reply", id);
  const closeUrl = feedbackAdminDeepLink("close", id);

  if (replyUrl && closeUrl) {
    return Markup.inlineKeyboard([
      [
        urlBtn("Ответить", replyUrl, "edit"),
        urlBtn("Закрыть", closeUrl, "success"),
      ],
    ]);
  }

  // Fallback, если username бота ещё неизвестен.
  return Markup.inlineKeyboard([
    [
      btn("Ответить", `feedback:admin:reply:${id}`, "edit"),
      btn("Закрыть", `feedback:admin:close:${id}`, "success"),
    ],
  ]);
}

function feedbackAdminReplyCancelKeyboard() {
  return Markup.inlineKeyboard([
    [btn("Отменить", "feedback:admin:cancel", "error")],
  ]);
}

module.exports = {
  feedbackMenuKeyboard,
  feedbackTypeKeyboard,
  feedbackCancelKeyboard,
  feedbackResultKeyboard,
  feedbackTicketKeyboard,
  feedbackAdminNotifyKeyboard,
  feedbackAdminReplyCancelKeyboard,
  feedbackAdminDeepLink,
};
