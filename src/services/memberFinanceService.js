const mongoose = require("mongoose");
const User = require("../models/User");
const WithdrawalRequest = require("../models/WithdrawalRequest");
const { CREDIT_KINDS } = require("../models/ProfitTransaction");
const { listUserProfits, enrichProfitsWithSourceId } = require("./profitService");
const {
  listUserRequests,
  methodLabel,
  calcPayoutBreakdown,
  isLinkPayoutMethod,
  isNicknamePayoutMethod,
  loadWithdrawalFees,
  payoutShortId,
} = require("./withdrawalService");
const { listUserTransfers, serializeTransferForUser } = require("./walletTransferService");

const PROFIT_KIND_LABELS = {
  [CREDIT_KINDS.PROFIT]: "Профит",
  [CREDIT_KINDS.WALLET_CREDIT]: "Пополнение",
  [CREDIT_KINDS.TRANSFER_IN]: "Перевод",
  [CREDIT_KINDS.BRANCH_COMMISSION]: "Комиссия филиала",
  [CREDIT_KINDS.BRANCH_FEE]: "Создание филиала",
};

function profitItemLabel(row) {
  const sourceId = String(row?.sourceId || "").trim();
  if (sourceId) return `выполнение лога #${sourceId}`;
  const note = String(row?.note || "").trim();
  if (note) return note;
  return PROFIT_KIND_LABELS[row?.kind] || "Начисление";
}

function serializeProfitItem(row) {
  const kind = row.kind || CREDIT_KINDS.PROFIT;
  const isOut = kind === CREDIT_KINDS.BRANCH_FEE;
  const sourceId = String(row.sourceId || "").trim();
  return {
    id: String(row._id || ""),
    type: "profit",
    createdAt: row.createdAt || null,
    amountUsd: Number(row.workerShare || row.amount || 0),
    direction: isOut ? "out" : "in",
    label: profitItemLabel(row),
    kind,
    sourceId,
    note: String(row.note || ""),
  };
}

function serializeWithdrawalItem(row) {
  return {
    id: String(row._id || ""),
    type: "withdrawal",
    createdAt: row.createdAt || null,
    amountUsd: Number(row.amountUsd || 0),
    direction: "out",
    label: methodLabel(row.method) || "Вывод",
    method: row.method || "",
    status: row.status || "pending",
    payoutUrl: row.payoutUrl || "",
    walletAddress: row.walletAddress || "",
  };
}

function serializeTransferItem(row, telegramId) {
  const item = serializeTransferForUser(row, telegramId);
  const peer = item.peerUsername ? `@${item.peerUsername}` : item.peerTelegramId || "—";
  return {
    ...item,
    label: item.direction === "out" ? `Перевод → ${peer}` : `Перевод ← ${peer}`,
  };
}

async function listMemberFinanceHistory(user, limit = 30) {
  if (!user?._id) return [];
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 30));
  const perSource = Math.min(50, safeLimit);

  const [rawProfits, withdrawals, transfers] = await Promise.all([
    listUserProfits(user, perSource),
    listUserRequests(user.telegramId, perSource),
    listUserTransfers(user.telegramId, perSource),
  ]);
  const profits = await enrichProfitsWithSourceId(rawProfits);

  const items = [
    ...(profits || []).map(serializeProfitItem),
    ...(withdrawals || []).map(serializeWithdrawalItem),
    ...(transfers || []).map((row) => serializeTransferItem(row, user.telegramId)),
  ]
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, safeLimit);

  return items;
}

function roundUsd(value) {
  return Number(Number(value || 0).toFixed(2));
}

