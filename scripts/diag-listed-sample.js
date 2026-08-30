require("../src/config/env");
const mongoose = require("mongoose");
const { env } = require("../src/config/env");
const SteamLog = require("../src/models/SteamLog");
const { getItem, classifyLztSaleState, fetchActiveClaimByItemId } = require("../src/services/lztMarketService");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const limit = Number(process.argv[2] || 60);
  await mongoose.connect(env.mongoUri);
  let claimMap = new Map();
  try { claimMap = await fetchActiveClaimByItemId(); } catch (_) {}

  const logs = await SteamLog.find({ autoSaleStatus: "listed", lztItemId: { $ne: "" } })
    .sort({ updatedAt: -1 }).limit(limit).select("sourceId lztItemId").lean();

  const tally = { listed: 0, released: 0, sold_held: 0, terminal_unsold: 0, unknown: 0, not_found: 0, active_claim: 0, error: 0 };
  const mismatches = [];
  for (const l of logs) {
    const itemId = String(l.lztItemId);
    if (claimMap.has(itemId)) { tally.active_claim++; mismatches.push([l.sourceId, "active_claim"]); await sleep(200); continue; }
    try {
      const item = await getItem(itemId);
      const phase = classifyLztSaleState(item);
      tally[phase] = (tally[phase] || 0) + 1;
      if (phase !== "listed") mismatches.push([l.sourceId, phase, item.item_state]);
    } catch (e) {
      if (e.code === "LZT_NOT_FOUND") { tally.not_found++; mismatches.push([l.sourceId, "not_found"]); }
      else { tally.error++; mismatches.push([l.sourceId, "error", e.code || e.message]); }
    }
    await sleep(220);
  }

  console.log(`Sampled ${logs.length} DB-'listed' lots (oldest first). Live LZT phase tally:`);
  console.log(JSON.stringify(tally, null, 2));
  const wrong = mismatches.filter((m) => m[1] !== "listed");
  console.log(`\nLots whose real state != listed: ${wrong.length}/${logs.length}`);
  for (const m of wrong.slice(0, 40)) console.log("  " + m.join("  "));

  await mongoose.disconnect();
}
main().catch(async (e) => { console.error(e.stack || e.message); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
