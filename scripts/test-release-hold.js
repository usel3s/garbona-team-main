/**
 * Ручной прогон releaseHold() на одном тестовом логе — без ожидания реального
 * 12-часового холда LZT. Использование:
 *   node scripts/test-release-hold.js <sourceId>
 *
 * ВАЖНО: гоняйте это только на тестовом логе, принадлежащем воркеру с тестовым
 * (не боевым) телеграм-аккаунтом, и только с TREASURY_PAYOUT_DRY_RUN=true либо
 * на тестнет-ключах — скрипт форсирует статус sold_held и реально вызывает
 * releaseHold(), который при включённой фиче инициирует on-chain перевод.
 */
const { env } = require("../src/config/env");
const mongoose = require("mongoose");
const SteamLog = require("../src/models/SteamLog");
const User = require("../src/models/User");
const { releaseHold, bindTelegram } = require("../src/services/autoLogSaleService");

(async () => {
  const sourceId = String(process.argv[2] || "").trim();
  if (!sourceId) {
    console.error("Usage: node scripts/test-release-hold.js <sourceId>");
    process.exit(1);
  }

  await mongoose.connect(env.mongoUri);
  bindTelegram({ sendMessage: async () => {} }); // no real Telegram in this script

  const log = await SteamLog.findOne({ sourceId });
  if (!log) {
    console.error(`SteamLog with sourceId=${sourceId} not found.`);
    process.exit(1);
  }

  console.log("Before:", {
    autoSaleStatus: log.autoSaleStatus,
    autoSaleWorkerShareUsd: log.autoSaleWorkerShareUsd,
    autoPayoutStatus: log.autoPayoutStatus,
  });

  log.autoSaleStatus = "sold_held";
  log.autoSaleReleasedAt = null;
  log.autoPayoutStatus = "none";
  log.autoPayoutError = "";
  await log.save();

  const result = await releaseHold(log);

  // Give the fire-and-forget triggerInternalTransfer() a moment to finish
  // before reading back the row (it's not awaited by releaseHold itself).
  await new Promise((r) => setTimeout(r, 3000));

  const fresh = await SteamLog.findById(result._id);
  console.log("After:", {
    autoSaleStatus: fresh.autoSaleStatus,
    autoSaleWorkerShareUsd: fresh.autoSaleWorkerShareUsd,
    autoPayoutStatus: fresh.autoPayoutStatus,
    autoPayoutTxId: fresh.autoPayoutTxId,
    autoPayoutError: fresh.autoPayoutError,
  });

  if (fresh.ownerTelegramId) {
    const owner = await User.findOne({ telegramId: fresh.ownerTelegramId }).lean();
    console.log("Owner treasury wallet:", {
      treasuryWalletIndex: owner?.treasuryWalletIndex,
      treasuryAddresses: owner?.treasuryAddresses,
      treasuryWalletBalanceUsd: owner?.treasuryWalletBalanceUsd,
    });
  }

  await mongoose.disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
