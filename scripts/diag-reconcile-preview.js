/**
 * READ-ONLY preview of reconciling all stuck autoSaleStatus:"listed" lots
 * against live LZT. Writes NOTHING. Shows what pollLztStatus would do and the
 * financial credit that a real reconcile would create.
 *
 * Usage: node scripts/diag-reconcile-preview.js
 */
require("../src/config/env");
const mongoose = require("mongoose");
const { env } = require("../src/config/env");
const SteamLog = require("../src/models/SteamLog");
const User = require("../src/models/User");
const { getItem, classifyLztSaleState, resolveSaleAmounts, fetchActiveClaimByItemId } = require("../src/services/lztMarketService");
const { getUsdRubRate } = require("../src/services/settingsService");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (n) => Number(Number(n || 0).toFixed(2));

async function main() {
  await mongoose.connect(env.mongoUri);
  const rate = await getUsdRubRate().catch(() => 90);
  let claimMap = new Map();
  try { claimMap = await fetchActiveClaimByItemId(); } catch (_) {}

  const logs = await SteamLog.find({ autoSaleStatus: "listed", lztItemId: { $ne: "" } })
    .sort({ updatedAt: -1 })
    .select("sourceId ownerTelegramId lztItemId autoSaleGrossUsd autoSaleProfitTxId").lean();

  const userPct = new Map();
  async function pct(tg) {
    const k = String(tg || "");
    if (userPct.has(k)) return userPct.get(k);
    const u = k ? await User.findOne({ telegramId: k }).select("profitPercent").lean() : null;
    const p = Math.max(1, Math.min(100, Number(u?.profitPercent) || 70));
    userPct.set(k, p);
    return p;
  }

  const outcome = { stay_listed: 0, to_released: 0, to_sold_held: 0, to_arbitration: 0, to_failed: 0, unknown: 0, error: 0 };
  let creditAvailable = 0, creditFrozen = 0, workersCredited = 0;
  const byUser = new Map();
  const samples = { to_failed: [], to_released: [], to_sold_held: [] };

  let done = 0;
  for (const l of logs) {
    const itemId = String(l.lztItemId);
    try {
      if (claimMap.has(itemId)) { outcome.to_arbitration++; await sleep(160); done++; continue; }
      const item = await getItem(itemId);
      const phase = classifyLztSaleState(item);
      if (phase === "listed") outcome.stay_listed++;
      else if (phase === "terminal_unsold") { outcome.to_failed++; if (samples.to_failed.length < 8) samples.to_failed.push(l.sourceId); }
      else if (phase === "released" || phase === "sold_held") {
        outcome[phase === "released" ? "to_released" : "to_sold_held"]++;
        if (samples[phase === "released" ? "to_released" : "to_sold_held"].length < 8) samples[phase === "released" ? "to_released" : "to_sold_held"].push(l.sourceId);
        if (!String(l.autoSaleProfitTxId || "").trim()) {
          const { grossUsd } = resolveSaleAmounts(item, rate);
          const p = await pct(l.ownerTelegramId);
          const share = r2((grossUsd * p) / 100);
          if (share > 0) {
            workersCredited++;
            if (phase === "released") creditAvailable = r2(creditAvailable + share);
            else creditFrozen = r2(creditFrozen + share);
            const e = byUser.get(String(l.ownerTelegramId)) || { logs: 0, usd: 0 };
            e.logs++; e.usd = r2(e.usd + share);
            byUser.set(String(l.ownerTelegramId), e);
          }
        }
      } else outcome.unknown++;
    } catch (e) {
      if (e.code === "LZT_NOT_FOUND") { outcome.to_failed++; if (samples.to_failed.length < 8) samples.to_failed.push(l.sourceId); }
      else outcome.error++;
    }
    await sleep(180);
    if (++done % 40 === 0) console.error(`  …${done}/${logs.length}`);
  }

  console.log(`Stuck 'listed' lots checked: ${logs.length}  (USD/RUB rate ${rate})`);
  console.log("Would transition to:");
  console.log(JSON.stringify(outcome, null, 2));
  console.log(`\nWorkers credited (new): ${workersCredited} lots`);
  console.log(`  → available (released):  $${creditAvailable}`);
  console.log(`  → frozen/hold (sold):    $${creditFrozen}`);
  console.log(`  → TOTAL new credit:      $${r2(creditAvailable + creditFrozen)}`);
  console.log("\nPer-user new credit:");
  for (const [tg, e] of [...byUser.entries()].sort((a, b) => b[1].usd - a[1].usd)) {
    console.log(`  ${tg.padEnd(14)} ${String(e.logs).padStart(3)} lots  $${e.usd}`);
  }
  console.log("\nSample sourceIds:");
  for (const k of Object.keys(samples)) console.log(`  ${k}: ${samples[k].join(", ")}`);

  await mongoose.disconnect();
}
main().catch(async (e) => { console.error(e.stack || e.message); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
