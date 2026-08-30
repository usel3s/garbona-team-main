const { env } = require("../src/config/env");
const mongoose = require("mongoose");
const { getAdminFinanceOverview } = require("../src/services/adminFinanceService");

(async () => {
  await mongoose.connect(env.mongoUri);
  const overview = await getAdminFinanceOverview({ limit: 500 });
  const t = overview.totals;
  const withAvailable = overview.workers.filter((w) => w.availableUsd > 0);
  console.log(
    JSON.stringify(
      {
        workers: t.workers,
        walletUsd: t.walletUsd,
        frozenSaleUsd: t.frozenSaleUsd,
        reservedUsd: t.reservedUsd,
        availableUsd: t.availableUsd,
        workersWithAvailable: withAvailable.length,
        sample: withAvailable.slice(0, 5).map((w) => ({
          tg: w.telegramId,
          wallet: w.walletUsd,
          frozen: w.frozenSaleUsd,
          reserved: w.reservedUsd,
          available: w.availableUsd,
        })),
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
