const User = require("../models/User");
const { parseDuration, formatDuration } = require("../utils/duration");
const {
  isChatAdmin,
  isStaff,
  escapeHtml,
  formatUserLink,
  getTargetFromContext,
  getReasonFromMessage,
  getMuteTimeAndReason,
  resolveTargetUser,
} = require("../utils/moderation");
const { pe } = require("../utils/emoji");

const WARN_LIMIT = 3;
const WARN_MUTE_DAYS = 30;

const MUTE_PERMISSIONS = {
  can_send_messages: false,
  can_send_audios: false,
  can_send_documents: false,
  can_send_photos: false,
  can_send_videos: false,
  can_send_video_notes: false,
  can_send_voice_notes: false,
  can_send_polls: false,
  can_send_other_messages: false,
  can_add_web_page_previews: false,
  can_change_info: false,
  can_invite_users: false,
  can_pin_messages: false,
};

const FULL_PERMISSIONS = {
  can_send_messages: true,
  can_send_audios: true,
  can_send_documents: true,
  can_send_photos: true,
  can_send_videos: true,
  can_send_video_notes: true,
  can_send_voice_notes: true,
  can_send_polls: true,
  can_send_other_messages: true,
  can_add_web_page_previews: true,
  can_change_info: false,
  can_invite_users: true,
  can_pin_messages: false,
};

async function assertGroupModeration(ctx) {
  const chat = ctx.chat;
  if (!chat || chat.type === "private") {
    return { error: `${pe("info")} Команда доступна только в чате.` };
  }

  const actorId = ctx.from.id;
  const botId = ctx.botInfo?.id || (await ctx.telegram.getMe()).id;

  if (!(await isStaff(actorId))) {
    return { error: `${pe("error")} Недостаточно прав.` };
  }

  if (!(await isChatAdmin(ctx.telegram, chat.id, botId))) {
    return {
      error: `${pe("error")} Бот должен быть администратором чата с правами модерации.`,
    };
  }

  return { chat, actorId, botId };
}

async function resolveActionTarget(ctx, { allowSelf = false } = {}) {
  const gate = await assertGroupModeration(ctx);
  if (gate.error) return gate;

  const target = getTargetFromContext(ctx);
  if (!target) {
    return {
      error: `${pe("info")} Укажите пользователя: ответом, <code>@username</code> или ID.`,
    };
  }

  const resolved = await resolveTargetUser(ctx, target);
  if (resolved?.error) return { error: `${pe("error")} ${resolved.error}` };
  if (!resolved?.userId) {
    return { error: `${pe("info")} Укажите пользователя: ответом, @username или ID.` };
  }

  const { userId, targetUser, source } = resolved;
  if (!allowSelf && userId === gate.actorId) {
    return { error: `${pe("error")} Нельзя применить к себе.` };
  }
  if (userId === gate.botId) {
    return { error: `${pe("error")} Нельзя применить к боту.` };
  }

  return { ...gate, userId, targetUser, source, hasTargetInText: source !== "reply" };
}

function reasonPart(reason) {
  if (!reason || reason.trim() === "Не указана") return "";
  return ` по причине: <b>${escapeHtml(reason)}</b>`;
}

async function banUser(ctx) {
  const t = await resolveActionTarget(ctx);
  if (t.error) return t.error;

  const reason = getReasonFromMessage(ctx, t.hasTargetInText);
  try {
    await ctx.telegram.banChatMember(t.chat.id, t.userId);
  } catch (err) {
    return `${pe("error")} Не удалось забанить: ${escapeHtml(err.message)}`;
  }

  return `${pe("userBlocked")} ${formatUserLink(ctx.from)} забанил <code>${t.userId}</code>${reasonPart(reason)}`;
}

async function unbanUser(ctx) {
  const t = await resolveActionTarget(ctx);
  if (t.error) return t.error;

  try {
    await ctx.telegram.unbanChatMember(t.chat.id, t.userId, { only_if_banned: true });
  } catch (err) {
    return `${pe("error")} Не удалось разбанить: ${escapeHtml(err.message)}`;
  }

  return `${pe("success")} ${formatUserLink(ctx.from)} разбанил <code>${t.userId}</code>`;
}

async function kickUser(ctx) {
  const t = await resolveActionTarget(ctx);
  if (t.error) return t.error;

  const reason = getReasonFromMessage(ctx, t.hasTargetInText);
  try {
    await ctx.telegram.banChatMember(t.chat.id, t.userId);
    await ctx.telegram.unbanChatMember(t.chat.id, t.userId, { only_if_banned: true });
  } catch (err) {
    return `${pe("error")} Не удалось кикнуть: ${escapeHtml(err.message)}`;
  }

  return `${pe("delete")} ${formatUserLink(ctx.from)} кикнул <code>${t.userId}</code>${reasonPart(reason)}`;
}

