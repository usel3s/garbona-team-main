/**
 * Audit balance mismatches: refunded/stale logs, available vs credited.
 */
const mongoose = require("mongoose");
const { validateEnv } = require("../src/config/env");
const { connectDatabase } = require("../src/config/db");
const SteamLog = require("../src/models/SteamLog");
const User = require("../src/models/User");
const ProfitTransaction = require("../src/models/ProfitTransaction");

function roundUsd(value) {
  return Number(Number(value || 0).toFixed(2));
}

async function main() {
  validateEnv();
  await connectDatabase();

  const refunded = await SteamLog.find({ autoSaleStatus: "refunded" })
    .select(
      "sourceId ownerTelegramId autoSaleWorkerShareUsd autoSaleProfitTxId lztItemId autoSaleError updatedAt"
    )
    .lean();

  const staleSoldHeld = await SteamLog.find({
    autoSaleStatus: "sold_held",
    $or: [{ autoSaleProfitTxId: "" }, { autoSaleProfitTxId: null }],
    lztItemId: { $ne: "" },
  })
    .select(
      "sourceId ownerTelegramId lztItemId autoSaleWorkerShareUsd autoSaleGrossUsd autoSaleError"
    )
    .lean();

  const releasedNoTx = await SteamLog.find({
    autoSaleStatus: "released",
    $or: [{ autoSaleProfitTxId: "" }, { autoSaleProfitTxId: null }],
    autoSaleWorkerShareUsd: { $gt: 0 },
  })
    .select("sourceId ownerTelegramId autoSaleWorkerShareUsd lztItemId")
    .lean();

  const workers = await User.find({ totalProfit: { $gt: 0 } })
    .select("telegramId username totalProfit frozenSaleUsd reservedWithdrawalUsd")
    .sort({ totalProfit: -1 })
    .lean();

  const autoSaleTxs = await ProfitTransaction.find({ kind: "auto_sale" })
    .select("_id userId workerShare note createdAt")
    .lean();

  const allCreditedLogs = await SteamLog.find({
    autoSaleProfitTxId: { $ne: "" },
  })
    .select("sourceId autoSaleStatus autoSaleProfitTxId autoSaleWorkerShareUsd ownerTelegramId")
    .lean();

  const txIds = new Set(autoSaleTxs.map((t) => String(t._id)));
  const logTxIds = new Set(allCreditedLogs.map((l) => String(l.autoSaleProfitTxId)));
  const orphanTxs = autoSaleTxs.filter((t) => {
    const matched = allCreditedLogs.some((l) => String(l.autoSaleProfitTxId) === String(t._id));
    return !matched;
  });

  const logsWithMissingTx = allCreditedLogs.filter(
    (l) => !txIds.has(String(l.autoSaleProfitTxId))
  );

  console.log(
    JSON.stringify(
      {
        refundedCount: refunded.length,
        refunded,
        staleSoldHeld,
        releasedNoTx,
        workersWithBalance: workers.map((w) => ({
          tg: w.telegramId,
          user: w.username,
          total: roundUsd(w.totalProfit),
          frozen: roundUsd(w.frozenSaleUsd),
          reserved: roundUsd(w.reservedWithdrawalUsd),
          available: roundUsd(
            Number(w.totalProfit || 0) -
              Number(w.frozenSaleUsd || 0) -
              Number(w.reservedWithdrawalUsd || 0)
          ),
        })),
        autoSaleTxCount: autoSaleTxs.length,
        creditedLogsCount: allCreditedLogs.length,
        orphanTxCount: orphanTxs.length,
        orphanTxs: orphanTxs.slice(0, 20),
        logsWithMissingTxCount: logsWithMissingTx.length,
        logsWithMissingTx,
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
