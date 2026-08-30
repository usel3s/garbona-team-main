const { logger } = require("./logger");

const IGNORABLE_PATTERNS = [
  /query is too old/i,
  /query ID is invalid/i,
  /response timeout expired/i,
  /message is not modified/i,
  /message to edit not found/i,
  /message to delete not found/i,
  /message can't be deleted/i,
  /message to be replied not found/i,
  /bot was blocked by the user/i,
  /user is deactivated/i,
  /chat not found/i,
  /PEER_ID_INVALID/i,
  /have no rights to send/i,
  /CHAT_WRITE_FORBIDDEN/i,
  /BUTTON_DATA_INVALID/i,
  /message is too old/i,
  /canceled by new edit/i,
  /bot can't initiate conversation/i,
  /Forbidden: bot was kicked/i,
];

function getTelegramErrorText(error) {
  return (
    error?.response?.description ||
    error?.description ||
    error?.message ||
    String(error || "")
  );
}

function isTelegramRateLimitError(error) {
  const code = Number(error?.response?.error_code || error?.error_code || 0);
  if (code === 429) return true;
  return /too many requests|retry after/i.test(getTelegramErrorText(error));
}

function isIgnorableTelegramError(error) {
  if (isTelegramRateLimitError(error)) return true;
  const text = getTelegramErrorText(error);
  return IGNORABLE_PATTERNS.some((re) => re.test(text));
}

async function safeAnswerCbQuery(ctx, text, extra = {}) {
  if (!ctx?.callbackQuery) return false;
  try {
    await ctx.telegram.answerCbQuery(ctx.callbackQuery.id, text, extra);
    return true;
  } catch (error) {
    if (isIgnorableTelegramError(error)) {
      logger.warn("Ignored answerCbQuery error", getTelegramErrorText(error));
      return false;
    }
    logger.warn("answerCbQuery failed", getTelegramErrorText(error));
    return false;
  }
}

/**
 * Патчит ctx.answerCbQuery: не бросает, отвечает только один раз.
 */
function patchSafeAnswerCbQuery(ctx) {
  if (!ctx.callbackQuery || ctx.__safeAnswerPatched) return;
  ctx.__safeAnswerPatched = true;

  const original = ctx.answerCbQuery.bind(ctx);
  let answered = false;

  ctx.answerCbQuery = async (text, extra = {}) => {
    if (answered) return;
    answered = true;
    try {
      return await original(text, extra);
    } catch (error) {
      if (isIgnorableTelegramError(error)) {
        logger.warn("Ignored answerCbQuery error", getTelegramErrorText(error));
        return;
      }
      logger.warn("answerCbQuery failed", getTelegramErrorText(error));
    }
  };
}

module.exports = {
  isIgnorableTelegramError,
  isTelegramRateLimitError,
  getTelegramErrorText,
  safeAnswerCbQuery,
  patchSafeAnswerCbQuery,
};
