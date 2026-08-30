#!/usr/bin/env node
/** Recover a falsely failed autosale. Usage: node scripts/recover-autosale-log.js 829238 */
require("../src/config/env");
const mongoose = require("mongoose");
const { env } = require("../src/config/env");
const SteamLog = require("../src/models/SteamLog");
const {
  progressListing,
  recoverFailedAutoSales,
} = require("../src/services/autoLogSaleService");

async function main() {
  const sourceId = String(process.argv[2] || "").trim();
  if (!/^\d+$/.test(sourceId)) {
    throw new Error("Usage: node scripts/recover-autosale-log.js <sourceId>");
  }

  await mongoose.connect(env.mongoUri);
  await recoverFailedAutoSales();

  const log = await SteamLog.findOne({ sourceId });
  if (!log) {
    console.log(JSON.stringify({ ok: false, error: "not found", sourceId }, null, 2));
    return;
  }

  if (log.autoSaleStatus === "listing" || log.autoSaleStatus === "queued") {
    await progressListing(log);
  }

  const fresh = await SteamLog.findOne({ sourceId }).lean();
  console.log(JSON.stringify({
    ok: true,
    sourceId,
    autoSaleStatus: fresh.autoSaleStatus,
    autoSaleError: fresh.autoSaleError,
    lztItemId: fresh.lztItemId,
    lztMarketUrl: fresh.lztMarketUrl,
  }, null, 2));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
