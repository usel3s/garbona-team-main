#!/usr/bin/env node
/**
 * One-shot: TG broadcast + panel notify about Discord open.
 * Usage: node scripts/announce-discord-open.js [--dry]
 */
require("dotenv").config();
const mongoose = require("mongoose");
const { Telegraf } = require("telegraf");
const { env, validateEnv } = require("../src/config/env");
const {
  announceDiscordServer,
  buildDiscordAnnounceHtml,
  discordInviteUrl,
} = require("../src/services/discordAnnounceService");

const DRY = process.argv.includes("--dry");

async function main() {
  validateEnv();
  console.log("Invite:", discordInviteUrl());
  if (DRY) {
    console.log("--- dry run HTML ---\n" + buildDiscordAnnounceHtml());
    return;
  }

  await mongoose.connect(env.mongoUri);
  const bot = new Telegraf(env.botToken);
  const result = await announceDiscordServer(bot.telegram, { adminTelegramId: "script" });
  console.log(JSON.stringify(result, null, 2));
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
