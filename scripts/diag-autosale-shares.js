const { env } = require("../src/config/env");
const mongoose = require("mongoose");
const SteamLog = require("../src/models/SteamLog");
const { getAutoSaleStats } = require("../src/services/autoLogSaleService");

(async () => {
  await mongoose.connect(env.mongoUri);
  const stats = await getAutoSaleStats();
  const released = await SteamLog.find({ autoSaleStatus: "released" })
    .select("sourceId autoSaleWorkerShareUsd autoSaleGrossUsd")
    .lean();
  const zeroShare = released.filter((r) => !(Number(r.autoSaleWorkerShareUsd) > 0));
  const held = await SteamLog.aggregate([
    { $match: { autoSaleStatus: { $in: ["sold_held", "arbitration"] } } },
    {
      $group: {
        _id: null,
        share: { $sum: "$autoSaleWorkerShareUsd" },
        gross: { $sum: "$autoSaleGrossUsd" },
      },
    },
  ]);
  console.log(
    JSON.stringify(
      {
        stats,
        releasedCount: released.length,
        releasedZeroShare: zeroShare.length,
        zeroShareSample: zeroShare.slice(0, 5).map((r) => ({
          id: r.sourceId,
          gross: r.autoSaleGrossUsd,
          share: r.autoSaleWorkerShareUsd,
        })),
        heldAgg: held[0] || null,
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
