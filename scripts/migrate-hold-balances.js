/**
 * Migrate legacy auto-sale holds (full gross credited) to worker-share-only model.
 *
 * Usage:
 *   node scripts/migrate-hold-balances.js --analyze
 *   node scripts/migrate-hold-balances.js --dry-run
 *   node scripts/migrate-hold-balances.js
 *   node scripts/migrate-hold-balances.js --user 8640471725
 */
const mongoose = require("mongoose");
const { validateEnv } = require("../src/config/env");
const { connectDatabase } = require("../src/config/db");
const User = require("../src/models/User");
const SteamLog = require("../src/models/SteamLog");
const ProfitTransaction = require("../src/models/ProfitTransaction");
const { isLegacyFullGrossHold } = require("../src/services/autoLogSaleService");
const { workerShareFromGross } = require("../src/services/lztMarketService");
const { getAdminFinanceOverview } = require("../src/services/adminFinanceService");

const ACTIVE_HOLD_STATUSES = ["sold_held", "arbitration"];
const KARMA_CEO_TELEGRAM_ID = "8647494349";
const TOLERANCE = 0.05;

function roundUsd(value) {
  return Number(Number(value || 0).toFixed(2));
}

function parseArgs(argv) {
  const args = { dryRun: false, analyze: false, userTelegramId: "" };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--analyze") args.analyze = true;
    else if (arg === "--user" && argv[i + 1]) {
      args.userTelegramId = String(argv[++i]).trim();
    }
  }
  return args;
}

async function loadActiveHoldLogs(userTelegramId = "") {
  const filter = {
    autoSaleStatus: { $in: ACTIVE_HOLD_STATUSES },
    autoSaleProfitTxId: { $ne: "" },
  };
  if (userTelegramId) {
    filter.ownerTelegramId = String(userTelegramId);
  }
  return SteamLog.find(filter)
    .select(
      "ownerTelegramId sourceId logKind autoSaleGrossUsd autoSaleWorkerShareUsd autoSaleStatus autoSaleProfitTxId"
    )
    .lean();
}

async function buildLegacyHoldPlan(logs) {
  const txIds = [...new Set(logs.map((row) => String(row.autoSaleProfitTxId || "")).filter(Boolean))];
  const txs = txIds.length
    ? await ProfitTransaction.find({ _id: { $in: txIds } })
        .select("_id userId workerShare amount workerPercent")
        .lean()
    : [];
  const txById = new Map(txs.map((tx) => [String(tx._id), tx]));

  const ownerIds = [...new Set(logs.map((row) => String(row.ownerTelegramId || "")).filter(Boolean))];
  const users = ownerIds.length
    ? await User.find({ telegramId: { $in: ownerIds } })
        .select("telegramId username profitPercent totalProfit frozenSaleUsd")
        .lean()
    : [];
  const userByTelegramId = new Map(users.map((user) => [String(user.telegramId), user]));

  const plan = [];
  for (const log of logs) {
    const gross = roundUsd(log.autoSaleGrossUsd);
    const tx = txById.get(String(log.autoSaleProfitTxId || ""));
    if (!tx || !(gross > 0)) continue;

    const legacy = isLegacyFullGrossHold(tx.workerShare, gross);
    if (!legacy) continue;

    const user = userByTelegramId.get(String(log.ownerTelegramId || ""));
    if (!user) continue;

    const percent = Math.max(
      1,
      Math.min(100, Number(tx.workerPercent || user.profitPercent) || 80)
    );
    const expectedShare = workerShareFromGross(gross, percent);
    const teamCut = roundUsd(gross - expectedShare);
    if (!(teamCut > 0)) continue;

    plan.push({
      sourceId: String(log.sourceId || ""),
      status: String(log.autoSaleStatus || ""),
      ownerTelegramId: String(log.ownerTelegramId || ""),
      txId: String(tx._id),
      grossUsd: gross,
      oldWorkerShare: roundUsd(tx.workerShare),
      expectedShare,
      teamCut,
      percent,
    });
  }
  return plan;
}

function aggregateUserAdjustments(plan) {
  const byOwner = new Map();
  for (const row of plan) {
    const entry = byOwner.get(row.ownerTelegramId) || {
      ownerTelegramId: row.ownerTelegramId,
      logCount: 0,
      teamCutTotal: 0,
      logs: [],
    };
    entry.logCount += 1;
    entry.teamCutTotal = roundUsd(entry.teamCutTotal + row.teamCut);
    entry.logs.push(row);
    byOwner.set(row.ownerTelegramId, entry);
  }
  return [...byOwner.values()];
}

