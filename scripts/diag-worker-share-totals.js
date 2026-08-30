const { env } = require("../src/config/env");
const mongoose = require("mongoose");
const { getAutoSaleStats } = require("../src/services/autoLogSaleService");
const { getAdminFinanceOverview } = require("../src/services/adminFinanceService");

(async () => {
  await mongoose.connect(env.mongoUri);
  const stats = await getAutoSaleStats();
  const finance = await getAdminFinanceOverview({ limit: 500 });
  console.log(
    JSON.stringify(
      {
        autosales: {
          workerShareTotalUsd: stats.workerShareTotalUsd,
          workerShareOnHoldUsd: stats.workerShareOnHoldUsd,
          workerShareReleasedUsd: stats.workerShareReleasedUsd,
          teamShareUsd: stats.teamShareUsd,
        },
        finance: {
          availableUsd: finance.totals.availableUsd,
          autosaleWorkerShareUsd: finance.totals.autosaleWorkerShareUsd,
          walletUsd: finance.totals.walletUsd,
          frozenSaleUsd: finance.totals.frozenSaleUsd,
        },
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
