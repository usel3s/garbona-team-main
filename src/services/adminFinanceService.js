const User = require("../models/User");
const SteamLog = require("../models/SteamLog");
const ProfitTransaction = require("../models/ProfitTransaction");
const WithdrawalRequest = require("../models/WithdrawalRequest");
const { CREDIT_KINDS } = require("../models/ProfitTransaction");
const { isLegacyFullGrossHold, sumAutosaleWorkerShareByOwner } = require("./autoLogSaleService");
const { enrichProfitsWithSourceId } = require("./profitService");

const ACTIVE_HOLD_STATUSES = ["sold_held", "arbitration"];

const HOLD_KIND_LABELS = {
  autosale: "Автопродажа",
  legacy_autosale: "Автопродажа (старый холд)",
  log: "Лог",
  mafile: "MaFile",
};

const CREDIT_SOURCE_LABELS = {
  log: "Лог",
  mafile: "MaFile",
  autosale: "Автопродажа",
  autosale_release: "Разморозка",
  wallet_credit: "Пополнение",
  transfer_in: "Перевод",
  branch_commission: "Комиссия филиала",
  branch_fee: "Создание филиала",
  profit: "Профит",
  other: "Другое",
};

function roundUsd(value) {
  return Number(Number(value || 0).toFixed(2));
}

function displayName(user) {
  return (
    String(user.firstName || "").trim() ||
    (user.username ? `@${user.username}` : "") ||
    String(user.telegramId || "")
  );
}

function holdKindForLog(row, legacy) {
  const logKind = String(row.logKind || "").trim();
  if (logKind === "mafile") return legacy ? "legacy_autosale" : "mafile";
  if (logKind === "valid") return "log";
  if (String(row.autoSaleProfitTxId || "").trim()) {
    return legacy ? "legacy_autosale" : "autosale";
  }
  return legacy ? "legacy_autosale" : "autosale";
}

function summarizeHoldTypes(logs) {
  const counts = new Map();
  for (const row of logs || []) {
    const kind = String(row.holdKind || "autosale");
    counts.set(kind, (counts.get(kind) || 0) + 1);
  }
  return [...counts.entries()].map(([kind, count]) => ({
    kind,
    count,
    label: HOLD_KIND_LABELS[kind] || kind,
  }));
}

function resolveCreditSourceType(row, logMeta = null) {
  const kind = row.kind || CREDIT_KINDS.PROFIT;
  const note = String(row.note || "");
  const noteLower = note.toLowerCase();

  if (kind === CREDIT_KINDS.WALLET_CREDIT) {
    return { type: "wallet_credit", label: CREDIT_SOURCE_LABELS.wallet_credit };
  }
  if (kind === CREDIT_KINDS.TRANSFER_IN) {
    return { type: "transfer_in", label: CREDIT_SOURCE_LABELS.transfer_in };
  }
  if (kind === CREDIT_KINDS.BRANCH_COMMISSION) {
    return { type: "branch_commission", label: CREDIT_SOURCE_LABELS.branch_commission };
  }
  if (kind === CREDIT_KINDS.BRANCH_FEE) {
    return { type: "branch_fee", label: CREDIT_SOURCE_LABELS.branch_fee };
  }

  const txId = String(row._id || "");
  if (logMeta?.autoSaleTxIds?.has(txId)) {
    return { type: "autosale", label: CREDIT_SOURCE_LABELS.autosale };
  }
  if (logMeta?.mafileTxIds?.has(txId)) {
    return { type: "mafile", label: CREDIT_SOURCE_LABELS.mafile };
  }

  if (/разморожен|холд снят/i.test(noteLower)) {
    return { type: "autosale_release", label: CREDIT_SOURCE_LABELS.autosale_release };
  }
  if (/продан.*заморожен|автопродаж/i.test(noteLower)) {
    return { type: "autosale", label: CREDIT_SOURCE_LABELS.autosale };
  }
  if (logMeta?.logKind === "mafile" || /mafile/i.test(noteLower)) {
    return { type: "mafile", label: CREDIT_SOURCE_LABELS.mafile };
  }
  if (logMeta?.logKind === "valid" || /#\d{4,}/.test(note) || logMeta?.sourceId) {
    return { type: "log", label: CREDIT_SOURCE_LABELS.log };
  }

  return { type: "profit", label: CREDIT_SOURCE_LABELS.profit };
}

