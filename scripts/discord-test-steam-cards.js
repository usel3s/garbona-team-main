#!/usr/bin/env node
/**
 * Post test Steam log / MaFile cards to Discord arrival channel.
 * Usage: node scripts/discord-test-steam-cards.js 827990 828109
 */
require("dotenv").config();
const mongoose = require("mongoose");
const { Client, GatewayIntentBits } = require("discord.js");
const { env } = require("../src/config/env");
const SteamLog = require("../src/models/SteamLog");
const { getSteamAccountById } = require("../src/services/steamApiService");
const {
  classifyAccountLog,
  buildAdminLogPhoto,
  buildAdminMaFilePhoto,
} = require("../src/services/steamLogAdminService");
const { setDiscordClient } = require("../src/discord/runtime");
const { notifyDiscordSteamCard } = require("../src/discord/steamLogNotify");

function unwrapAccount(raw) {
  if (!raw || typeof raw !== "object") return raw;
  return raw.data || raw.account || raw.result || raw;
}

async function postOne(sourceId) {
  const id = String(sourceId).trim();
  console.log(`\n=== ${id} ===`);
  const log = await SteamLog.findOne({ sourceId: id }).lean();
  let account = null;
  try {
    account = unwrapAccount(await getSteamAccountById(null, id));
  } catch (error) {
    console.warn("getSteamAccountById failed", error.message);
  }
  if (!account && log) {
    account = {
      id,
      username: log.accountUsername,
      steamInfo: {
        nickname: log.accountUsername,
        balanceUsd: log.balanceUsd,
      },
      inventory: { totalUsd: log.inventoryUsd },
      status: log.logKind === "mafile" ? "MaFile" : "Ok",
    };
  }
  if (!account) throw new Error(`Account ${id} not found`);

  const kind =
    log?.logKind === "mafile" || log?.logKind === "valid"
      ? log.logKind
      : classifyAccountLog(account) === "mafile"
        ? "mafile"
        : "valid";

  let imageBuffer = null;
  if (kind === "mafile") {
    const built = await buildAdminMaFilePhoto(account, { enrich: true, returnSnapshot: true });
    imageBuffer = built?.imageBuffer || built;
    if (built?.snapshot) {
      account = { ...account, ...built.snapshot };
    }
  } else {
    imageBuffer = await buildAdminLogPhoto(account);
  }
  if (!Buffer.isBuffer(imageBuffer)) {
    throw new Error(`Failed to render image for ${id}`);
  }

  const total =
    kind === "mafile"
      ? Number(account?.inventory?.totalUsd || log?.totalProfit || 0) +
        Number(account?.steamInfo?.balanceUsd || log?.balanceUsd || 0)
      : Number(log?.totalProfit || account?.inventory?.totalUsd || 0) +
        Number(account?.steamInfo?.balanceUsd || log?.balanceUsd || 0);
  const balanceUsd = Number(
    account?.steamInfo?.balanceUsd ?? log?.balanceUsd ?? 0
  );
  const inventoryUsd = Number(
    account?.inventory?.totalUsd ?? log?.inventoryUsd ?? 0
  );

  const messageId = await notifyDiscordSteamCard({
    kind,
    imageBuffer,
    sourceId: id,
    ownerTelegramId: log?.ownerTelegramId,
    total: Number.isFinite(total) ? total : balanceUsd + inventoryUsd,
    balanceUsd,
    inventoryUsd,
  });
  console.log({ kind, messageId, bytes: imageBuffer.length });

  if (messageId && log) {
    await SteamLog.updateOne(
      { sourceId: id },
      { $set: { discordChannelMessageId: messageId } }
    );
  }
  return messageId;
}

async function main() {
  const ids = process.argv.slice(2).filter((x) => /^\d+$/.test(x));
  if (!ids.length) {
    throw new Error("Usage: node scripts/discord-test-steam-cards.js <id> [id...]");
  }
  if (!env.discordBotToken) throw new Error("DISCORD_BOT_TOKEN missing");

  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(env.discordBotToken);
  await new Promise((resolve) => client.once("ready", resolve));
  setDiscordClient(client);

  for (const id of ids) {
    await postOne(id);
  }

  setDiscordClient(null);
  await client.destroy();
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("FATAL", error);
  try {
    await mongoose.disconnect();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
