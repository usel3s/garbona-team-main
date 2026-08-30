require("../src/config/env");
const mongoose = require("mongoose");
const { env } = require("../src/config/env");
const SteamLog = require("../src/models/SteamLog");

async function main() {
  await mongoose.connect(env.mongoUri);

  const byStatus = await SteamLog.aggregate([
    { $group: { _id: "$autoSaleStatus", count: { $sum: 1 }, maxUpdated: { $max: "$updatedAt" } } },
    { $sort: { count: -1 } },
  ]);
  console.log("autoSaleStatus distribution (count | most recent updatedAt):");
  for (const r of byStatus) {
    console.log(`  ${String(r._id || "(none)").padEnd(16)} ${String(r.count).padStart(6)}  ${r.maxUpdated ? r.maxUpdated.toISOString() : "-"}`);
  }

  // How many "listed" have a lztItemId and would be polled
  const listedWithItem = await SteamLog.countDocuments({ autoSaleStatus: "listed", lztItemId: { $ne: "" } });
  console.log(`\nlisted with lztItemId: ${listedWithItem}`);

  // updatedAt histogram for listed
  const listedRecent = await SteamLog.find({ autoSaleStatus: "listed" })
    .sort({ updatedAt: -1 }).limit(5).select("sourceId updatedAt lztItemId").lean();
  console.log("\n5 most-recently-updated 'listed' logs:");
  for (const l of listedRecent) console.log(`  ${l.sourceId}  ${l.updatedAt.toISOString()}  item=${l.lztItemId}`);

  const listedOldest = await SteamLog.find({ autoSaleStatus: "listed" })
    .sort({ updatedAt: 1 }).limit(5).select("sourceId updatedAt lztItemId").lean();
  console.log("\n5 oldest 'listed' logs:");
  for (const l of listedOldest) console.log(`  ${l.sourceId}  ${l.updatedAt.toISOString()}  item=${l.lztItemId}`);

  // Any evidence the poller ever wrote terminal states recently?
  const recentTerminal = await SteamLog.find({ autoSaleStatus: { $in: ["sold_held", "released", "refunded", "failed", "arbitration"] } })
    .sort({ updatedAt: -1 }).limit(5).select("sourceId autoSaleStatus updatedAt").lean();
  console.log("\n5 most-recent terminal/held autosale writes:");
  for (const l of recentTerminal) console.log(`  ${l.sourceId}  ${l.autoSaleStatus}  ${l.updatedAt.toISOString()}`);

  await mongoose.disconnect();
}
main().catch(async (e) => { console.error(e.stack || e.message); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