async function buildCreditLogMeta(txIds) {
  const autoSaleTxIds = new Set();
  const mafileTxIds = new Set();
  const metaByTxId = new Map();
  if (!txIds.length) {
    return { autoSaleTxIds, mafileTxIds, metaByTxId };
  }

  const logs = await SteamLog.find({
    $or: [
      { autoSaleProfitTxId: { $in: txIds } },
      { mafileProfitTransactionId: { $in: txIds } },
    ],
  })
    .select("sourceId logKind autoSaleProfitTxId mafileProfitTransactionId")
    .lean();

  for (const log of logs) {
    const payload = {
      sourceId: String(log.sourceId || ""),
      logKind: String(log.logKind || ""),
    };
    if (log.autoSaleProfitTxId) {
      const id = String(log.autoSaleProfitTxId);
      autoSaleTxIds.add(id);
      metaByTxId.set(id, payload);
    }
    if (log.mafileProfitTransactionId) {
      const id = String(log.mafileProfitTransactionId);
      mafileTxIds.add(id);
      if (!metaByTxId.has(id)) metaByTxId.set(id, payload);
    }
  }

  return { autoSaleTxIds, mafileTxIds, metaByTxId };
}

async function sumWithdrawalsByUserIds(userIds) {
  if (!userIds.length) return new Map();
  const rows = await WithdrawalRequest.aggregate([
    {
      $match: {
        userId: { $in: userIds },
        status: "approved",
      },
    },
    {
      $group: {
        _id: "$userId",
        total: { $sum: "$amountUsd" },
      },
    },
  ]);
  return new Map(rows.map((row) => [String(row._id), roundUsd(row.total)]));
}

async function sumCreditsByUserIds(userIds) {
  if (!userIds.length) return new Map();
  const rows = await ProfitTransaction.aggregate([
    { $match: { userId: { $in: userIds } } },
    {
      $group: {
        _id: "$userId",
        total: {
          $sum: {
            $cond: [
              { $eq: ["$kind", CREDIT_KINDS.PROFIT] },
              "$workerShare",
              "$amount",
            ],
          },
        },
      },
    },
  ]);
  return new Map(rows.map((row) => [String(row._id), roundUsd(row.total)]));
}

async function activeHoldRowsByOwner() {
  const rows = await SteamLog.find({
    autoSaleStatus: { $in: ACTIVE_HOLD_STATUSES },
    autoSaleProfitTxId: { $ne: "" },
  })
    .select(
      "ownerTelegramId sourceId logKind autoSaleGrossUsd autoSaleWorkerShareUsd autoSaleStatus autoSaleProfitTxId"
    )
    .lean();

  const txIds = [...new Set(rows.map((row) => String(row.autoSaleProfitTxId || "")).filter(Boolean))];
  const txs = txIds.length
    ? await ProfitTransaction.find({ _id: { $in: txIds } })
        .select("_id workerShare amount")
        .lean()
    : [];
  const txById = new Map(txs.map((tx) => [String(tx._id), tx]));

  const byOwner = new Map();
  for (const row of rows) {
    const ownerId = String(row.ownerTelegramId || "");
    if (!ownerId) continue;
    const gross = roundUsd(row.autoSaleGrossUsd);
    const tx = txById.get(String(row.autoSaleProfitTxId || ""));
    const legacy = isLegacyFullGrossHold(tx?.workerShare, gross);
    const holdKind = holdKindForLog(row, legacy);
    const frozenShare = legacy
      ? roundUsd(tx?.workerShare || gross)
      : roundUsd(tx?.workerShare || row.autoSaleWorkerShareUsd);
    const entry = byOwner.get(ownerId) || {
      count: 0,
      frozenUsd: 0,
      grossUsd: 0,
      legacyCount: 0,
      logs: [],
    };
    entry.count += 1;
    entry.frozenUsd = roundUsd(entry.frozenUsd + frozenShare);
    entry.grossUsd = roundUsd(entry.grossUsd + gross);
    if (legacy) entry.legacyCount += 1;
    entry.logs.push({
      sourceId: String(row.sourceId || ""),
      status: String(row.autoSaleStatus || ""),
      logKind: String(row.logKind || ""),
      holdKind,
      grossUsd: gross,
      frozenUsd: frozenShare,
      legacyHold: legacy,
    });
    byOwner.set(ownerId, entry);
  }
  return byOwner;
}

