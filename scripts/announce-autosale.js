/**
 * One-shot: Telegram broadcast + panel notification about auto log sale.
 *
 * Usage: node scripts/announce-autosale.js
 */
const mongoose = require("mongoose");
const { Telegraf } = require("telegraf");
const { env, validateEnv } = require("../src/config/env");
const { connectDatabase } = require("../src/config/db");
const { announceAutosaleFeature } = require("../src/services/autosaleAnnounceService");

async function main() {
  validateEnv();
  await connectDatabase();

  const bot = new Telegraf(env.botToken);
  const result = await announceAutosaleFeature(bot.telegram, {
    adminTelegramId: "announce-autosale-script",
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        broadcast: result.broadcast,
        notification: result.notification,
        telegramHtml: result.telegramHtml,
      },
      null,
      2
    )}\n`
  );
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
