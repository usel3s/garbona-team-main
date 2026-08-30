#!/usr/bin/env node
/**
 * Diagnose status mismatch: compare DB SteamLog.autoSaleStatus / accountStatus
 * with the LIVE LZT lot state (item_state, guarantee, active claims).
 *
 * Usage: node scripts/diag-status-mismatch.js 837047 836764 836148
 */
require("../src/config/env");
const mongoose = require("mongoose");
const { env } = require("../src/config/env");
const SteamLog = require("../src/models/SteamLog");
const {
  getItem,
  classifyLztSaleState,
  fetchActiveClaimByItemId,
} = require("../src/services/lztMarketService");
const { autoSaleActivityStatus } = require("../src/services/steamLogStatusService");

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k];
  return out;
}

async function main() {
  const ids = process.argv.slice(2).map((s) => String(s).trim()).filter(Boolean);
  if (!ids.length) throw new Error("Usage: node scripts/diag-status-mismatch.js <sourceId...>");

  await mongoose.connect(env.mongoUri);

  let claimMap = new Map();
  let claimErr = "";
  try {
    claimMap = await fetchActiveClaimByItemId();
  } catch (e) {
    claimErr = String(e.message || e);
  }
  console.log(`LZT base: ${env.lztMarketApiBase} | token set: ${Boolean(env.lztMarketToken)}`);
  console.log(`Active claims fetched: ${claimMap.size}${claimErr ? " (err: " + claimErr + ")" : ""}`);
  console.log("=".repeat(80));

  for (const sourceId of ids) {
    const log = await SteamLog.findOne({ sourceId }).lean();
    console.log(`\n### sourceId ${sourceId}`);
    if (!log) {
      console.log("  NOT FOUND in DB");
      continue;
    }
    console.log("  DB:", JSON.stringify(pick(log, [
      "logKind", "status", "accountStatus", "autoSaleStatus", "autoSaleError",
      "lztItemId", "lztMarketUrl", "autoSaleProfitTxId", "autoSaleWorkerShareUsd",
      "autoSaleGrossUsd", "autoSaleClaimThreadId", "saleStatus", "processStatus",
      "autoSaleHoldUntil", "autoSaleSoldAt", "autoSaleReleasedAt", "updatedAt",
    ])));
    console.log("  display label (autoSaleActivityStatus):", JSON.stringify(autoSaleActivityStatus(log.autoSaleStatus)));

    const itemId = String(log.lztItemId || "").trim();
    if (!itemId) {
      console.log("  LZT: no lztItemId on log");
      continue;
    }
    const claim = claimMap.get(itemId);
    console.log("  active claim (arbitration):", claim ? JSON.stringify(claim) : "none");

    try {
      const item = await getItem(itemId);
      const phase = classifyLztSaleState(item);
      console.log("  LZT item_id:", itemId);
      console.log("  LZT raw:", JSON.stringify(pick(item, [
        "item_id", "item_state", "state", "title", "price", "rub_price",
        "operation_date", "guarantee", "guarantee_duration", "guarantee_until",
        "sold_date", "refunded", "buyer",
      ])));
      console.log("  >> classified phase:", phase);
    } catch (e) {
      console.log("  LZT getItem error:", e.code || "", String(e.message || e));
    }
  }

  console.log("\n" + "=".repeat(80));
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err.stack || err.message);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
