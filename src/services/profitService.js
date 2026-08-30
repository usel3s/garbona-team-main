const ProfitTransaction = require("../models/ProfitTransaction");
const SteamLog = require("../models/SteamLog");
const {
  CREDIT_KINDS,
  NON_STAT_CREDIT_KINDS,
} = require("../models/ProfitTransaction");
const User = require("../models/User");
const { sumReservedUsd } = require("./withdrawalService");

function startOfPeriod(period) {
  const now = new Date();
  if (period === "24h") return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (period === "7d") return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (period === "30d") return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return null;
}

/** Фильтр для статистики/топа: только рабочие профиты, без пополнений и переводов. */
function profitStatsFilter(extra = {}) {
  return {
    ...extra,
    kind: { $nin: NON_STAT_CREDIT_KINDS },
  };
}

function normalizeCreditAmount(amountUsd) {
  const amount = Math.round(Number(amountUsd) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Сумма должна быть числом больше 0.");
  }
  return amount;
}

/**
 * Единая точка положительного зачисления на кошелёк + запись в историю начислений.
 * Callers не должны инкрементировать totalProfit напрямую для кредитов.
 */
async function creditWalletBalanceUsd(telegramId, amountUsd, options = {}) {
  const amount = normalizeCreditAmount(amountUsd);
  const kind = options.kind || CREDIT_KINDS.WALLET_CREDIT;
  const actorTelegramId = String(options.actorTelegramId || options.adminTelegramId || "");
  const note = String(options.note || "").trim().slice(0, 200);
  const counterpartyTelegramId = String(options.counterpartyTelegramId || "");
  const counterpartyUsername = String(options.counterpartyUsername || "");

  const filter =
    options.filter && typeof options.filter === "object"
      ? options.filter
      : { telegramId: String(telegramId) };

  const session = options.session || null;
  const user = await User.findOneAndUpdate(filter, { $inc: { totalProfit: amount } }, { new: true, session });
  if (!user) {
    throw new Error(
      options.notFoundError || "Пользователь не найден."
    );
  }

  try {
    const rows = await ProfitTransaction.create([{
      userId: user._id,
      adminTelegramId: actorTelegramId || "system",
      amount,
      workerPercent: 100,
      workerShare: amount,
      kind,
      note,
      counterpartyTelegramId,
      counterpartyUsername,
      branchId: String(options.branchId || ""),
      relatedTransactionId: String(options.relatedTransactionId || ""),
    }], { session });
    const transaction = rows[0];
    return { user, amountUsd: amount, transaction };
  } catch (error) {
    await User.findOneAndUpdate({ _id: user._id }, { $inc: { totalProfit: -amount } }, { session });
    throw error;
  }
}

async function debitAvailableBalanceUsd(telegramId, amountUsd, options = {}) {
  const amount = normalizeCreditAmount(amountUsd);
  const kind = options.kind || CREDIT_KINDS.BRANCH_FEE;
  const actorTelegramId = String(options.actorTelegramId || options.adminTelegramId || "system");
  const note = String(options.note || "").trim().slice(0, 200);

  const user = await User.findOneAndUpdate(
    {
      telegramId: String(telegramId),
      $expr: {
        $gte: [
          {
            $subtract: [
              "$totalProfit",
              {
                $add: [
                  { $ifNull: ["$reservedWithdrawalUsd", 0] },
                  { $ifNull: ["$frozenSaleUsd", 0] },
                ],
              },
            ],
          },
          amount,
        ],
      },
    },
    { $inc: { totalProfit: -amount } },
    { new: true }
  );
  if (!user) {
    throw new Error("Недостаточно средств с учётом холда продаж и активных заявок на вывод.");
  }

  try {
    const rows = await ProfitTransaction.create([{
      userId: user._id,
      adminTelegramId: actorTelegramId,
      amount,
      workerPercent: 100,
      workerShare: amount,
      kind,
      note,
    }]);
    return { user, amountUsd: amount, transaction: rows[0] };
  } catch (error) {
    await User.findOneAndUpdate({ _id: user._id }, { $inc: { totalProfit: amount } });
    throw error;
  }
}

