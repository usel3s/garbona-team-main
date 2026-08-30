const { env } = require("../src/config/env");
const mongoose = require("mongoose");
const SteamLog = require("../src/models/SteamLog");
const User = require("../src/models/User");

(async () => {
  await mongoose.connect(env.mongoUri);
  const sold = await SteamLog.find({
    autoSaleStatus: { $in: ["sold_held", "arbitration", "released"] },
  })
    .select("sourceId ownerTelegramId autoSaleStatus autoSaleWorkerShareUsd autoSaleGrossUsd autoSaleProfitTxId")
    .lean();

  const users = await User.find({ telegramId: { $in: [...new Set(sold.map((r) => r.ownerTelegramId))] } })
    .select("telegramId profitPercent")
    .lean();
  const pctByTg = new Map(users.map((u) => [String(u.telegramId), Number(u.profitPercent || 80)]));

  let missingShareGross = 0;
  let missingShareCount = 0;
  const samples = [];
  for (const row of sold) {
    const gross = Number(row.autoSaleGrossUsd || 0);
    const share = Number(row.autoSaleWorkerShareUsd || 0);
    if (gross > 0 && share <= 0) {
      missingShareCount += 1;
      const pct = pctByTg.get(String(row.ownerTelegramId)) || 80;
      const est = Number(((gross * pct) / 100).toFixed(2));
      missingShareGross += est;
      if (samples.length < 8) {
        samples.push({
          id: row.sourceId,
          status: row.autoSaleStatus,
          gross,
          share,
          est,
          tx: row.autoSaleProfitTxId || "",
        });
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        soldCount: sold.length,
        missingShareCount,
        missingShareGrossEst: Number(missingShareGross.toFixed(2)),
        samples,
      },
      null,
      2
    )
  );
  await mongoose.disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
