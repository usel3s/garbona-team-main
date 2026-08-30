const Feedback = require("../models/Feedback");
const { env } = require("../config/env");
const { pe } = require("../utils/emoji");
const { logger } = require("../utils/logger");
const { feedbackAdminNotifyKeyboard } = require("../keyboards/feedback");

const TYPE_LABELS = {
  bug: "Баг",
  question: "Вопрос",
  idea: "Идея",
};

const STATUS_LABELS = {
  open: "Открыто",
  closed: "Закрыто",
};

function typeLabel(type) {
  return TYPE_LABELS[type] || type || "—";
}

function statusLabel(status) {
  return STATUS_LABELS[status] || status || "—";
}

function typeEmojiKey(type) {
  if (type === "bug") return "error";
  if (type === "question") return "info";
  if (type === "idea") return "gift";
  return "notification";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatWhen(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncate(text, max = 120) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

async function listUserFeedback(telegramId, limit = 40) {
  return Feedback.find({ telegramId: String(telegramId) })
    .sort({ createdAt: -1 })
    .limit(Math.min(50, Math.max(1, Number(limit) || 40)));
}

async function getFeedbackById(id) {
  if (!/^[a-f0-9]{24}$/i.test(String(id || ""))) return null;
  return Feedback.findById(id);
}

async function createFeedback(user, { type, text }) {
  const normalizedType = String(type || "").trim();
  if (!TYPE_LABELS[normalizedType]) {
    throw new Error("Выберите направление: баг, вопрос или идея.");
  }

  const body = String(text || "").trim();
  if (body.length < 5) {
    throw new Error("Напишите обращение подробнее (минимум 5 символов).");
  }
  if (body.length > 2000) {
    throw new Error("Слишком длинный текст (максимум 2000 символов).");
  }

  const recent = await Feedback.findOne({
    telegramId: String(user.telegramId),
    createdAt: { $gte: new Date(Date.now() - 60 * 1000) },
  }).sort({ createdAt: -1 });
  if (recent) {
    throw new Error("Подождите минуту перед следующим обращением.");
  }

  const openCount = await Feedback.countDocuments({
    telegramId: String(user.telegramId),
    status: "open",
  });
  if (openCount >= 10) {
    throw new Error("Слишком много открытых обращений. Дождитесь ответа по текущим.");
  }

  return Feedback.create({
    telegramId: String(user.telegramId),
    username: user.username || "",
    firstName: user.firstName || "",
    type: normalizedType,
    text: body,
    status: "open",
  });
}

function buildUserTicketHtml(ticket) {
  return [
    `${pe("notification")} <b>Обращение</b>`,
    "",
    `${pe(typeEmojiKey(ticket.type))} Тип: <b>${escapeHtml(typeLabel(ticket.type))}</b>`,
    `${pe("tag")} ID: <code>${ticket._id}</code>`,
    `${pe("time")} ${escapeHtml(formatWhen(ticket.createdAt))}`,
    `${pe("visible")} Статус: <b>${escapeHtml(statusLabel(ticket.status))}</b>`,
    "",
    `${pe("file")} <b>Текст</b>`,
    escapeHtml(ticket.text),
    ticket.adminReply
      ? `\n${pe("success")} <b>Ответ команды</b>\n${escapeHtml(ticket.adminReply)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildFeedbackInlinePreviewHtml(ticket) {
  return [
    `${pe("loading")} Загрузка обращения…`,
    `${pe(typeEmojiKey(ticket.type))} ${escapeHtml(typeLabel(ticket.type))}`,
    `${pe("tag")} <code>${ticket._id}</code>`,
  ].join("\n");
}

function buildAdminTicketHtml(ticket, { footer = "" } = {}) {
  const nick = ticket.username ? `@${ticket.username}` : "без username";
  const lines = [
    `${pe("notification")} <b>Новый фидбек</b>`,
    "",
    `${pe(typeEmojiKey(ticket.type))} Тип: <b>${escapeHtml(typeLabel(ticket.type))}</b>`,
    `${pe("tag")} Ticket: <code>${ticket._id}</code>`,
    `${pe("profile")} ${escapeHtml(nick)} · <code>${escapeHtml(ticket.telegramId)}</code>`,
    `${pe("time")} ${escapeHtml(formatWhen(ticket.createdAt))}`,
    `${pe("visible")} Статус: <b>${escapeHtml(statusLabel(ticket.status))}</b>`,
    "",
    escapeHtml(ticket.text),
  ];
  if (ticket.adminReply) {
    lines.push("", `${pe("success")} <b>Ответ:</b>`, escapeHtml(ticket.adminReply));
  }
  if (footer) lines.push("", footer);
  return lines.join("\n");
}

function buildUserReplyNotifyHtml(ticket) {
  return [
    `${pe("notification")} <b>Ответ на обращение</b>`,
    "",
    `${pe(typeEmojiKey(ticket.type))} ${escapeHtml(typeLabel(ticket.type))}`,
    `${pe("tag")} ID: <code>${ticket._id}</code>`,
    "",
    escapeHtml(ticket.adminReply || ""),
  ].join("\n");
}

function buildUserClosedNotifyHtml(ticket) {
  return [
    `${pe("success")} <b>Обращение закрыто</b>`,
    "",
    `${pe(typeEmojiKey(ticket.type))} ${escapeHtml(typeLabel(ticket.type))}`,
    `${pe("tag")} ID: <code>${ticket._id}</code>`,
    ticket.adminReply
      ? `\n${pe("success")} <b>Ответ:</b>\n${escapeHtml(ticket.adminReply)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function updateAdminNotifyMessage(telegram, ticket, footer) {
  const chatId = ticket.channelChatId || env.feedbackChannelId || env.applicationsChannelId;
  const messageId = ticket.channelMessageId;
  if (!chatId || !messageId) return;

  try {
    await telegram.editMessageText(
      chatId,
      Number(messageId),
      undefined,
      buildAdminTicketHtml(ticket, { footer }),
      { parse_mode: "HTML", reply_markup: { inline_keyboard: [] } }
    );
  } catch (error) {
    logger.warn("Feedback notify edit failed", error.message);
  }
}

async function notifyAdminsAboutFeedback(telegram, ticket) {
  if (!env.botUsername) {
    try {
      const me = await telegram.getMe();
      if (me?.username) env.botUsername = me.username;
    } catch (_) {
      /* ignore */
    }
  }

  const html = buildAdminTicketHtml(ticket);
  const keyboard = feedbackAdminNotifyKeyboard(ticket._id);
  const channelId = env.feedbackChannelId || env.applicationsChannelId;
  const targets = [];
  if (channelId) {
    targets.push(String(channelId));
  } else {
    for (const adminId of env.adminIds) {
      if (adminId) targets.push(String(adminId));
    }
  }

  let channelMessageId = "";
  let channelChatId = "";
  for (const target of targets) {
    try {
      const msg = await telegram.sendMessage(target, html, {
        parse_mode: "HTML",
        reply_markup: keyboard.reply_markup,
      });
      if (!channelMessageId) {
        channelMessageId = String(msg.message_id);
        channelChatId = String(target);
      }
    } catch (error) {
      logger.warn("Feedback notify failed", target, error.message);
    }
  }

  if (channelMessageId) {
    ticket.channelMessageId = channelMessageId;
    ticket.channelChatId = channelChatId;
    await ticket.save();
  }
}

async function replyToFeedback(telegram, ticketId, adminTelegramId, replyText) {
  const ticket = await getFeedbackById(ticketId);
  if (!ticket) throw new Error("Обращение не найдено.");

  const body = String(replyText || "").trim();
  if (body.length < 2) throw new Error("Ответ слишком короткий.");
  if (body.length > 2000) throw new Error("Ответ слишком длинный (макс. 2000).");

  ticket.adminReply = body;
  ticket.status = "closed";
  ticket.repliedByTelegramId = String(adminTelegramId);
  ticket.closedByTelegramId = String(adminTelegramId);
  await ticket.save();

  try {
    await telegram.sendMessage(ticket.telegramId, buildUserReplyNotifyHtml(ticket), {
      parse_mode: "HTML",
    });
  } catch (error) {
    logger.warn("Feedback user reply notify failed", ticket.telegramId, error.message);
  }

  await updateAdminNotifyMessage(
    telegram,
    ticket,
    `${pe("success")} Ответил админ <code>${escapeHtml(String(adminTelegramId))}</code>`
  );

  return ticket;
}

async function closeFeedback(telegram, ticketId, adminTelegramId) {
  const ticket = await getFeedbackById(ticketId);
  if (!ticket) throw new Error("Обращение не найдено.");
  if (ticket.status === "closed") {
    return ticket;
  }

  ticket.status = "closed";
  ticket.closedByTelegramId = String(adminTelegramId);
  await ticket.save();

  try {
    await telegram.sendMessage(ticket.telegramId, buildUserClosedNotifyHtml(ticket), {
      parse_mode: "HTML",
    });
  } catch (error) {
    logger.warn("Feedback user close notify failed", ticket.telegramId, error.message);
  }

  await updateAdminNotifyMessage(
    telegram,
    ticket,
    `${pe("success")} Закрыл админ <code>${escapeHtml(String(adminTelegramId))}</code>`
  );

  return ticket;
}

module.exports = {
  TYPE_LABELS,
  STATUS_LABELS,
  typeLabel,
  statusLabel,
  typeEmojiKey,
  escapeHtml,
  formatWhen,
  truncate,
  listUserFeedback,
  getFeedbackById,
  createFeedback,
  buildUserTicketHtml,
  buildFeedbackInlinePreviewHtml,
  buildAdminTicketHtml,
  notifyAdminsAboutFeedback,
  replyToFeedback,
  closeFeedback,
};
