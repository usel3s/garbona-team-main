#!/usr/bin/env node
/**
 * Rename profit roles + post announce embed.
 * Usage: node scripts/announce-profit-roles.js [--channel CHANNEL_ID]
 */
require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { env } = require("../src/config/env");
const {
  ensureProfitRoles,
  publishProfitRolesAnnounce,
  buildProfitRolesAnnounceEmbed,
} = require("../src/discord/profitRoles");

async function main() {
  const channelArg = process.argv.includes("--channel")
    ? process.argv[process.argv.indexOf("--channel") + 1]
    : "";

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(env.discordBotToken);
  await new Promise((r) => client.once("clientReady", r));

  const guild = await client.guilds.fetch(env.discordGuildId);
  await ensureProfitRoles(guild, { configure: true });

  const preview = buildProfitRolesAnnounceEmbed();
  console.log("Preview title:", preview.data.title);
  console.log("Preview desc:\n", preview.data.description);

  const result = await publishProfitRolesAnnounce(client, channelArg || "");
  console.log("Posted:", result);
  await client.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