async function applyLegacyHoldMigration(plan, dryRun) {
  let logsUpdated = 0;
  let txsUpdated = 0;
  let usersUpdated = 0;
  const userAdjustments = aggregateUserAdjustments(plan);

  for (const row of plan) {
    if (dryRun) {
      logsUpdated += 1;
      txsUpdated += 1;
      continue;
    }
    await SteamLog.updateOne(
      { sourceId: row.sourceId },
      { $set: { autoSaleWorkerShareUsd: row.expectedShare } }
    );
    await ProfitTransaction.updateOne(
      { _id: row.txId },
      {
        $set: {
          workerShare: row.expectedShare,
          workerPercent: row.percent,
          amount: row.grossUsd,
        },
      }
    );
    logsUpdated += 1;
    txsUpdated += 1;
  }

  for (const adj of userAdjustments) {
    if (!(adj.teamCutTotal > 0)) continue;
    if (dryRun) {
      usersUpdated += 1;
      continue;
    }
    const result = await User.updateOne(
      { telegramId: adj.ownerTelegramId },
      {
        $inc: {
          totalProfit: -adj.teamCutTotal,
          frozenSaleUsd: -adj.teamCutTotal,
        },
      }
    );
    if (result.modifiedCount) usersUpdated += 1;

    await User.updateOne(
      {
        telegramId: adj.ownerTelegramId,
        $or: [{ totalProfit: { $lt: 0 } }, { frozenSaleUsd: { $lt: 0 } }],
      },
      {
        $set: {
          totalProfit: 0,
          frozenSaleUsd: 0,
        },
      }
    );
    await User.updateOne(
      { telegramId: adj.ownerTelegramId, totalProfit: { $lt: 0 } },
      { $set: { totalProfit: 0 } }
    );
    await User.updateOne(
      { telegramId: adj.ownerTelegramId, frozenSaleUsd: { $lt: 0 } },
      { $set: { frozenSaleUsd: 0 } }
    );
  }

  return { logsUpdated, txsUpdated, usersUpdated, userAdjustments };
}

async function computeExpectedFrozenByOwner() {
  const logs = await loadActiveHoldLogs();
  const txIds = [...new Set(logs.map((row) => String(row.autoSaleProfitTxId || "")).filter(Boolean))];
  const txs = txIds.length
    ? await ProfitTransaction.find({ _id: { $in: txIds } })
        .select("_id workerShare")
        .lean()
    : [];
  const txById = new Map(txs.map((tx) => [String(tx._id), tx]));

  const byOwner = new Map();
  for (const log of logs) {
    const ownerId = String(log.ownerTelegramId || "");
    if (!ownerId) continue;
    const tx = txById.get(String(log.autoSaleProfitTxId || ""));
    const gross = roundUsd(log.autoSaleGrossUsd);
    const legacy = isLegacyFullGrossHold(tx?.workerShare, gross);
    const share = legacy
      ? roundUsd(tx?.workerShare || gross)
      : roundUsd(tx?.workerShare || log.autoSaleWorkerShareUsd);
    byOwner.set(ownerId, roundUsd((byOwner.get(ownerId) || 0) + share));
  }
  return byOwner;
}

async function reconcileFrozenSaleUsd(dryRun, userTelegramId = "") {
  const expectedByOwner = await computeExpectedFrozenByOwner();
  const filter = { frozenSaleUsd: { $gt: 0 } };
  if (userTelegramId) filter.telegramId = String(userTelegramId);

  const users = await User.find(filter)
    .select("telegramId username frozenSaleUsd totalProfit")
    .lean();

  const fixes = [];
  for (const user of users) {
    const telegramId = String(user.telegramId || "");
    const expected = expectedByOwner.get(telegramId) || 0;
    const current = roundUsd(user.frozenSaleUsd);
    const delta = roundUsd(current - expected);
    if (Math.abs(delta) < TOLERANCE) continue;
    fixes.push({
      telegramId,
      username: String(user.username || ""),
      before: current,
      after: expected,
      delta,
    });
  }

  // Users with frozen=0 but expected>0 (shouldn't happen after hold migration)
  for (const [telegramId, expected] of expectedByOwner.entries()) {
    if (!(expected > 0)) continue;
    if (userTelegramId && telegramId !== String(userTelegramId)) continue;
    const user = await User.findOne({ telegramId }).select("telegramId username frozenSaleUsd").lean();
    if (!user) continue;
    const current = roundUsd(user.frozenSaleUsd);
    const delta = roundUsd(current - expected);
    if (Math.abs(delta) < TOLERANCE) continue;
    if (fixes.some((row) => row.telegramId === telegramId)) continue;
    fixes.push({
      telegramId,
      username: String(user.username || ""),
      before: current,
      after: expected,
      delta,
    });
  }

  if (!dryRun) {
    for (const fix of fixes) {
      await User.updateOne({ telegramId: fix.telegramId }, { $set: { frozenSaleUsd: fix.after } });
    }
  }

  return fixes;
}

