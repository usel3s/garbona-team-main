const { isIgnorableTelegramError, getTelegramErrorText } = require("./telegramSafe");
const { logger } = require("./logger");

async function deleteUiMessages(ctx) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const ids = new Set();
  const prevId = ctx.session?.ui?.messageId;
  if (prevId) ids.add(prevId);

  const callbackMsgId = ctx.callbackQuery?.message?.message_id;
  if (callbackMsgId) ids.add(callbackMsgId);

  for (const id of ids) {
    try {
      await ctx.telegram.deleteMessage(chatId, id);
    } catch (error) {
      if (!isIgnorableTelegramError(error)) {
        logger.warn("deleteMessage failed", getTelegramErrorText(error));
      }
    }
  }

  if (ctx.session) {
    ctx.session.ui = { ...(ctx.session.ui || {}), messageId: null };
  }
}

/**
 * Держит в чате одно сообщение бота: удаляет предыдущее и шлёт новое.
 */
async function upsertBotMessage(ctx, text, extra = {}) {
  const mergedExtra = { parse_mode: "HTML", ...extra };
  const chatId = ctx.chat?.id;
  if (!chatId) return null;

  await deleteUiMessages(ctx);

  try {
    const sent = await ctx.reply(text, mergedExtra);
    if (ctx.session) {
      ctx.session.ui = { ...(ctx.session.ui || {}), messageId: sent.message_id };
    }
    return sent.message_id;
  } catch (error) {
    if (isIgnorableTelegramError(error)) {
      logger.warn("Ignored upsertBotMessage error", getTelegramErrorText(error));
      return null;
    }
    throw error;
  }
}

async function upsertBotPhoto(ctx, source, extra = {}) {
  const chatId = ctx.chat?.id;
  if (!chatId) return null;

  await deleteUiMessages(ctx);

  const payload = { ...extra };
  if (payload.caption && !payload.parse_mode) {
    payload.parse_mode = "HTML";
  }

  try {
    const sent = await ctx.replyWithPhoto(source, payload);
    if (ctx.session) {
      ctx.session.ui = { ...(ctx.session.ui || {}), messageId: sent.message_id };
    }
    return sent.message_id;
  } catch (error) {
    if (isIgnorableTelegramError(error)) {
      logger.warn("Ignored upsertBotPhoto error", getTelegramErrorText(error));
      return null;
    }
    throw error;
  }
}

module.exports = { upsertBotMessage, upsertBotPhoto, deleteUiMessages };
