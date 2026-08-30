#!/usr/bin/env node
/**
 * Configure #предложения forum tags + guide thread.
 * Usage: node scripts/setup-discord-suggestions.js [--apply]
 */
require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { env } = require("../src/config/env");
const { ensureSuggestionsForum, SUGGESTION_TAGS, suggestionsChannelId } = require("../src/discord/suggestions");

const APPLY = process.argv.includes("--apply");

async function main() {
  if (!env.discordBotToken || !env.discordGuildId) {
    throw new Error("DISCORD_BOT_TOKEN / DISCORD_GUILD_ID required");
  }
  console.log({
    channelId: suggestionsChannelId(),
    tags: SUGGESTION_TAGS.map((t) => t.name),
    apply: APPLY,
  });
  if (!APPLY) {
    console.log("Dry run. Pass --apply to update forum tags and post guide.");
    return;
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(env.discordBotToken);
  await new Promise((r) => client.once("clientReady", r));
  const guild = await client.guilds.fetch(env.discordGuildId);
  const result = await ensureSuggestionsForum(guild, { publishGuide: true });
  console.log("Done:", result);
  await client.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
