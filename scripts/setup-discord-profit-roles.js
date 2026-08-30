#!/usr/bin/env node
/**
 * Create Copper / Silver / Gold profit roles and sync members.
 * Usage: node scripts/setup-discord-profit-roles.js [--apply]
 */
require("dotenv").config();
const mongoose = require("mongoose");
const { Client, GatewayIntentBits } = require("discord.js");
const { env, validateEnv } = require("../src/config/env");
const { ensureProfitRoles, reconcileProfitRoles, PROFIT_TIERS } = require("../src/discord/profitRoles");

const APPLY = process.argv.includes("--apply");

async function main() {
  validateEnv();
  if (!env.discordBotToken || !env.discordGuildId) {
    throw new Error("DISCORD_BOT_TOKEN / DISCORD_GUILD_ID required");
  }

  console.log({
    apply: APPLY,
    tiers: PROFIT_TIERS.map((t) => ({
      name: t.name,
      minUsd: t.minUsd(),
      roleId: t.roleId() || "(create)",
    })),
  });

  if (!APPLY) {
    console.log("Dry run. Pass --apply to create roles and sync members.");
    return;
  }

  await mongoose.connect(env.mongoUri);

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });
  await client.login(env.discordBotToken);
  await new Promise((r) => client.once("clientReady", r));

  const guild = await client.guilds.fetch(env.discordGuildId);
  const created = await ensureProfitRoles(guild, { configure: true });
  console.log("Roles:", created);

  const { setDiscordClient } = require("../src/discord/runtime");
  setDiscordClient(client);
  const sync = await reconcileProfitRoles(client);
  console.log("Sync:", sync);

  await client.destroy();
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
