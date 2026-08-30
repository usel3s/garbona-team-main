#!/usr/bin/env node
/**
 * List Discord guild channels (id, type, name, parent, topic).
 * Usage: node scripts/list-discord-channels.js
 */
require("dotenv").config();
const { Client, GatewayIntentBits, ChannelType } = require("discord.js");
const { env } = require("../src/config/env");

const TYPE = {
  [ChannelType.GuildText]: "text",
  [ChannelType.GuildVoice]: "voice",
  [ChannelType.GuildCategory]: "category",
  [ChannelType.GuildAnnouncement]: "news",
  [ChannelType.GuildForum]: "forum",
  [ChannelType.GuildStageVoice]: "stage",
};

async function main() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(env.discordBotToken);
  await new Promise((r) => client.once("clientReady", r));
  const guild = await client.guilds.fetch(env.discordGuildId);
  const channels = await guild.channels.fetch();
  const rows = [...channels.values()]
    .filter(Boolean)
    .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))
    .map((ch) => ({
      id: ch.id,
      type: TYPE[ch.type] || String(ch.type),
      name: ch.name,
      parent: ch.parent?.name || "",
      topic: ch.topic || "",
    }));
  console.log(JSON.stringify(rows, null, 2));
  await client.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
