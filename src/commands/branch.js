const { renderBranchesHome } = require("../handlers/branchHandler");

function registerBranchCommand(bot) {
  bot.command("branch", async (ctx) => {
    await renderBranchesHome(ctx);
  });
  bot.command("branches", async (ctx) => {
    await renderBranchesHome(ctx);
  });
}

module.exports = { registerBranchCommand, renderBranchesHome };
