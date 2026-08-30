const { getUserByTelegramId, ensureUser, isAdminTelegramId } = require("../services/userService");
const {
  getUserProfitStatsByTelegramId,
  getProfitDashboard,
  daysWithTeam,
} = require("../services/profitService");
const { getCurrencyContext, formatDisplayAmount } = require("../services/currencyService");
const { renderProfileImage } = require("../utils/profileImageRenderer");
const {
  getReactionCounts,
  toggleMpReaction,
  buildMpReactionKeyboard,
  REACTION_KEYS,
} = require("../services/mpReactionService");
const { pe } = require("../utils/emoji");
const { logger } = require("../utils/logger");
const { canViewOtherProfile, replyAccessDenied } = require("../services/profileAccessService");

const MP_DELETE_AFTER_MS = 10_000;
const MP_COOLDOWN_MS = 20_000;

/** @type {Map<string, number>} */
const mpCooldownUntil = new Map();

async function safeDeleteMessage(telegram, chatId, messageId) {
  if (!chatId || !messageId) return;
  try {
    await telegram.deleteMessage(chatId, messageId);
  } catch (_) {
    /* уже удалено / нет прав */
  }
}

function scheduleMpCleanup(telegram, chatId, messageIds) {
  const ids = [...new Set(messageIds.filter(Boolean).map(Number))];
  setTimeout(() => {
    for (const id of ids) {
      safeDeleteMessage(telegram, chatId, id);
    }
  }, MP_DELETE_AFTER_MS);
}

function getMpCooldownLeftMs(telegramId) {
  const until = mpCooldownUntil.get(String(telegramId)) || 0;
  return Math.max(0, until - Date.now());
}

function markMpUsed(telegramId) {
  mpCooldownUntil.set(String(telegramId), Date.now() + MP_COOLDOWN_MS);
}

function displayNameFromTelegram(from) {
  const name = [from?.first_name, from?.last_name].filter(Boolean).join(" ").trim();
  if (name) return name;
  if (from?.username) return `@${from.username}`;
  return `ID ${from?.id || "—"}`;
}