async function creditComputedWorkerShare(user, workerShare, options = {}) {
  const share = normalizeCreditAmount(workerShare);
  const { applyBranchCommission } = require("./branchService");
  const split = await applyBranchCommission(user, share);
  const net = split.commission > 0 ? split.net : share;
  if (net <= 0) {
    throw new Error("Доля воркера должна быть больше 0.");
  }

  user.totalProfit = Number((Number(user.totalProfit || 0) + net).toFixed(2));
  await user.save();

  try {
    const transaction = await ProfitTransaction.create({
      userId: user._id,
      adminTelegramId: String(options.adminTelegramId || options.actorTelegramId || ""),
      amount: options.gross != null ? Number(options.gross) : share,
      workerPercent: options.workerPercent != null ? options.workerPercent : user.profitPercent,
      workerShare: net,
      kind: CREDIT_KINDS.PROFIT,
      note: String(options.note || "Начисление профита").slice(0, 200),
      branchId: split.branchId || "",
    });

    let branchTransaction = null;
    if (split.commission > 0 && split.ownerTelegramId) {
      const credited = await creditWalletBalanceUsd(split.ownerTelegramId, split.commission, {
        kind: CREDIT_KINDS.BRANCH_COMMISSION,
        actorTelegramId: String(options.adminTelegramId || options.actorTelegramId || "system"),
        note: `Комиссия филиала`,
        counterpartyTelegramId: String(user.telegramId),
        counterpartyUsername: user.username || "",
        branchId: split.branchId,
        relatedTransactionId: String(transaction._id),
      });
      branchTransaction = credited.transaction || null;
      if (branchTransaction?._id) {
        transaction.relatedTransactionId = String(branchTransaction._id);
        await transaction.save();
      }
    }

    try {
      const { scheduleProfitRoleSync } = require("../discord/profitRoles");
      scheduleProfitRoleSync(user);
    } catch (_) {
      /* discord optional */
    }

    return {
      user,
      workerShare: net,
      grossWorkerShare: share,
      branchCommission: split.commission,
      branchId: split.branchId,
      transaction,
      branchTransaction,
    };
  } catch (error) {
    user.totalProfit = Number((Number(user.totalProfit || 0) - net).toFixed(2));
    await user.save();
    throw error;
  }
}

async function addProfitToUserByTelegramId(telegramId, amount, adminTelegramId, note = "") {
  const user = await User.findOne({ telegramId: String(telegramId) });
  if (!user) return null;

  const gross = normalizeCreditAmount(amount);
  const workerShare = Number(((gross * user.profitPercent) / 100).toFixed(2));
  if (workerShare <= 0) {
    throw new Error("Доля воркера должна быть больше 0.");
  }

  return creditComputedWorkerShare(user, workerShare, {
    adminTelegramId,
    gross,
    workerPercent: user.profitPercent,
    note: note || "Начисление профита",
  });
}

async function getUserProfitStatsByTelegramId(telegramId, period) {
  const user = await User.findOne({ telegramId: String(telegramId) });
  if (!user) return null;
  const since = startOfPeriod(period);
  const match = profitStatsFilter({ userId: user._id });
  if (since) {
    match.createdAt = { $gte: since };
  }

  const result = await ProfitTransaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalWorkerShare: { $sum: "$workerShare" },
        count: { $sum: 1 },
      },
    },
  ]);

  const summary = result[0] || { totalWorkerShare: 0, count: 0 };
  return {
    user,
    periodProfit: Number((summary.totalWorkerShare || 0).toFixed(2)),
    operationsCount: summary.count || 0,
  };
}

function daysWithTeam(user) {
  return Math.max(
    1,
    Math.floor((Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24))
  );
}

function nicknameOf(user) {
  const firstName = String(user.firstName || user.first_name || "").trim();
  if (firstName) return firstName;
  return user.username || user.telegramId || "user";
}

