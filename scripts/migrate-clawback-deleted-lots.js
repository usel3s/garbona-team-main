/**
 * Claw back worker credits for auto-sales where the LZT lot was deleted or unknown.
 *
 * Usage:
 *   node scripts/migrate-clawback-deleted-lots.js --dry-run
 *   node scripts/migrate-clawback-deleted-lots.js
 *   node scripts/migrate-clawback-deleted-lots.js --user 8640471725
 */
const mongoose = require("mongoose");
const { validateEnv } = require("../src/config/env");
const { connectDatabase } = require("../src/config/db");
const SteamLog = require("../src/models/SteamLog");
const {
  clawbackAutoSaleHold,
  shouldClawbackForLztPhase,
} = require("../src/services/autoLogSaleService");
const {
  getItem,
  classifyLztSaleState,
  fetchActiveClaimByItemId,
} = require("../src/services/lztMarketService");

const CLAWBACK_CANDIDATE_STATUSES = ["sold_held", "arbitration", "released"];
const SLEEP_MS = 300;

function roundUsd(value) {
  return Number(Number(value || 0).toFixed(2));
}

function parseArgs(argv) {
  const args = { dryRun: false, userTelegramId: "" };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--user" && argv[i + 1]) {
      args.userTelegramId = String(argv[++i]).trim();
    }
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveLztPhase(log, claimMap) {
  const itemId = String(log.lztItemId || "").trim();
  if (!itemId) {
    return { phase: "unknown", error: "missing lztItemId" };
  }
  if (claimMap.has(itemId)) {
    return { phase: "active_claim", error: "" };
  }
  try {
    const item = await getItem(itemId);
    return { phase: classifyLztSaleState(item), error: "" };
  } catch (error) {
    if (error.code === "LZT_NOT_FOUND") {
      return { phase: "terminal_unsold", error: "" };
    }
    return { phase: "unknown", error: String(error.message || error) };
  }
}

async function loadCandidateLogs(userTelegramId = "") {
  const filter = {
    autoSaleStatus: { $in: CLAWBACK_CANDIDATE_STATUSES },
    autoSaleProfitTxId: { $ne: "" },
    lztItemId: { $ne: "" },
  };
  if (userTelegramId) {
    filter.ownerTelegramId = String(userTelegramId);
  }
  return SteamLog.find(filter)
    .select(
      "sourceId ownerTelegramId lztItemId autoSaleStatus autoSaleProfitTxId autoSaleWorkerShareUsd autoSaleGrossUsd autoSaleClaimThreadId"
    )
    .sort({ updatedAt: 1 });
}

async function loadStaleDeletedLogs(userTelegramId = "") {
  const filter = {
    autoSaleStatus: "sold_held",
    $or: [{ autoSaleProfitTxId: "" }, { autoSaleProfitTxId: null }],
    lztItemId: { $ne: "" },
  };
  if (userTelegramId) {
    filter.ownerTelegramId = String(userTelegramId);
  }
  return SteamLog.find(filter)
    .select("sourceId ownerTelegramId lztItemId autoSaleStatus autoSaleProfitTxId")
    .sort({ updatedAt: 1 });
}

function fundTypeForStatus(status) {
  return String(status) === "released" ? "available" : "frozen";
}

