#!/usr/bin/env node
require("dotenv").config();
const mongoose = require("mongoose");
const { Client, GatewayIntentBits } = require("discord.js");
const { env } = require("../src/config/env");
const { supportChannelId, buildSupportPanelPayload } = require("../src/discord/support");
const AppSettings = require("../src/models/AppSettings");

async function main() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(env.discordBotToken);
  await new Promise((r) => client.once("clientReady", r));

  const channel = await client.channels.fetch(supportChannelId());
  const payload = await buildSupportPanelPayload(channel.guildId);
  const row = await AppSettings.findOne({ key: "discord_support_panel_message_id" }).lean();
  const messageId = String(row?.valueString || "").trim();

  if (messageId) {
    try {
      const msg = await channel.messages.fetch(messageId);
      await msg.edit({
        content: null,
        embeds: payload.embeds,
        components: payload.components,
        attachments: [],
      });
      console.log("edited", messageId);
      await client.destroy();
      await mongoose.disconnect();
      return;
    } catch (error) {
      console.warn("edit failed", error.message);
    }
  }

  const sent = await channel.send(payload);
  await AppSettings.findOneAndUpdate(
    { key: "discord_support_panel_message_id" },
    { $set: { valueString: String(sent.id), valueNumber: null } },
    { upsert: true }
  );
  console.log("posted", sent.id);
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