async function getProfitDashboard(user) {
  const [agg] = await ProfitTransaction.aggregate([
    { $match: profitStatsFilter({ userId: user._id }) },
    {
      $group: {
        _id: null,
        totalShare: { $sum: "$workerShare" },
        maxShare: { $max: "$workerShare" },
        count: { $sum: 1 },
      },
    },
  ]);

  return {
    days: daysWithTeam(user),
    nickname: nicknameOf(user),
    count: Number(agg?.count || 0),
    totalShare: Number(agg?.totalShare || 0),
    maxShare: Number(agg?.maxShare || 0),
  };
}

async function listUserProfits(user, limit = 50, skip = 0) {
  return ProfitTransaction.find({ userId: user._id })
    .sort({ createdAt: -1 })
    .skip(Math.max(0, Number(skip) || 0))
    .limit(limit)
    .lean();
}

async function countUserProfits(user) {
  return ProfitTransaction.countDocuments({ userId: user._id });
}

function sourceIdFromProfitNote(note) {
  const match = String(note || "").match(/#(\d{4,})/);
  return match ? match[1] : "";
}

async function enrichProfitsWithSourceId(rows) {
  if (!rows?.length) return [];
  const txIds = rows.map((row) => String(row._id || "")).filter(Boolean);
  const logsByTx = new Map();
  if (txIds.length) {
    const logs = await SteamLog.find({
      $or: [
        { autoSaleProfitTxId: { $in: txIds } },
        { mafileProfitTransactionId: { $in: txIds } },
      ],
    })
      .select("sourceId autoSaleProfitTxId mafileProfitTransactionId")
      .lean();
    for (const log of logs) {
      if (log.autoSaleProfitTxId) {
        logsByTx.set(String(log.autoSaleProfitTxId), String(log.sourceId || ""));
      }
      if (log.mafileProfitTransactionId) {
        logsByTx.set(String(log.mafileProfitTransactionId), String(log.sourceId || ""));
      }
    }
  }
  return rows.map((row) => {
    const txId = String(row._id || "");
    const sourceId = sourceIdFromProfitNote(row.note) || logsByTx.get(txId) || "";
    return { ...row, sourceId };
  });
}

async function groupUserProfits(user, mode = "month") {
  const groupId =
    mode === "day"
      ? {
          y: { $year: "$createdAt" },
          m: { $month: "$createdAt" },
          d: { $dayOfMonth: "$createdAt" },
        }
      : {
          y: { $year: "$createdAt" },
          m: { $month: "$createdAt" },
        };

  const rows = await ProfitTransaction.aggregate([
    { $match: profitStatsFilter({ userId: user._id }) },
    {
      $group: {
        _id: groupId,
        total: { $sum: "$workerShare" },
        count: { $sum: 1 },
        lastAt: { $max: "$createdAt" },
      },
    },
    { $sort: { "_id.y": -1, "_id.m": -1, "_id.d": -1 } },
    { $limit: 40 },
  ]);

  return rows.map((r) => ({
    year: r._id.y,
    month: r._id.m,
    day: r._id.d || null,
    total: Number(r.total || 0),
    count: Number(r.count || 0),
    lastAt: r.lastAt,
  }));
}

async function resetUserProfitStats(telegramId) {
  const user = await User.findOne({ telegramId: String(telegramId) });
  if (!user) return null;

  const statsFilter = profitStatsFilter({ userId: user._id });
  const [agg] = await ProfitTransaction.aggregate([
    { $match: statsFilter },
    {
      $group: {
        _id: null,
        totalShare: { $sum: "$workerShare" },
        count: { $sum: 1 },
      },
    },
  ]);

  const removedShare = Number(agg?.totalShare || 0);
  const removedCount = Number(agg?.count || 0);
  if (removedCount === 0) {
    return { user, removedShare: 0, removedCount: 0, newBalance: Number(user.totalProfit || 0) };
  }

  const reserved = await sumReservedUsd(user.telegramId);
  const newBalance = Number(Math.max(0, Number(user.totalProfit || 0) - removedShare).toFixed(2));
  if (newBalance + 1e-9 < reserved) {
    throw new Error(
      `Нельзя обнулить статистику: после списания останется $${newBalance.toFixed(2)}, а под вывод зарезервировано $${reserved.toFixed(2)}.`
    );
  }

  await ProfitTransaction.deleteMany(statsFilter);
  user.totalProfit = newBalance;
  await user.save();

  return { user, removedShare, removedCount, newBalance };
}

async function deductUserProfitStats(telegramId, { count, amountUsd }) {
  const user = await User.findOne({ telegramId: String(telegramId) });
  if (!user) return null;

  const n = Math.floor(Number(count) || 0);
  const requestedAmount = Number(Number(amountUsd || 0).toFixed(2));
  if (n < 1) {
    throw new Error("Количество профитов должно быть целым числом от 1.");
  }
  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
    throw new Error("Сумма списания должна быть больше 0.");
  }

  const rows = await ProfitTransaction.find(profitStatsFilter({ userId: user._id }))
    .sort({ createdAt: -1 })
    .limit(n)
    .lean();

  if (rows.length < n) {
    throw new Error(`Недостаточно записей профита: есть ${rows.length}, запрошено ${n}.`);
  }

  const removedShare = Number(
    rows.reduce((sum, row) => sum + Number(row.workerShare || 0), 0).toFixed(2)
  );
  const reserved = await sumReservedUsd(user.telegramId);
  const newBalance = Number(Math.max(0, Number(user.totalProfit || 0) - removedShare).toFixed(2));
  if (newBalance + 1e-9 < reserved) {
    throw new Error(
      `Нельзя списать: после операции останется $${newBalance.toFixed(2)}, а под вывод зарезервировано $${reserved.toFixed(2)}.`
    );
  }

  await ProfitTransaction.deleteMany({ _id: { $in: rows.map((row) => row._id) } });
  user.totalProfit = newBalance;
  await user.save();

  return {
    user,
    removedCount: rows.length,
    removedShare,
    requestedAmount,
    newBalance,
  };
}

