#!/usr/bin/env node
/**
 * Upload assets/brand/emojids/*.png as Discord application emojis.
 * Usage: node scripts/upload-discord-emojis.js
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits } = require("discord.js");

const ROOT = path.join(__dirname, "..");
const DIR = path.join(ROOT, "assets", "brand", "emojids");
const OUT = path.join(ROOT, "src", "discord", "emojiMap.json");

async function main() {
  const token = String(process.env.DISCORD_BOT_TOKEN || process.env.TOKEN_DISCORD || "").trim();
  if (!token) throw new Error("DISCORD_BOT_TOKEN is empty");

  const files = fs
    .readdirSync(DIR)
    .filter((f) => /\.png$/i.test(f))
    .sort();
  if (!files.length) throw new Error(`No png files in ${DIR}`);

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(token);
  await client.application.fetch();

  const existing = await client.application.emojis.fetch();
  const byName = new Map();
  for (const emoji of existing.values()) byName.set(emoji.name, emoji);

  const map = {};
  for (const file of files) {
    const name = path.basename(file, path.extname(file)).toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (name.length < 2) {
      console.warn("skip invalid name", file);
      continue;
    }
    const attachment = path.join(DIR, file);
    let emoji = byName.get(name);
    if (emoji) {
      console.log(`exists :${name}: ${emoji.id}`);
    } else {
      emoji = await client.application.emojis.create({ attachment, name });
      console.log(`created :${name}: ${emoji.id}`);
      byName.set(name, emoji);
    }
    map[name] = { id: emoji.id, name: emoji.name };
  }

  fs.writeFileSync(OUT, `${JSON.stringify(map, null, 2)}\n`, "utf8");
  console.log(`wrote ${OUT} (${Object.keys(map).length} emojis)`);
  await client.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
