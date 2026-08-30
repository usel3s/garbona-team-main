/**
 * One-shot: send daily arrival digest to admin Telegram.
 *
 * Usage: node scripts/send-daily-arrival-digest.js [--force]
 */
const mongoose = require("mongoose");
const { Telegraf } = require("telegraf");
const { env, validateEnv } = require("../src/config/env");
const { connectDatabase } = require("../src/config/db");
const { sendDailyArrivalDigest } = require("../src/services/dailyArrivalDigestService");

async function main() {
  validateEnv();
  await connectDatabase();

  const force = process.argv.includes("--force");
  const dayOffset = process.argv.includes("--yesterday") ? -1 : 0;
  const bot = new Telegraf(env.botToken);
  const result = await sendDailyArrivalDigest(bot.telegram, { force, dayOffset });

  process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
