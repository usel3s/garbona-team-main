#!/usr/bin/env node
/** Full autosale diagnostic: DB + UProject task + account. */
require("../src/config/env");
const mongoose = require("mongoose");
const { env } = require("../src/config/env");
const SteamLog = require("../src/models/SteamLog");
const { getSteamTask, getSteamAccountById } = require("../src/services/steamApiService");

async function main() {
  const sourceId = String(process.argv[2] || "").trim();
  if (!/^\d+$/.test(sourceId)) {
    throw new Error("Usage: node scripts/diag-autosale-detail.js <sourceId>");
  }

  await mongoose.connect(env.mongoUri);
  const log = await SteamLog.findOne({ sourceId }).lean();
  if (!log) {
    console.log(JSON.stringify({ ok: false, error: "not found" }, null, 2));
    return;
  }

  let task = null;
  let account = null;
  let taskError = null;
  let accountError = null;

  if (log.autoSaleTaskId) {
    try {
      task = await getSteamTask(log.autoSaleTaskId);
    } catch (e) {
      taskError = String(e.message || e);
    }
  }

  try {
    account = await getSteamAccountById(null, sourceId);
  } catch (e) {
    accountError = String(e.message || e);
  }

  console.log(JSON.stringify({
    ok: true,
    sourceId,
    autoSaleStatus: log.autoSaleStatus,
    autoSaleError: log.autoSaleError,
    autoSaleTaskId: log.autoSaleTaskId,
    lztItemId: log.lztItemId,
    lztMarketUrl: log.lztMarketUrl,
    task,
    taskError,
    account: account
      ? {
          id: account.id ?? account._id,
          status: account.status ?? account.accountStatus,
          lztLinkId: account.lztLinkId ?? account.lzt_link_id,
          lztItemId: account.lztItemId,
          isMaFile: account.isMaFile,
        }
      : null,
    accountError,
  }, null, 2));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
