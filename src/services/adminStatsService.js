const Application = require("../models/Application");
const ProfitTransaction = require("../models/ProfitTransaction");
const User = require("../models/User");
const { profitStatsFilter } = require("./profitService");

function periodSince(period) {
  const now = Date.now();
  if (period === "24h") return new Date(now - 24 * 60 * 60 * 1000);
  if (period === "7d") return new Date(now - 7 * 24 * 60 * 60 * 1000);
  if (period === "30d") return new Date(now - 30 * 24 * 60 * 60 * 1000);
  return null;
}

function statsPeriodLabel(period) {
  const map = {
    all: "всё время",
    "24h": "день",
    "7d": "неделю",
    "30d": "месяц",
  };
  return map[period] || map.all;
}

/**
 * Сводка админ-статистики за период (по createdAt).
 */
async function getAdminDashboardStats(period = "all") {
  const since = period === "all" ? null : periodSince(period);
  const dateMatch = since ? { createdAt: { $gte: since } } : {};

  const [appByStatus, profitAgg, teamCount, pendingNow] = await Promise.all([
    Application.aggregate([
      { $match: dateMatch },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    ProfitTransaction.aggregate([
      { $match: profitStatsFilter(dateMatch) },
      {
        $group: {
          _id: null,
          totalProfit: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]),
    User.countDocuments({ isTeamMember: true, isBanned: { $ne: true } }),
    Application.countDocuments({ status: "pending" }),
  ]);

  const apps = { total: 0, pending: 0, accepted: 0, rejected: 0 };
  for (const row of appByStatus) {
    const n = Number(row.count || 0);
    apps.total += n;
    if (row._id === "pending") apps.pending = n;
    else if (row._id === "accepted") apps.accepted = n;
    else if (row._id === "rejected") apps.rejected = n;
  }

  const profit = profitAgg[0] || {};
  return {
    period,
    periodLabel: statsPeriodLabel(period),
    teamCount,
    pendingNow,
    applications: apps,
    profits: {
      count: Number(profit.count || 0),
      totalProfit: Number(profit.totalProfit || 0),
    },
  };
}

module.exports = {
  periodSince,
  statsPeriodLabel,
  getAdminDashboardStats,
};