async function main() {
  const args = parseArgs(process.argv);
  validateEnv();
  await connectDatabase();

  let claimMap = new Map();
  try {
    claimMap = await fetchActiveClaimByItemId();
  } catch (error) {
    console.warn("Claims fetch failed (continuing):", error.message);
  }

  const logs = await loadCandidateLogs(args.userTelegramId);
  const staleLogs = await loadStaleDeletedLogs(args.userTelegramId);
  console.log(`Scanning ${logs.length} credited auto-sale logs…`);
  if (staleLogs.length) {
    console.log(`Checking ${staleLogs.length} stale sold_held logs without profit tx…`);
  }

  const summary = {
    dryRun: args.dryRun,
    scanned: logs.length,
    staleScanned: staleLogs.length,
    eligible: 0,
    clawed: 0,
    staleCleaned: 0,
    skippedClaim: 0,
    skippedPhase: 0,
    errors: 0,
    totalClawedUsd: 0,
    totalFrozenClawedUsd: 0,
    totalAvailableClawedUsd: 0,
    byUser: new Map(),
    rows: [],
  };

  for (const log of logs) {
    const { phase, error: phaseError } = await resolveLztPhase(log, claimMap);
    if (phase === "active_claim") {
      summary.skippedClaim += 1;
      continue;
    }

    const hasProfitTx = Boolean(String(log.autoSaleProfitTxId || "").trim());
    if (!shouldClawbackForLztPhase(phase, log.autoSaleStatus, hasProfitTx)) {
      summary.skippedPhase += 1;
      if (phaseError) {
        summary.rows.push({
          sourceId: log.sourceId,
          status: log.autoSaleStatus,
          phase,
          action: "skip",
          detail: phaseError,
        });
      }
      await sleep(SLEEP_MS);
      continue;
    }

    summary.eligible += 1;
    const share = roundUsd(log.autoSaleWorkerShareUsd);
    const fundType = fundTypeForStatus(log.autoSaleStatus);
    const row = {
      sourceId: String(log.sourceId || ""),
      ownerTelegramId: String(log.ownerTelegramId || ""),
      status: String(log.autoSaleStatus || ""),
      phase,
      shareUsd: share,
      fundType,
      action: args.dryRun ? "dry-run" : "clawback",
      detail: "",
    };

    if (args.dryRun) {
      summary.totalClawedUsd = roundUsd(summary.totalClawedUsd + share);
      if (fundType === "available") {
        summary.totalAvailableClawedUsd = roundUsd(summary.totalAvailableClawedUsd + share);
      } else {
        summary.totalFrozenClawedUsd = roundUsd(summary.totalFrozenClawedUsd + share);
      }
      const userEntry = summary.byUser.get(row.ownerTelegramId) || {
        ownerTelegramId: row.ownerTelegramId,
        logs: 0,
        clawedUsd: 0,
        frozenClawedUsd: 0,
        availableClawedUsd: 0,
      };
      userEntry.logs += 1;
      userEntry.clawedUsd = roundUsd(userEntry.clawedUsd + share);
      if (fundType === "available") {
        userEntry.availableClawedUsd = roundUsd(userEntry.availableClawedUsd + share);
      } else {
        userEntry.frozenClawedUsd = roundUsd(userEntry.frozenClawedUsd + share);
      }
      summary.byUser.set(row.ownerTelegramId, userEntry);
      summary.rows.push(row);
      await sleep(SLEEP_MS);
      continue;
    }

    try {
      const beforeShare = share;
      const beforeFundType = fundType;
      const result = await clawbackAutoSaleHold(log, {
        reason: phase === "unknown" ? "unknown" : "deleted",
        wasArbitration: String(log.autoSaleStatus) === "arbitration",
      });
      if (String(result.autoSaleStatus) !== "refunded") {
        summary.errors += 1;
        row.action = "error";
        row.detail = String(result.autoSaleError || "clawback incomplete");
        summary.rows.push(row);
        await sleep(SLEEP_MS);
        continue;
      }
      summary.clawed += 1;
      summary.totalClawedUsd = roundUsd(summary.totalClawedUsd + beforeShare);
      if (beforeFundType === "available") {
        summary.totalAvailableClawedUsd = roundUsd(summary.totalAvailableClawedUsd + beforeShare);
      } else {
        summary.totalFrozenClawedUsd = roundUsd(summary.totalFrozenClawedUsd + beforeShare);
      }
      const userEntry = summary.byUser.get(row.ownerTelegramId) || {
        ownerTelegramId: row.ownerTelegramId,
        logs: 0,
        clawedUsd: 0,
        frozenClawedUsd: 0,
        availableClawedUsd: 0,
      };
      userEntry.logs += 1;
      userEntry.clawedUsd = roundUsd(userEntry.clawedUsd + beforeShare);
      if (beforeFundType === "available") {
        userEntry.availableClawedUsd = roundUsd(userEntry.availableClawedUsd + beforeShare);
      } else {
        userEntry.frozenClawedUsd = roundUsd(userEntry.frozenClawedUsd + beforeShare);
      }
      summary.byUser.set(row.ownerTelegramId, userEntry);
      summary.rows.push(row);
    } catch (error) {
      summary.errors += 1;
      row.action = "error";
      row.detail = String(error.message || error);
      summary.rows.push(row);
    }
    await sleep(SLEEP_MS);
  }

  for (const log of staleLogs) {
    const { phase, error: phaseError } = await resolveLztPhase(log, claimMap);
    if (phase !== "terminal_unsold") {
      if (phaseError) {
        summary.rows.push({
          sourceId: log.sourceId,
          status: log.autoSaleStatus,
          phase,
          action: "skip-stale",
          detail: phaseError,
        });
      }
      await sleep(SLEEP_MS);
      continue;
    }

    const row = {
      sourceId: String(log.sourceId || ""),
      ownerTelegramId: String(log.ownerTelegramId || ""),
      status: String(log.autoSaleStatus || ""),
      phase,
      shareUsd: 0,
      fundType: "none",
      action: args.dryRun ? "dry-run-stale" : "stale-cleanup",
      detail: "deleted lot, no profit tx",
    };

    if (args.dryRun) {
      summary.staleCleaned += 1;
      summary.rows.push(row);
      await sleep(SLEEP_MS);
      continue;
    }

    try {
      await SteamLog.updateOne(
        { _id: log._id },
        {
          $set: {
            autoSaleStatus: "failed",
            autoSaleError: "Невалид (лот удалён)",
          },
        }
      );
      summary.staleCleaned += 1;
      summary.rows.push(row);
    } catch (error) {
      summary.errors += 1;
      row.action = "error";
      row.detail = String(error.message || error);
      summary.rows.push(row);
    }
    await sleep(SLEEP_MS);
  }

  const users = [...summary.byUser.entries()].map(([telegramId, stats]) => ({
    telegramId,
    ...stats,
  }));

  console.log(
    JSON.stringify(
      {
        dryRun: summary.dryRun,
        scanned: summary.scanned,
        staleScanned: summary.staleScanned,
        eligible: summary.eligible,
        clawed: summary.clawed,
        staleCleaned: summary.staleCleaned,
        skippedClaim: summary.skippedClaim,
        skippedPhase: summary.skippedPhase,
        errors: summary.errors,
        totalClawedUsd: summary.totalClawedUsd,
        totalFrozenClawedUsd: summary.totalFrozenClawedUsd,
        totalAvailableClawedUsd: summary.totalAvailableClawedUsd,
        users,
        rows: summary.rows,
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
