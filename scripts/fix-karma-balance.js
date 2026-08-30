#!/usr/bin/env node
/**
 * One-off: inspect and zero @karma_ceo (8647494349) wallet if needed.
 * Usage: node scripts/fix-karma-balance.js [--apply]
 */
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../src/models/User");
const ProfitTransaction = require("../src/models/ProfitTransaction");
const WithdrawalRequest = require("../src/models/WithdrawalRequest");
const { CREDIT_KINDS } = require("../src/models/ProfitTransaction");
const { recordApprovedWithdrawal } = require("../src/services/memberFinanceService");

const TARGETS = [
  { key: "karma_ceo", telegramId: "8647494349", usernames: ["karma_ceo"] },
  { key: "karmaceo", telegramId: "padmin:karmaceo", usernames: ["karmaceo"] },
];
const APPLY = process.argv.includes("--apply");

async function inspectUser(user) {
  const credits = await sumCredits(user._id);
  const withdrawals = await sumWithdrawals(user._id);
  const expected = Number((credits.total - withdrawals.total).toFixed(2));
  const wallet = Number(Number(user.totalProfit || 0).toFixed(2));
  return { user, credits, withdrawals, expected, wallet, delta: Number((wallet - expected).toFixed(2)) };
}

async function zeroUser(user, wallet, creditsTotal) {
  if (wallet <= 0) {
    return { mode: "skip", reason: "wallet_already_zero" };
  }
  if (creditsTotal <= 0) {
    await User.updateOne(
      { _id: user._id },
      { $set: { totalProfit: 0, frozenSaleUsd: 0, reservedWithdrawalUsd: 0 } }
    );
    return { mode: "direct_reset", newBalance: 0 };
  }
  const result = await recordApprovedWithdrawal(user.telegramId, {
    amountUsd: wallet,
    method: "cryptobot",
    adminTelegramId: "system",
    clearRemainingBalance: true,
  });
  return { mode: "withdrawal", deductedUsd: result.deductedUsd, newBalance: result.user.totalProfit };
}

async function sumCredits(userId) {
  const rows = await ProfitTransaction.aggregate([
    { $match: { userId } },
    {
      $group: {
        _id: null,
        total: {
          $sum: {
            $cond: [
              { $eq: ["$kind", CREDIT_KINDS.PROFIT] },
              "$workerShare",
              "$amount",
            ],
          },
        },
        count: { $sum: 1 },
      },
    },
  ]);
  return {
    total: Number((rows[0]?.total || 0).toFixed(2)),
    count: rows[0]?.count || 0,
  };
}

async function sumWithdrawals(userId) {
  const rows = await WithdrawalRequest.aggregate([
    { $match: { userId, status: "approved" } },
    { $group: { _id: null, total: { $sum: "$amountUsd" }, count: { $sum: 1 } } },
  ]);
  return {
    total: Number((rows[0]?.total || 0).toFixed(2)),
    count: rows[0]?.count || 0,
  };
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  console.log("=== karma / karmaceo lookup ===");
  const reports = [];
  for (const target of TARGETS) {
    const byId = await User.findOne({ telegramId: target.telegramId }).lean();
    const byUsername = target.usernames.length
      ? await User.find({ username: { $in: target.usernames.map((u) => new RegExp(`^${u}$`, "i")) } }).lean()
      : [];
    console.log(`\n--- ${target.key} ---`);
    console.log("by telegramId", target.telegramId, byId ? "found" : "NOT FOUND");
    if (byId) {
      console.log({
        _id: String(byId._id),
        telegramId: byId.telegramId,
        username: byId.username,
        firstName: byId.firstName,
        totalProfit: byId.totalProfit,
        frozenSaleUsd: byId.frozenSaleUsd,
        reservedWithdrawalUsd: byId.reservedWithdrawalUsd,
      });
    }
    console.log(
      "by username:",
      byUsername.map((u) => ({
        telegramId: u.telegramId,
        username: u.username,
        totalProfit: u.totalProfit,
      }))
    );

    const user = byId || byUsername.find((row) => row.telegramId === target.telegramId) || byUsername[0];
    if (!user) {
      console.log("NOT FOUND — skip");
      continue;
    }
    const report = await inspectUser(user);
    reports.push(report);
    console.log("reconciliation:", {
      wallet: report.wallet,
      credits: report.credits.total,
      withdrawals: report.withdrawals.total,
      expected: report.expected,
      delta: report.delta,
    });
  }

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to zero non-zero wallets.");
    await mongoose.disconnect();
    return;
  }

  for (const report of reports) {
    const { user, wallet, credits } = report;
    if (wallet <= 0) {
      console.log(`\n${user.username || user.telegramId}: already zero`);
      continue;
    }
    const result = await zeroUser(user, wallet, credits.total);
    console.log(`\n${user.username || user.telegramId}:`, result);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
