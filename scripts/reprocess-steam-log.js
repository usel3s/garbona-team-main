/**
 * One-shot: reprocess a stuck MaFile/log into DM + profit channel.
 * Usage: node scripts/reprocess-steam-log.js 822469
 */
require("dotenv").config();
const { Telegraf } = require("telegraf");
const mongoose = require("mongoose");
const { env } = require("../src/config/env");
const SteamLog = require("../src/models/SteamLog");
const { getSteamAccounts, getSteamAccountById } = require("../src/services/steamApiService");
const { recheckSteamId } = require("../src/services/steamMonitorService");

function step(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main() {
  const sourceId = String(process.argv[2] || "").trim();
  if (!/^\d+$/.test(sourceId)) {
    throw new Error("Usage: node scripts/reprocess-steam-log.js <sourceId>");
  }
  if (!env.botToken) throw new Error("BOT_TOKEN missing");
  step("mongo connect");
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  step("telegraf init");
  const bot = new Telegraf(env.botToken);
  step("load existing steam log");
  const before = await SteamLog.findOne({ sourceId }).lean();
  console.log("before", JSON.stringify({
    status: before?.status,
    dm: before?.dmMessageId,
    channel: before?.channelMessageId,
    error: before?.errorMessage,
  }));
  step("team accounts list");
  const payload = await getSteamAccounts(null, { offset: 0, limit: 100 });
  const account = (payload?.rows || []).find((row) => String(row.id) === String(sourceId));
  console.log("found_in_list", Boolean(account), "rows", (payload?.rows || []).length);
  if (!account) {
    step("fallback getSteamAccountById");
    try {
      const raw = await getSteamAccountById(null, sourceId);
      console.log("byId keys", Object.keys(raw || {}));
    } catch (error) {
      console.log("byId error", error?.response?.status || error.message);
    }
  }
  step("recheckSteamId start");
  const log = await recheckSteamId(bot, sourceId);
  step("recheckSteamId done");
  console.log(
    JSON.stringify(
      {
        sourceId: log.sourceId,
        status: log.status,
        logKind: log.logKind,
        ownerTelegramId: log.ownerTelegramId,
        dmMessageId: log.dmMessageId || "",
        channelMessageId: log.channelMessageId || "",
        adminChannelMessageId: log.adminChannelMessageId || "",
        errorMessage: log.errorMessage || "",
        totalProfit: log.totalProfit,
      },
      null,
      2
    )
  );
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("FATAL", error?.response?.data || error.message || error);
  try {
    await mongoose.disconnect();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