async function reverseProfitTransactionById(transactionId, { skipRelated = false } = {}) {
  const id = String(transactionId || "").trim();
  if (!id) return null;
  const tx = await ProfitTransaction.findById(id);
  if (!tx) return null;

  const relatedId = !skipRelated ? String(tx.relatedTransactionId || "").trim() : "";

  const user = await User.findById(tx.userId);
  if (!user) {
    await ProfitTransaction.deleteOne({ _id: tx._id });
    if (relatedId && relatedId !== id) {
      await reverseProfitTransactionById(relatedId, { skipRelated: true }).catch(() => {});
    }
    return { removedShare: Number(tx.workerShare || 0), newBalance: 0 };
  }

  const removedShare = Number(Number(tx.workerShare || 0).toFixed(2));
  const reserved = await sumReservedUsd(user.telegramId);
  const newBalance = Number(Math.max(0, Number(user.totalProfit || 0) - removedShare).toFixed(2));
  if (newBalance + 1e-9 < reserved) {
    throw new Error(
      `Нельзя отменить начисление: после операции останется $${newBalance.toFixed(2)}, а под вывод зарезервировано $${reserved.toFixed(2)}.`
    );
  }

  await ProfitTransaction.deleteOne({ _id: tx._id });
  user.totalProfit = newBalance;
  await user.save();
  if (relatedId && relatedId !== id) {
    await reverseProfitTransactionById(relatedId, { skipRelated: true }).catch(() => {});
  }
  try {
    const { scheduleProfitRoleSync } = require("../discord/profitRoles");
    scheduleProfitRoleSync(user);
  } catch (_) {
    /* discord optional */
  }
  return { user, removedShare, newBalance };
}

module.exports = {
  CREDIT_KINDS,
  NON_STAT_CREDIT_KINDS,
  profitStatsFilter,
  creditWalletBalanceUsd,
  debitAvailableBalanceUsd,
  creditComputedWorkerShare,
  addProfitToUserByTelegramId,
  reverseProfitTransactionById,
  getUserProfitStatsByTelegramId,
  getProfitDashboard,
  listUserProfits,
  countUserProfits,
  enrichProfitsWithSourceId,
  groupUserProfits,
  resetUserProfitStats,
  deductUserProfitStats,
  daysWithTeam,
  nicknameOf,
};