function roleLabelForUser(user) {
  if (!user) return "Не в боте";
  if (user.role === "admin") return "Администратор";
  if (user.isCurator) return "Куратор";
  if (user.isCaller) return "Прозвонщица";
  if (user.isTeamMember) return "Воркер";
  if (user.isBanned) return "Заблокирован";
  return "Пользователь";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function pluralRu(n, one, few, many) {
  const abs = Math.abs(Number(n) || 0);
  const n10 = abs % 10;
  const n100 = abs % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
  return many;
}

function formatDaysLabel(days) {
  const n = Math.max(0, Number(days) || 0);
  return `${n} ${pluralRu(n, "день", "дня", "дней")}`;
}

function formatWarnsLabel(count) {
  const n = Math.max(0, Number(count) || 0);
  return `${n} ${pluralRu(n, "варн", "варна", "варнов")}`;
}

async function buildMemberProfileHtml(targetFrom, dbUser, currencyCtx) {
  const title = escapeHtml(displayNameFromTelegram(targetFrom));
  const roleLabel = roleLabelForUser(dbUser);

  const days =
    dbUser?.createdAt != null
      ? daysWithTeam(dbUser)
      : null;

  const warnCount = Array.isArray(dbUser?.warns) ? dbUser.warns.length : 0;

  const stats = dbUser
    ? await getUserProfitStatsByTelegramId(dbUser.telegramId, "all")
    : null;
  const totalProfit = stats ? stats.periodProfit : 0;
  const operationsCount = stats ? stats.operationsCount : 0;
  const avgProfit = operationsCount > 0 ? totalProfit / operationsCount : 0;

  const lines = [
    `${pe("profile")} <b>${title}</b>`,
    ` ┖ Статус: ${roleLabel}`,
  ];

  if (dbUser?.curatorTelegramId && !dbUser.isCurator) {
    const bound = await getUserByTelegramId(dbUser.curatorTelegramId);
    const curatorLabel = bound?.username
      ? `@${escapeHtml(bound.username)}`
      : `<code>${escapeHtml(dbUser.curatorTelegramId)}</code>`;
    lines.push(` ┖ Куратор: ${curatorLabel}`);
  }

  lines.push("");
  lines.push(`${pe("statistics")} <b>Статистика:</b>`);

  if (operationsCount > 0) {
    lines.push(
      ` ┖ ${operationsCount} профит${operationsCount === 1 ? "" : "а"} на сумму: ${formatDisplayAmount(totalProfit, currencyCtx)}`
    );
    lines.push(` ┖ Средний профит: ${formatDisplayAmount(avgProfit, currencyCtx)}`);
  } else {
    lines.push(" ┖ Профиты отсутствуют.");
  }

  lines.push("");
  lines.push(`О себе: ${escapeHtml(dbUser?.bio || "Отсутствует")}`);

  if (days != null) {
    lines.push("");
    lines.push(`${pe("users")} С нами: ${formatDaysLabel(days)}`);
    lines.push(` ┖ Предупреждений: ${formatWarnsLabel(warnCount)}`);
  }

  return lines.join("\n");
}

async function buildMpImageBuffer(targetFrom, dbUser) {
  if (dbUser) {
    const dash = await getProfitDashboard(dbUser);
    return renderProfileImage({
      days: dash.days,
      nickname:
        String(targetFrom?.first_name || dbUser.firstName || "").trim() || dash.nickname,
      count: dash.count,
      totalShare: dash.totalShare,
      maxShare: dash.maxShare,
    });
  }

  return renderProfileImage({
    days: 0,
    nickname: String(targetFrom?.first_name || targetFrom?.username || "—").trim(),
    count: 0,
    totalShare: 0,
    maxShare: 0,
  });
}

function registerMpCommand(bot) {
  bot.command("mp", async (ctx) => {
    const caller = await ensureUser(ctx.from);
    const allowed =
      isAdminTelegramId(ctx.from.id) ||
      caller.role === "admin" ||
      caller.isTeamMember;
    if (!allowed) {
      await ctx.reply(`${pe("error")} Команда доступна участникам команды.`, {
        parse_mode: "HTML",
      });
      return;
    }

    const cooldownLeft = getMpCooldownLeftMs(ctx.from.id);
    if (cooldownLeft > 0) {
      const sec = Math.ceil(cooldownLeft / 1000);
      await ctx.reply(
        `${pe("time")} Подождите <b>${sec}</b> сек. перед повторным /mp.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const replied = ctx.message?.reply_to_message?.from;
    if (!replied || replied.is_bot) {
      await ctx.reply(
        `${pe("info")} Ответьте командой <code>/mp</code> на сообщение пользователя.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const targetId = String(replied.id);
    const gate = await canViewOtherProfile(ctx.from, targetId);
    if (!gate.ok) {
      const commandMessageId = ctx.message?.message_id;
      const chatId = ctx.chat?.id;
      let deniedMessageId = null;
      try {
        const sent = await replyAccessDenied(ctx, gate, {
          reply_to_message_id: commandMessageId,
        });
        deniedMessageId = sent?.message_id;
      } catch (error) {
        logger.warn("mp access denied send failed", error.message);
      }
      markMpUsed(ctx.from.id);
      scheduleMpCleanup(ctx.telegram, chatId, [commandMessageId, deniedMessageId]);
      return;
    }

    const dbUser = await getUserByTelegramId(targetId);
    const currencyCtx = await getCurrencyContext();
    const caption = await buildMemberProfileHtml(replied, dbUser, currencyCtx);
    const counts = await getReactionCounts(targetId);
    const keyboard = buildMpReactionKeyboard(targetId, counts);
    const commandMessageId = ctx.message?.message_id;
    const chatId = ctx.chat?.id;

    let profileMessageId = null;
    try {
      const imageBuffer = await buildMpImageBuffer(replied, dbUser);
      const sent = await ctx.replyWithPhoto(
        { source: imageBuffer, filename: "mp-profile.png" },
        {
          caption,
          parse_mode: "HTML",
          reply_to_message_id: commandMessageId,
          reply_markup: keyboard,
        }
      );
      profileMessageId = sent?.message_id;
    } catch (error) {
      logger.warn("mp image render failed", error.message);
      const sent = await ctx.reply(caption, {
        parse_mode: "HTML",
        reply_to_message_id: commandMessageId,
        reply_markup: keyboard,
      });
      profileMessageId = sent?.message_id;
    }

    markMpUsed(ctx.from.id);
    scheduleMpCleanup(ctx.telegram, chatId, [commandMessageId, profileMessageId]);
  });

  bot.action(/^mp:react:(\d+):(heart|plead|poop|horns|call|money)$/, async (ctx) => {
    const targetId = ctx.match[1];
    const reactionKey = ctx.match[2];
    if (!REACTION_KEYS.has(reactionKey)) {
      await ctx.answerCbQuery("Неизвестная реакция", { show_alert: true });
      return;
    }

    try {
      const result = await toggleMpReaction(targetId, ctx.from.id, reactionKey);
      if (result.action === "self") {
        await ctx.answerCbQuery("Нельзя реагировать на свой профиль", { show_alert: true });
        return;
      }

      const keyboard = buildMpReactionKeyboard(targetId, result.counts);
      try {
        await ctx.editMessageReplyMarkup(keyboard);
      } catch (_) {
        /* сообщение не изменилось / устарело */
      }

      if (result.action === "remove") await ctx.answerCbQuery("Реакция снята");
      else if (result.action === "switch") await ctx.answerCbQuery("Реакция изменена");
      else await ctx.answerCbQuery("Реакция добавлена");
    } catch (error) {
      logger.warn("mp reaction failed", error.message);
      await ctx.answerCbQuery("Не удалось обновить реакцию", { show_alert: true });
    }
  });
}

module.exports = { registerMpCommand, buildMemberProfileHtml };