async function zeroKarmaCeo(dryRun) {
  const user = await User.findOne({ telegramId: KARMA_CEO_TELEGRAM_ID })
    .select("telegramId username totalProfit frozenSaleUsd reservedWithdrawalUsd")
    .lean();
  if (!user) return { found: false };

  const before = {
    totalProfit: roundUsd(user.totalProfit),
    frozenSaleUsd: roundUsd(user.frozenSaleUsd),
    reservedWithdrawalUsd: roundUsd(user.reservedWithdrawalUsd),
  };
  const needsFix =
    before.totalProfit > 0 ||
    before.frozenSaleUsd > 0 ||
    before.reservedWithdrawalUsd > 0;

  if (needsFix && !dryRun) {
    await User.updateOne(
      { telegramId: KARMA_CEO_TELEGRAM_ID },
      {
        $set: {
          totalProfit: 0,
          frozenSaleUsd: 0,
          reservedWithdrawalUsd: 0,
        },
      }
    );
  }

  return {
    found: true,
    telegramId: KARMA_CEO_TELEGRAM_ID,
    username: String(user.username || ""),
    before,
    after: { totalProfit: 0, frozenSaleUsd: 0, reservedWithdrawalUsd: 0 },
    fixed: needsFix,
  };
}

async function snapshotFinance() {
  const overview = await getAdminFinanceOverview({ limit: 500 });
  const issueRows = overview.workers.filter((row) => row.issueCount > 0);
  return {
    totals: overview.totals,
    workersWithIssues: overview.totals.workersWithIssues,
    issueCount: issueRows.length,
    issues: issueRows.map((row) => ({
      telegramId: row.telegramId,
      username: row.username,
      walletUsd: row.walletUsd,
      frozenSaleUsd: row.frozenSaleUsd,
      ledgerDelta: row.ledgerDelta,
      holdDelta: row.holdDelta,
      legacyHoldCount: row.legacyHoldCount,
      issues: row.issues.filter((item) => item.severity !== "info"),
    })),
  };
}

async function analyzeState(userTelegramId = "") {
  const logs = await loadActiveHoldLogs(userTelegramId);
  const plan = await buildLegacyHoldPlan(logs);
  const userAdjustments = aggregateUserAdjustments(plan);

  const usersWithFrozen = await User.countDocuments({
    frozenSaleUsd: { $gt: 0 },
    ...(userTelegramId ? { telegramId: String(userTelegramId) } : {}),
  });

  const finance = await snapshotFinance();

  return {
    activeHoldLogs: logs.length,
    legacyHoldLogs: plan.length,
    usersWithFrozen,
    legacyByUser: userAdjustments.map((row) => ({
      telegramId: row.ownerTelegramId,
      logCount: row.logCount,
      teamCutTotal: row.teamCutTotal,
    })),
    finance,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  validateEnv();
  await connectDatabase();

  const beforeFinance = await snapshotFinance();
  const beforeAnalyze = await analyzeState(args.userTelegramId);

  if (args.analyze) {
    process.stdout.write(
      `${JSON.stringify({ mode: "analyze", before: beforeAnalyze }, null, 2)}\n`
    );
    return;
  }

  const logs = await loadActiveHoldLogs(args.userTelegramId);
  const plan = await buildLegacyHoldPlan(logs);
  const legacyResult = await applyLegacyHoldMigration(plan, args.dryRun);
  const frozenFixes = await reconcileFrozenSaleUsd(args.dryRun, args.userTelegramId);
  const karmaCeo = await zeroKarmaCeo(args.dryRun);

  const afterFinance = args.dryRun ? beforeFinance : await snapshotFinance();
  const afterAnalyze = args.dryRun ? beforeAnalyze : await analyzeState(args.userTelegramId);

  const summary = {
    dryRun: args.dryRun,
    userFilter: args.userTelegramId || null,
    legacyMigration: {
      logsMatched: plan.length,
      logsUpdated: legacyResult.logsUpdated,
      txsUpdated: legacyResult.txsUpdated,
      usersUpdated: legacyResult.usersUpdated,
      teamCutTotalUsd: roundUsd(plan.reduce((sum, row) => sum + row.teamCut, 0)),
      samples: plan.slice(0, 10),
    },
    frozenReconciliation: {
      usersFixed: frozenFixes.length,
      fixes: frozenFixes,
    },
    karmaCeo,
    before: {
      finance: beforeFinance,
      legacyHoldLogs: beforeAnalyze.legacyHoldLogs,
    },
    after: {
      finance: afterFinance,
      legacyHoldLogs: afterAnalyze.legacyHoldLogs,
    },
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