function eventTime(row) {
  const t = new Date(row?.createdAt || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

function allocatePayoutFunding(credits, outs, amountUsd, at) {
  const cutoff = new Date(at || Date.now()).getTime();
  const pool = [];
  const timeline = [
    ...(credits || []).map((row) => ({ kind: "in", at: eventTime(row), row })),
    ...(outs || []).map((row) => ({ kind: "out", at: eventTime(row), row })),
  ]
    .filter((item) => item.at > 0 && item.at <= cutoff)
    .sort((a, b) => a.at - b.at || String(a.row.id).localeCompare(String(b.row.id)));

  const consume = (amount) => {
    let left = roundUsd(amount);
    for (const item of pool) {
      if (left <= 0) break;
      if (!(item.remaining > 0)) continue;
      const take = Math.min(item.remaining, left);
      item.remaining = roundUsd(item.remaining - take);
      left = roundUsd(left - take);
    }
    return left;
  };

  for (const event of timeline) {
    if (event.kind === "in") {
      pool.push({
        id: event.row.id,
        remaining: roundUsd(event.row.amountUsd),
        creditedUsd: roundUsd(event.row.amountUsd),
        createdAt: event.row.createdAt,
        sourceId: event.row.sourceId || "",
        label: event.row.label,
        note: event.row.note || "",
        kind: event.row.kind || "",
        type: event.row.type || "profit",
      });
    } else {
      consume(event.row.amountUsd);
    }
  }

  const need = roundUsd(amountUsd);
  const funding = [];
  let left = need;
  for (const item of pool) {
    if (left <= 0) break;
    if (!(item.remaining > 0)) continue;
    const take = Math.min(item.remaining, left);
    funding.push({
      id: item.id,
      createdAt: item.createdAt,
      sourceId: item.sourceId,
      label: item.label,
      note: item.note,
      kind: item.kind,
      type: item.type,
      creditedUsd: item.creditedUsd,
      appliedUsd: roundUsd(take),
    });
    left = roundUsd(left - take);
  }
  return {
    funding,
    coveredUsd: roundUsd(need - left),
    missingUsd: left,
  };
}

function withRunningBalance(items) {
  const sorted = [...(items || [])].sort((a, b) => eventTime(a) - eventTime(b));
  let balance = 0;
  const settled = new Set(["approved"]);
  return sorted.map((item) => {
    const pendingOut =
      item.direction === "out" && !settled.has(String(item.status || "approved"));
    const delta = item.direction === "out"
      ? pendingOut
        ? 0
        : -roundUsd(item.amountUsd)
      : roundUsd(item.amountUsd);
    balance = roundUsd(balance + delta);
    return {
      ...item,
      deltaUsd: item.direction === "out" ? -roundUsd(item.amountUsd) : roundUsd(item.amountUsd),
      balanceAfterUsd: balance,
      reserved: pendingOut,
    };
  });
}

async function getPayoutAdminDetail(requestId) {
  const id = String(requestId || "").trim();
  if (!/^[a-f0-9]{24}$/i.test(id)) return null;
  const request = await WithdrawalRequest.findById(id).lean();
  if (!request) return null;
  await loadWithdrawalFees();
  const user = await User.findOne({ telegramId: String(request.telegramId) });
  const [rawProfits, withdrawals, transfers] = user
    ? await Promise.all([
      listUserProfits(user, 200),
      listUserRequests(user.telegramId, 100),
      listUserTransfers(user.telegramId, 100),
    ])
    : [[], [], []];
  const profits = await enrichProfitsWithSourceId(rawProfits);
  const profitItems = profits.map(serializeProfitItem);
  const withdrawalItems = withdrawals.map(serializeWithdrawalItem);
  const transferItems = transfers.map((row) => serializeTransferItem(row, request.telegramId));
  const ledgerSource = [...profitItems, ...withdrawalItems, ...transferItems];
  const ledger = withRunningBalance(ledgerSource).sort((a, b) => eventTime(b) - eventTime(a));

  const credits = profitItems.filter((item) => item.direction === "in");
  const outs = [
    ...profitItems.filter((item) => item.direction === "out"),
    ...withdrawalItems.filter(
      (item) => item.status === "approved" && item.id !== String(request._id)
    ),
    ...transferItems.filter((item) => item.direction === "out"),
  ];
  const trail = allocatePayoutFunding(credits, outs, request.amountUsd, request.createdAt);
  const breakdown = calcPayoutBreakdown(request.amountUsd, request.method);
  const walletUsd = Number(user?.totalProfit || 0);
  const reservedUsd = Number(user?.reservedWithdrawalUsd || 0);

  return {
    payout: {
      id: String(request._id),
      shortId: payoutShortId(request._id),
      userId: request.userId ? String(request.userId) : "",
      telegramId: String(request.telegramId || ""),
      username: String(request.username || ""),
      amountUsd: roundUsd(request.amountUsd),
      networkFee: breakdown.networkFee,
      payoutAmount: breakdown.payoutAmount,
      method: request.method,
      methodLabel: methodLabel(request.method),
      isLinkMethod: isLinkPayoutMethod(request.method),
      isNicknameMethod: isNicknamePayoutMethod(request.method),
      walletAddress: String(request.walletAddress || ""),
      status: request.status,
      payoutUrl: String(request.payoutUrl || ""),
      resolvedByTelegramId: String(request.resolvedByTelegramId || ""),
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    },
    breakdown,
    worker: user
      ? {
        telegramId: String(user.telegramId),
        username: String(user.username || ""),
        firstName: String(user.firstName || ""),
        walletUsd: roundUsd(walletUsd),
        reservedUsd: roundUsd(reservedUsd),
        availableUsd: roundUsd(Math.max(0, walletUsd - reservedUsd)),
      }
      : {
        telegramId: String(request.telegramId),
        username: String(request.username || ""),
        firstName: "",
        walletUsd: 0,
        reservedUsd: roundUsd(request.amountUsd),
        availableUsd: 0,
      },
    ledger,
    funding: trail.funding,
    coveredUsd: trail.coveredUsd,
    missingUsd: trail.missingUsd,
    comments: Array.isArray(request.comments) ? request.comments : [],
    statusHistory: Array.isArray(request.statusHistory) ? request.statusHistory : [],
  };
}

async function recordApprovedWithdrawal(
  telegramId,
  {
    amountUsd,
    method = "cryptobot",
    payoutUrl = "",
    walletAddress = "",
    adminTelegramId = "",
    clearRemainingBalance = false,
  } = {}
) {
  const amount = Number(Number(amountUsd || 0).toFixed(2));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Некорректная сумма вывода.");
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const user = await User.findOne({ telegramId: String(telegramId) }).session(session);
      if (!user) {
        const err = new Error("Пользователь не найден.");
        err.status = 404;
        throw err;
      }

      const balance = Number(Number(user.totalProfit || 0).toFixed(2));
      const reserved = Number(Number(user.reservedWithdrawalUsd || 0).toFixed(2));
      const deductTotal = clearRemainingBalance
        ? Number(Math.max(0, balance - reserved).toFixed(2))
        : amount;

      if (deductTotal <= 0) {
        throw new Error("Недостаточно средств для списания.");
      }
      if (!clearRemainingBalance && balance + 1e-9 < amount) {
        throw new Error("Недостаточно средств на балансе.");
      }

      const rows = await WithdrawalRequest.create(
        [
          {
            userId: user._id,
            telegramId: String(user.telegramId),
            username: user.username || "",
            amountUsd: amount,
            method,
            walletAddress: String(walletAddress || "").trim(),
            status: "approved",
            payoutUrl: String(payoutUrl || "").trim(),
            resolvedByTelegramId: String(adminTelegramId || ""),
          },
        ],
        { session }
      );

      user.totalProfit = Number(Math.max(0, balance - deductTotal).toFixed(2));
      if (clearRemainingBalance && reserved > 0) {
        user.reservedWithdrawalUsd = 0;
      }
      await user.save({ session });
      result = { user, withdrawal: rows[0], deductedUsd: deductTotal };
    });
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = {
  listMemberFinanceHistory,
  recordApprovedWithdrawal,
  serializeProfitItem,
  serializeWithdrawalItem,
  allocatePayoutFunding,
  getPayoutAdminDetail,
};
