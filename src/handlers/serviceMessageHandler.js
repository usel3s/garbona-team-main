const { env } = require("../config/env");
const { logger } = require("../utils/logger");

function cleanServiceChatIds() {
  return new Set(
    [env.aboutWorkersChatId, env.aboutManualsChatId]
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  );
}

function isJoinLeaveServiceMessage(message) {
  return Boolean(
    (Array.isArray(message?.new_chat_members) && message.new_chat_members.length > 0) ||
      message?.left_chat_member
  );
}

function registerServiceMessageHandlers(bot) {
  const chatIds = cleanServiceChatIds();

  bot.on("message", async (ctx, next) => {
    const message = ctx.message;
    if (!message || !isJoinLeaveServiceMessage(message)) {
      return next();
    }

    const chatId = String(ctx.chat?.id || "");
    if (!chatIds.has(chatId)) {
      return next();
    }

    try {
      await ctx.deleteMessage();
    } catch (error) {
      logger.warn(
        "Failed to delete join/leave service message",
        chatId,
        error?.response?.description || error.message
      );
    }
  });
}

module.exports = { registerServiceMessageHandlers };
