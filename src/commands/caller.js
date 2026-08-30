const { upsertBotMessage } = require("../utils/message");
const { callersIntroHtml, callersIntroKeyboard } = require("../utils/callersUi");

async function renderCallers(ctx) {
  return upsertBotMessage(ctx, callersIntroHtml(), {
    reply_markup: callersIntroKeyboard().reply_markup,
  });
}

function registerCallerCommand(bot) {
  bot.command("caller", async (ctx) => {
    await renderCallers(ctx);
  });
  bot.command("callers", async (ctx) => {
    await renderCallers(ctx);
  });
}

module.exports = { registerCallerCommand, renderCallers };
