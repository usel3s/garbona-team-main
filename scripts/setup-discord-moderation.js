#!/usr/bin/env node
/**
 * Create Ban role, appeal channel, permission overwrites, appeal embed.
 * Usage: node scripts/setup-discord-moderation.js [--apply]
 */
require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { env } = require("../src/config/env");
const { ensureModerationSetup } = require("../src/discord/modSetup");

const APPLY = process.argv.includes("--apply");

async function main() {
  if (!env.discordBotToken || !env.discordGuildId) {
    throw new Error("DISCORD_BOT_TOKEN / DISCORD_GUILD_ID required");
  }
  if (!APPLY) {
    console.log("Dry run. Pass --apply to create Ban role + appeal channel and update .env");
    console.log({
      modRoleId: env.discordModRoleId,
      fameRoleId: env.discordFameRoleId,
      banRoleId: env.discordBanRoleId || "(will create)",
      appealChannelId: env.discordAppealChannelId || "(will create)",
    });
    return;
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(env.discordBotToken);
  await new Promise((r) => client.once("clientReady", r));

  const guild = await client.guilds.fetch(env.discordGuildId);
  const result = await ensureModerationSetup(guild, { publishPanel: true });
  console.log("Moderation setup done:", result);
  console.log("Wrote DISCORD_BAN_ROLE_ID / DISCORD_APPEAL_CHANNEL_ID to .env — sync VPS env if needed.");
  await client.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
