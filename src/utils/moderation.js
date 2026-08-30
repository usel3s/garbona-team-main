const User = require("../models/User");
const { isAdminTelegramId } = require("../services/userService");

async function isChatAdmin(telegram, chatId, userId) {
  try {
    const member = await telegram.getChatMember(chatId, userId);
    return ["creator", "administrator"].includes(member.status);
  } catch (_) {
    return false;
  }
}

async function isStaff(telegramId) {
  if (isAdminTelegramId(telegramId)) return true;
  const user = await User.findOne({ telegramId: String(telegramId) }).select("isModerator").lean();
  return Boolean(user?.isModerator);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatUserLink(user) {
  if (!user) return "?";
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || "Пользователь";
  return `<a href="tg://user?id=${user.id}">${escapeHtml(name)}</a>`;
}

function formatUserShort(user) {
  if (!user) return "?";
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || `ID ${user.id}`;
  return user.username ? `${name} (@${user.username})` : name;
}

/**
 * Цель: reply, @username или numeric ID после команды.
 */
function getTargetFromContext(ctx) {
  const reply = ctx.message?.reply_to_message?.from;
  if (reply && !reply.is_bot) return { user: reply, source: "reply" };

  const text = String(ctx.message?.text || "").trim();
  const parts = text.split(/\s+/);
  if (parts.length < 2) return null;

  const arg = parts[1];
  const mention = arg.match(/^@([A-Za-z0-9_]+)$/);
  if (mention) return { username: mention[1], source: "mention" };

  if (/^\d+$/.test(arg)) return { userId: Number(arg), source: "id" };
  return null;
}

function getReasonFromMessage(ctx, hasTargetInText) {
  const text = String(ctx.message?.text || "").trim();
  let rest = text.replace(/^\/?\S+(?:@\w+)?\s*/, "");
  if (hasTargetInText) rest = rest.replace(/^@?\S+\s*/, "");
  return rest.trim() || "Не указана";
}

function getMuteTimeAndReason(ctx, hasTargetInText) {
  const text = String(ctx.message?.text || "").trim();
  let rest = text.replace(/^\/?\S+(?:@\w+)?\s*/, "");
  if (hasTargetInText) rest = rest.replace(/^@?\S+\s*/, "");
  const parts = rest.trim().split(/\s+/).filter(Boolean);
  const timeStr = parts[0] || "";
  const reason = parts.slice(1).join(" ").trim() || "Не указана";
  return { timeStr, reason };
}

async function resolveTargetUser(ctx, target) {
  if (!target) return null;

  if (target.user) {
    return {
      userId: Number(target.user.id),
      targetUser: target.user,
      source: target.source,
    };
  }

  if (target.userId) {
    let targetUser = null;
    try {
      const member = await ctx.telegram.getChatMember(ctx.chat.id, target.userId);
      if (member?.user) targetUser = member.user;
    } catch (_) {
      /* ignore */
    }
    return { userId: Number(target.userId), targetUser, source: target.source };
  }

  if (target.username) {
    const escaped = target.username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const u = await User.findOne({ username: new RegExp(`^${escaped}$`, "i") });
    if (!u) return { error: `Пользователь @${target.username} не найден в базе.` };
    return {
      userId: Number(u.telegramId),
      targetUser: {
        id: Number(u.telegramId),
        username: u.username,
        first_name: u.username || u.telegramId,
      },
      source: target.source,
    };
  }

  return null;
}

module.exports = {
  isChatAdmin,
  isStaff,
  escapeHtml,
  formatUserLink,
  formatUserShort,
  getTargetFromContext,
  getReasonFromMessage,
  getMuteTimeAndReason,
  resolveTargetUser,
};