function buildWorkerRow(user, creditsMap, withdrawalsMap, holdsMap, autosaleShareMap) {
  const userId = String(user._id);
  const telegramId = String(user.telegramId || "");
  const walletUsd = roundUsd(user.totalProfit);
  const frozenSaleUsd = roundUsd(user.frozenSaleUsd);
  const reservedUsd = roundUsd(user.reservedWithdrawalUsd);
  const availableUsd = roundUsd(walletUsd - reservedUsd - frozenSaleUsd);
  const creditsUsd = creditsMap.get(userId) || 0;
  const withdrawalsUsd = withdrawalsMap.get(userId) || 0;
  const expectedFromLedger = roundUsd(creditsUsd - withdrawalsUsd);
  const ledgerDelta = roundUsd(walletUsd - expectedFromLedger);
  const holds = holdsMap.get(telegramId) || {
    count: 0,
    frozenUsd: 0,
    grossUsd: 0,
    legacyCount: 0,
    logs: [],
  };
  const autosaleWorkerShareUsd = autosaleShareMap.get(telegramId) || 0;
  const holdDelta = roundUsd(frozenSaleUsd - holds.frozenUsd);
  const holdTypeSummary = summarizeHoldTypes(holds.logs);
  const reconciliationIssues = [];
  const notices = [];

  if (Math.abs(ledgerDelta) >= 0.05) {
    const abs = Math.abs(ledgerDelta).toFixed(2);
    const sign = ledgerDelta >= 0 ? "+" : "−";
    reconciliationIssues.push({
      code: "ledger_mismatch",
      severity: Math.abs(ledgerDelta) >= 1 ? "high" : "low",
      label: `Баланс ${sign}$${abs}`,
      message:
        ledgerDelta >= 0
          ? `Баланс на $${abs} больше, чем сумма начислений минус выводы ($${expectedFromLedger.toFixed(2)}).`
          : `Баланс на $${abs} меньше, чем сумма начислений минус выводы ($${expectedFromLedger.toFixed(2)}).`,
      deltaUsd: ledgerDelta,
    });
  }
  if (Math.abs(holdDelta) >= 0.05) {
    const abs = Math.abs(holdDelta).toFixed(2);
    const sign = holdDelta >= 0 ? "+" : "−";
    reconciliationIssues.push({
      code: "hold_mismatch",
      severity: Math.abs(holdDelta) >= 1 ? "high" : "low",
      label: `Заморозка ${sign}$${abs}`,
      message:
        holdDelta >= 0
          ? `В профиле заморожено на $${abs} больше, чем сумма активных холдов ($${holds.frozenUsd.toFixed(2)}).`
          : `В профиле заморожено на $${abs} меньше, чем сумма активных холдов ($${holds.frozenUsd.toFixed(2)}).`,
      deltaUsd: holdDelta,
    });
  }
  if (frozenSaleUsd > walletUsd + 0.005) {
    const over = roundUsd(frozenSaleUsd - walletUsd);
    reconciliationIssues.push({
      code: "frozen_exceeds_wallet",
      severity: "high",
      label: "Заморозка > баланса",
      message: `Заморожено $${frozenSaleUsd.toFixed(2)} — больше, чем баланс $${walletUsd.toFixed(2)}.`,
      deltaUsd: over,
    });
  }
  if (holds.legacyCount > 0) {
    notices.push({
      code: "legacy_hold",
      severity: "info",
      label: `Старый холд ×${holds.legacyCount}`,
      message: `Устаревший формат холда: ${holds.legacyCount} шт. (заморожена полная сумма продажи, не только доля воркера).`,
      deltaUsd: 0,
    });
  }

  const issues = [...reconciliationIssues, ...notices];
  return {
    telegramId,
    username: String(user.username || ""),
    firstName: String(user.firstName || ""),
    customId: String(user.customId || ""),
    displayName: displayName(user),
    profitPercent: Number(user.profitPercent || 70),
    walletUsd,
    frozenSaleUsd,
    reservedUsd,
    availableUsd,
    creditsUsd,
    withdrawalsUsd,
    expectedFromLedger,
    ledgerDelta,
    activeHolds: holds.count,
    activeHoldFrozenUsd: holds.frozenUsd,
    activeHoldGrossUsd: holds.grossUsd,
    legacyHoldCount: holds.legacyCount,
    autosaleWorkerShareUsd,
    holdDelta,
    holdTypeSummary,
    issueCount: reconciliationIssues.length,
    issues,
    reconciliationIssues,
    notices,
    holds: holds.logs,
  };
}

