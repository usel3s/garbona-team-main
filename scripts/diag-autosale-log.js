#!/usr/bin/env node
/** Diagnose why a log was not auto-sold. Usage: node scripts/diag-autosale-log.js 829238 */
require("../src/config/env");
const mongoose = require("mongoose");
const { env } = require("../src/config/env");
const SteamLog = require("../src/models/SteamLog");
const User = require("../src/models/User");
const { shouldEnqueueAutoSell } = require("../src/services/autoLogSaleService");

async function main() {
  const sourceId = String(process.argv[2] || "").trim();
  if (!/^\d+$/.test(sourceId)) {
    throw new Error("Usage: node scripts/diag-autosale-log.js <sourceId>");
  }

  await mongoose.connect(env.mongoUri);
  const log = await SteamLog.findOne({ sourceId }).lean();
  if (!log) {
    console.log(JSON.stringify({ ok: false, error: "SteamLog not found", sourceId }, null, 2));
    return;
  }

  const ownerTg = String(log.ownerTelegramId || "").trim();
  const user = ownerTg ? await User.findOne({ telegramId: ownerTg }).lean() : null;

  const checks = {
    logKindValid: log.logKind === "valid",
    statusProcessed: log.status === "processed",
    autoSaleStatus: log.autoSaleStatus || "none",
    convertedFromMafile: Boolean(log.convertedFromMafile),
    mafileAutoConvertTaskId: log.mafileAutoConvertTaskId || "",
    ownerTelegramId: ownerTg,
    userFound: Boolean(user),
    autoSellLogs: user?.autoSellLogs,
    autoSellLogsEnabled: user?.autoSellLogs !== false,
    shouldEnqueue: shouldEnqueueAutoSell(log, user),
  };

  console.log(JSON.stringify({
    ok: true,
    sourceId,
    log: {
      sourceId: log.sourceId,
      logKind: log.logKind,
      status: log.status,
      accountStatus: log.accountStatus,
      autoSaleStatus: log.autoSaleStatus,
      autoSaleError: log.autoSaleError,
      autoSaleTaskId: log.autoSaleTaskId,
      convertedFromMafile: log.convertedFromMafile,
      mafileAutoConvertTaskId: log.mafileAutoConvertTaskId,
      ownerTelegramId: log.ownerTelegramId,
      createdAt: log.createdAt,
      updatedAt: log.updatedAt,
    },
    user: user
      ? {
          telegramId: user.telegramId,
          username: user.username,
          autoSellLogs: user.autoSellLogs,
          panelUsername: user.panelUsername,
        }
      : null,
    checks,
  }, null, 2));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
