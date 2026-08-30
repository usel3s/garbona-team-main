#!/usr/bin/env node
/** Publish support panel to #поддержка. */
require("dotenv").config();
const mongoose = require("mongoose");
const { Client, GatewayIntentBits } = require("discord.js");
const { env } = require("../src/config/env");
const { supportChannelId, publishSupportPanel } = require("../src/discord/support");

async function main() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(env.discordBotToken);
  await new Promise((r) => client.once("clientReady", r));
  const channel = await client.channels.fetch(supportChannelId());
  const sent = await publishSupportPanel(channel);
  console.log(`posted ${sent.id} → #${channel.name}`);
  await client.destroy();
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
