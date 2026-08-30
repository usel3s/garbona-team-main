const {
  banUser,
  unbanUser,
  kickUser,
  muteUser,
  unmuteUser,
  warnUser,
  unwarnUser,
  listWarns,
} = require("../services/moderationService");
const { logger } = require("../utils/logger");

function replyHtml(ctx, text) {
  return ctx.reply(text, { parse_mode: "HTML" });
}

function wrap(handler) {
  return async (ctx) => {
    try {
      const text = await handler(ctx);
      if (text) await replyHtml(ctx, text);
    } catch (error) {
      logger.error("Moderation command failed", error);
      try {
        await replyHtml(ctx, "Произошла ошибка модерации.");
      } catch (_) {
        /* ignore */
      }
    }
  };
}

/**
 * Регистрирует /cmd (EN через command) и русские алиасы через hears.
 */
function registerNamed(bot, names, handler) {
  const fn = wrap(handler);
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (/^[a-z_]+$/i.test(name)) {
      bot.command(name, fn);
    } else {
      bot.hears(new RegExp(`^/${escaped}(?:@\\w+)?(?:\\s|$)`, "i"), fn);
    }
  }
}

function registerModerationCommands(bot) {
  registerNamed(bot, ["ban", "бан", "забанить"], banUser);
  registerNamed(bot, ["unban", "разбан", "разбанить"], unbanUser);
  registerNamed(bot, ["kick", "кик", "кикнуть"], kickUser);
  registerNamed(bot, ["mute", "мут", "замутить"], muteUser);
  registerNamed(bot, ["unmute", "размут", "размутить"], unmuteUser);
  registerNamed(bot, ["warn", "варн", "пред", "предупредить"], warnUser);
  registerNamed(bot, ["unwarn", "разварн", "снятьварн"], unwarnUser);
  registerNamed(bot, ["warns", "преды"], listWarns);
}

module.exports = { registerModerationCommands };
