#!/usr/bin/env node
/**
 * Compare 24h arrival KPI: old (totalProfit) vs new (balance+inventory, deduped).
 * Usage: node scripts/diag-arrivals-24h.js
 */
require("../src/config/env");
const mongoose = require("mongoose");
const { env } = require("../src/config/env");
const SteamLog = require("../src/models/SteamLog");
const {
  foldUniqueRows,
  tallyRows,
  arrivalValueUsd,
} = require("../src/services/adminOverviewService");

function oldValueUsd(doc) {
  const balance = Number(doc.balanceUsd || 0);
  const inventory = Number(doc.inventoryUsd || 0);
  const totalProfit = Number(doc.totalProfit || 0);
  const base = balance + inventory;
  return Number((totalProfit > 0 ? totalProfit : base).toFixed(2));
}

async function main() {
  await mongoose.connect(env.mongoUri);
  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const rows = await SteamLog.find({
    logKind: { $in: ["valid", "mafile"] },
    createdAt: { $gte: last24h, $lte: now },
  })
    .select("sourceId logKind balanceUsd inventoryUsd totalProfit createdAt")
    .sort({ createdAt: 1 })
    .lean();

  const unique = foldUniqueRows(rows);
  const newStats = tallyRows(rows);

  let oldTotal = 0;
  let profitOverrides = 0;
  let balanceSum = 0;
  let inventorySum = 0;
  for (const row of unique) {
    const base = Number(row.balanceUsd || 0) + Number(row.inventoryUsd || 0);
    const profit = Number(row.totalProfit || 0);
    if (profit > base + 0.01) profitOverrides += 1;
    oldTotal += oldValueUsd(row);
    balanceSum += Number(row.balanceUsd || 0);
    inventorySum += Number(row.inventoryUsd || 0);
  }

  const duplicateSourceIds = rows.length - unique.length;
  const mafileNow = unique.filter((r) => r.logKind === "mafile").length;
  const validNow = unique.filter((r) => r.logKind === "valid").length;

  console.log(JSON.stringify({
    window: { from: last24h.toISOString(), to: now.toISOString() },
    rawRows: rows.length,
    uniqueIds: unique.length,
    duplicateRowsBySourceId: duplicateSourceIds,
    counts: { valid: validNow, mafile: mafileNow, total: unique.length },
    sums: {
      oldLogicUsd: Number(oldTotal.toFixed(2)),
      newLogicUsd: newStats.totalUsd,
      deltaUsd: Number((oldTotal - newStats.totalUsd).toFixed(2)),
      balanceUsd: Number(balanceSum.toFixed(2)),
      inventoryUsd: Number(inventorySum.toFixed(2)),
      avgPerIdUsd: unique.length ? Number((newStats.totalUsd / unique.length).toFixed(2)) : 0,
    },
    profitOverridesCount: profitOverrides,
    note: duplicateSourceIds
      ? "Есть строки с одинаковым sourceId — dedupe берёт самую раннюю createdAt"
      : "Дублей sourceId нет — MaFile→лог не создаёт вторую запись (unique index)",
  }, null, 2));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