async function getAdminFinanceOverview({ q = "", issuesOnly = false, limit = 80 } = {}) {
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 80));
  const needle = String(q || "").trim().toLowerCase();

  const users = await User.find({
    telegramId: { $not: /^padmin:/i },
    $or: [
      { totalProfit: { $gt: 0 } },
      { frozenSaleUsd: { $gt: 0 } },
      { reservedWithdrawalUsd: { $gt: 0 } },
    ],
  })
    .select(
      "telegramId username firstName customId profitPercent totalProfit frozenSaleUsd reservedWithdrawalUsd"
    )
    .lean();

  const userIds = users.map((user) => user._id);
  const [creditsMap, withdrawalsMap, holdsMap, autosaleShareMap] = await Promise.all([
    sumCreditsByUserIds(userIds),
    sumWithdrawalsByUserIds(userIds),
    activeHoldRowsByOwner(),
    sumAutosaleWorkerShareByOwner(),
  ]);

  let workers = users.map((user) =>
    buildWorkerRow(user, creditsMap, withdrawalsMap, holdsMap, autosaleShareMap)
  );

  if (needle) {
    workers = workers.filter((row) =>
      [
        row.telegramId,
        row.username,
        row.firstName,
        row.customId,
        row.displayName,
      ].some((value) => String(value || "").toLowerCase().includes(needle))
    );
  }
  if (issuesOnly) {
    workers = workers.filter((row) => row.issueCount > 0);
  }

  workers.sort((a, b) => {
    if (b.issueCount !== a.issueCount) return b.issueCount - a.issueCount;
    return b.walletUsd - a.walletUsd;
  });

  const slice = workers.slice(0, safeLimit);
  const totals = workers.reduce(
    (acc, row) => {
      acc.workers += 1;
      acc.walletUsd = roundUsd(acc.walletUsd + row.walletUsd);
      acc.frozenSaleUsd = roundUsd(acc.frozenSaleUsd + row.frozenSaleUsd);
      acc.reservedUsd = roundUsd(acc.reservedUsd + row.reservedUsd);
      acc.availableUsd = roundUsd(acc.availableUsd + row.availableUsd);
      acc.activeHoldFrozenUsd = roundUsd(acc.activeHoldFrozenUsd + row.activeHoldFrozenUsd);
      acc.activeHoldGrossUsd = roundUsd(acc.activeHoldGrossUsd + row.activeHoldGrossUsd);
      acc.teamShareOnHoldUsd = roundUsd(
        acc.teamShareOnHoldUsd + Math.max(0, row.activeHoldGrossUsd - row.activeHoldFrozenUsd)
      );
      acc.autosaleWorkerShareUsd = roundUsd(
        acc.autosaleWorkerShareUsd + row.autosaleWorkerShareUsd
      );
      if (row.issueCount > 0) acc.workersWithIssues += 1;
      return acc;
    },
    {
      workers: 0,
      workersWithIssues: 0,
      walletUsd: 0,
      frozenSaleUsd: 0,
      reservedUsd: 0,
      availableUsd: 0,
      activeHoldFrozenUsd: 0,
      activeHoldGrossUsd: 0,
      teamShareOnHoldUsd: 0,
      autosaleWorkerShareUsd: 0,
    }
  );

  return {
    totals,
    workers: slice,
    truncated: workers.length > slice.length,
    totalMatched: workers.length,
  };
}

async function listAdminFinanceTransactions({ limit = 40, telegramId = "" } = {}) {
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 40));
  const filter = {};
  if (telegramId) {
    const user = await User.findOne({ telegramId: String(telegramId) }).select("_id").lean();
    if (!user) return [];
    filter.userId = user._id;
  }

  const rows = await ProfitTransaction.find(filter)
    .sort({ createdAt: -1 })
    .limit(safeLimit)
    .lean();
  const enriched = await enrichProfitsWithSourceId(rows);
  const txIds = enriched.map((row) => String(row._id || "")).filter(Boolean);
  const logMeta = await buildCreditLogMeta(txIds);
  const userIds = [...new Set(enriched.map((row) => String(row.userId || "")).filter(Boolean))];
  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } })
        .select("telegramId username firstName")
        .lean()
    : [];
  const userById = new Map(users.map((user) => [String(user._id), user]));

  return enriched.map((row) => {
    const user = userById.get(String(row.userId || ""));
    const creditedUsd =
      row.kind === CREDIT_KINDS.PROFIT
        ? roundUsd(row.workerShare)
        : roundUsd(row.amount);
    const txId = String(row._id || "");
    const steamMeta = {
      ...(logMeta.metaByTxId.get(txId) || {}),
      sourceId: String(row.sourceId || logMeta.metaByTxId.get(txId)?.sourceId || ""),
      autoSaleTxIds: logMeta.autoSaleTxIds,
      mafileTxIds: logMeta.mafileTxIds,
    };
    const source = resolveCreditSourceType(row, steamMeta);
    const saleGrossUsd =
      row.kind === CREDIT_KINDS.PROFIT && creditedUsd !== roundUsd(row.amount)
        ? roundUsd(row.amount)
        : null;
    return {
      id: String(row._id || ""),
      createdAt: row.createdAt || null,
      kind: row.kind || CREDIT_KINDS.PROFIT,
      sourceType: source.type,
      sourceTypeLabel: source.label,
      note: String(row.note || ""),
      amountUsd: roundUsd(row.amount),
      workerShareUsd: roundUsd(row.workerShare),
      creditedUsd,
      saleGrossUsd,
      workerPercent: Number(row.workerPercent || 0),
      sourceId: String(row.sourceId || steamMeta.sourceId || ""),
      owner: user
        ? {
            telegramId: String(user.telegramId || ""),
            username: String(user.username || ""),
            firstName: String(user.firstName || ""),
            displayName: displayName(user),
          }
        : null,
    };
  });
}

module.exports = {
  getAdminFinanceOverview,
  listAdminFinanceTransactions,
};
