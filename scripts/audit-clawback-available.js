/**
 * Audit auto-sale logs: LZT phase vs worker balance (frozen vs available).
 *
 * Usage:
 *   node scripts/audit-clawback-available.js
 */
const mongoose = require("mongoose");
const { validateEnv } = require("../src/config/env");
const { connectDatabase } = require("../src/config/db");
const SteamLog = require("../src/models/SteamLog");
const User = require("../src/models/User");
const {
  getItem,
  classifyLztSaleState,
  fetchActiveClaimByItemId,
} = require("../src/services/lztMarketService");
const { shouldClawbackForLztPhase } = require("../src/services/autoLogSaleService");

const SLEEP_MS = 300;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function roundUsd(value) {
  return Number(Number(value || 0).toFixed(2));
}

async function resolveLztPhase(log, claimMap) {
  const itemId = String(log.lztItemId || "").trim();
  if (!itemId) {
    return { phase: "missing_id", error: "missing lztItemId" };
  }
  if (claimMap.has(itemId)) {
    return { phase: "active_claim", error: "" };
  }
  try {
    const item = await getItem(itemId);
    return { phase: classifyLztSaleState(item), error: "", itemState: item?.item_state || item?.state || "" };
  } catch (error) {
    if (error.code === "LZT_NOT_FOUND") {
      return { phase: "terminal_unsold", error: "", itemState: "404" };
    }
    return { phase: "error", error: String(error.message || error), itemState: "" };
  }
}

async function main() {
  validateEnv();
  await connectDatabase();

  let claimMap = new Map();
  try {
    claimMap = await fetchActiveClaimByItemId();
  } catch (error) {
    console.warn("Claims fetch failed (continuing):", error.message);
  }

  const logs = await SteamLog.find({
    autoSaleStatus: { $in: ["sold_held", "arbitration", "released"] },
    lztItemId: { $ne: "" },
  })
    .select(
      "sourceId ownerTelegramId lztItemId autoSaleStatus autoSaleProfitTxId autoSaleWorkerShareUsd autoSaleGrossUsd autoSaleReleasedAt"
    )
    .lean();

  const rows = [];
  for (const log of logs) {
    const { phase, error: phaseError, itemState } = await resolveLztPhase(log, claimMap);
    const hasTx = Boolean(String(log.autoSaleProfitTxId || "").trim());
    const wouldClaw = shouldClawbackForLztPhase(phase, log.autoSaleStatus, hasTx);
    const user = log.ownerTelegramId
      ? await User.findOne({ telegramId: String(log.ownerTelegramId) })
          .select("telegramId username totalProfit frozenSaleUsd reservedWithdrawalUsd")
          .lean()
      : null;
    const share = roundUsd(log.autoSaleWorkerShareUsd);
    const isReleased = String(log.autoSaleStatus) === "released";
    const fundType = isReleased ? "available" : "frozen";

    rows.push({
      sourceId: String(log.sourceId || ""),
      ownerTelegramId: String(log.ownerTelegramId || ""),
      username: user?.username || "",
      status: String(log.autoSaleStatus || ""),
      phase,
      itemState: itemState || "",
      hasTx,
      wouldClaw,
      shareUsd: share,
      fundType,
      totalProfit: roundUsd(user?.totalProfit),
      frozenSaleUsd: roundUsd(user?.frozenSaleUsd),
      reservedUsd: roundUsd(user?.reservedWithdrawalUsd),
      availableUsd: roundUsd(
        Number(user?.totalProfit || 0) -
          Number(user?.frozenSaleUsd || 0) -
          Number(user?.reservedWithdrawalUsd || 0)
      ),
      phaseError,
    });
    await sleep(SLEEP_MS);
  }

  const byStatus = {};
  const byPhase = {};
  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;
    byPhase[row.phase] = (byPhase[row.phase] || 0) + 1;
  }

  const deletedWithCredit = rows.filter((r) => r.phase === "terminal_unsold" && r.hasTx);
  const unknownWithCredit = rows.filter((r) => r.phase === "unknown" && r.hasTx);
  const releasedDeleted = rows.filter(
    (r) => r.status === "released" && r.phase === "terminal_unsold" && r.hasTx
  );
  const releasedUnknown = rows.filter(
    (r) => r.status === "released" && r.phase === "unknown" && r.hasTx
  );
  const suspicious = rows.filter(
    (r) =>
      (r.phase === "terminal_unsold" || r.phase === "unknown") &&
      r.hasTx &&
      !r.wouldClaw
  );
  const eligible = rows.filter((r) => r.wouldClaw);
  const eligibleAvailable = eligible.filter((r) => r.fundType === "available");
  const eligibleFrozen = eligible.filter((r) => r.fundType === "frozen");

  console.log(
    JSON.stringify(
      {
        total: rows.length,
        byStatus,
        byPhase,
        eligible: eligible.length,
        eligibleAvailable: eligibleAvailable.length,
        eligibleFrozen: eligibleFrozen.length,
        eligibleAvailableUsd: roundUsd(eligibleAvailable.reduce((s, r) => s + r.shareUsd, 0)),
        eligibleFrozenUsd: roundUsd(eligibleFrozen.reduce((s, r) => s + r.shareUsd, 0)),
        deletedWithCredit: deletedWithCredit.length,
        unknownWithCredit: unknownWithCredit.length,
        releasedDeleted,
        releasedUnknown,
        suspicious,
        eligible,
        rows,
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