async function muteUser(ctx) {
  const t = await resolveActionTarget(ctx);
  if (t.error) return t.error;

  let { timeStr, reason } = getMuteTimeAndReason(ctx, t.hasTargetInText);
  if (t.source === "reply" && !timeStr.trim()) {
    timeStr = "1h";
    reason = "Не указана";
  }

  const isForever = !timeStr.trim() || timeStr.trim() === "0";
  const duration = isForever ? null : parseDuration(timeStr);
  if (!isForever && !duration) {
    return `${pe("error")} Некорректное время. Пример: <code>1ч</code>, <code>30м</code>, <code>1д</code>, <code>1н</code>.`;
  }

  const durationLabel = duration ? formatDuration(duration.seconds) : "навсегда";
  const options = { permissions: MUTE_PERMISSIONS };
  if (duration) options.until_date = duration.untilDate;

  try {
    await ctx.telegram.restrictChatMember(t.chat.id, t.userId, options);
  } catch (err) {
    return `${pe("error")} Не удалось замутить: ${escapeHtml(err.message)}`;
  }

  return `${pe("lock")} ${formatUserLink(ctx.from)} выдал мут <code>${t.userId}</code> на <b>${escapeHtml(durationLabel)}</b>${reasonPart(reason)}`;
}

async function unmuteUser(ctx) {
  const t = await resolveActionTarget(ctx);
  if (t.error) return t.error;

  try {
    await ctx.telegram.restrictChatMember(t.chat.id, t.userId, {
      permissions: FULL_PERMISSIONS,
    });
  } catch (err) {
    return `${pe("error")} Не удалось снять мут: ${escapeHtml(err.message)}`;
  }

  return `${pe("unlock")} ${formatUserLink(ctx.from)} снял мут с <code>${t.userId}</code>`;
}

async function warnUser(ctx) {
  const t = await resolveActionTarget(ctx);
  if (t.error) return t.error;

  const reason = getReasonFromMessage(ctx, t.hasTargetInText);
  const adminName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || "Admin";

  let user = await User.findOne({ telegramId: String(t.userId) });
  if (!user) {
    user = await User.create({
      telegramId: String(t.userId),
      username: t.targetUser?.username || "",
      warns: [],
    });
  }
  if (!Array.isArray(user.warns)) user.warns = [];

  user.warns.push({
    reason,
    adminId: String(t.actorId),
    adminName,
    createdAt: new Date(),
  });
  await user.save();

  const count = user.warns.length;
  let text = `${pe("notification")} ${formatUserLink(ctx.from)} выдал варн <code>${t.userId}</code>${reasonPart(reason)}. Всего: <b>${count}/${WARN_LIMIT}</b>`;

  if (count >= WARN_LIMIT) {
    user.warns = [];
    await user.save();
    const untilDate = Math.floor(Date.now() / 1000) + WARN_MUTE_DAYS * 24 * 60 * 60;
    try {
      await ctx.telegram.restrictChatMember(t.chat.id, t.userId, {
        permissions: MUTE_PERMISSIONS,
        until_date: untilDate,
      });
      text += `\n\n${pe("lock")} Лимит варнов — мут на ${WARN_MUTE_DAYS} дн., варны обнулены.`;
    } catch (_) {
      text += `\n\n${pe("error")} Лимит варнов, варны обнулены, но мут не выдан (проверьте права бота).`;
    }
  }

  return text;
}

async function unwarnUser(ctx) {
  const t = await resolveActionTarget(ctx);
  if (t.error) return t.error;

  const user = await User.findOne({ telegramId: String(t.userId) });
  if (!user?.warns?.length) {
    return `${pe("info")} У пользователя <code>${t.userId}</code> нет предупреждений.`;
  }

  user.warns.pop();
  await user.save();
  return `${pe("success")} ${formatUserLink(ctx.from)} снял варн с <code>${t.userId}</code>. Осталось: <b>${user.warns.length}/${WARN_LIMIT}</b>`;
}

async function listWarns(ctx) {
  const chat = ctx.chat;
  if (!chat || chat.type === "private") {
    return `${pe("info")} Команда доступна только в чате.`;
  }

  const replyFrom = ctx.message?.reply_to_message?.from;
  let userId = ctx.from.id;
  let header = `${pe("notification")} <b>Ваши предупреждения</b>`;

  if (replyFrom && !replyFrom.is_bot) {
    if (!(await isStaff(ctx.from.id))) {
      return `${pe("error")} Смотреть чужие варны могут только модераторы.`;
    }
    userId = replyFrom.id;
    header = `${pe("notification")} <b>Предупреждения</b> · <code>${userId}</code>`;
  }

  const user = await User.findOne({ telegramId: String(userId) }).lean();
  const warns = user?.warns || [];
  if (!warns.length) {
    return `${header}\n\nПредупреждений нет.`;
  }

  const lines = [header, "", `Всего: <b>${warns.length}</b> из ${WARN_LIMIT}`, ""];
  warns.forEach((w, i) => {
    const when = w.createdAt
      ? new Date(w.createdAt).toLocaleString("ru-RU", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";
    lines.push(`${i + 1}. ${escapeHtml(String(w.reason || "—").slice(0, 200))}`);
    lines.push(`   ${pe("profile")} ${escapeHtml(String(w.adminName || w.adminId || "—"))} · ${when}`);
    lines.push("");
  });
  return lines.join("\n").trim();
}

module.exports = {
  WARN_LIMIT,
  banUser,
  unbanUser,
  kickUser,
  muteUser,
  unmuteUser,
  warnUser,
  unwarnUser,
  listWarns,
};
