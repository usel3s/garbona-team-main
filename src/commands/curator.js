const { renderBranchesHome } = require("../handlers/branchHandler");

async function renderCurators(ctx) {
  return renderBranchesHome(ctx);
}

function registerCuratorCommand(bot) {
  bot.command("curator", async (ctx) => {
    await renderCurators(ctx);
  });
  bot.command("curators", async (ctx) => {
    await renderCurators(ctx);
  });
}

module.exports = { registerCuratorCommand, renderCurators };
