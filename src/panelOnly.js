const { Telegraf } = require("telegraf");
const { env, validateEnv } = require("./config/env");
const { connectDatabase } = require("./config/db");
const { startPanelServer } = require("./panel/httpServer");
const { logger } = require("./utils/logger");

async function bootstrap() {
  validateEnv();
  await connectDatabase();

  const { seedPanelAdminsOnBoot } = require("./services/panelAdminService");
  await seedPanelAdminsOnBoot();
  const { migrateLegacyPanelPasswords } = require("./services/panelAccountService");
  const migratedPanelPasswords = await migrateLegacyPanelPasswords();
  if (migratedPanelPasswords) logger.info(`Encrypted ${migratedPanelPasswords} legacy panel credential(s)`);
  const { backfillWithdrawalReserves, loadWithdrawalFees } = require("./services/withdrawalService");
  const reconciledWithdrawalReserves = await backfillWithdrawalReserves();
  if (reconciledWithdrawalReserves) logger.info(`Reconciled ${reconciledWithdrawalReserves} withdrawal reserve(s)`);
  await loadWithdrawalFees();

  const { syncAllWorkerSteamSettings } = require("./services/workerSteamSettingsService");
  try {
    const steamSettingsSync = await syncAllWorkerSteamSettings({ outdatedOnly: true, concurrency: 3 });
    if (steamSettingsSync.total) logger.info("Worker Steam settings synchronized", steamSettingsSync);
  } catch (error) {
    logger.warn("Worker Steam settings backfill failed", error.message);
  }

  // Routers expect a Telegraf instance for rare notify calls.
  // Do not launch polling / monitors — panel HTTP only.
  const bot = new Telegraf(env.botToken);
  startPanelServer(bot);

  logger.info("Panel-only mode (bot, steam monitor, dynamic pin disabled)");

  process.once("SIGINT", () => process.exit(0));
  process.once("SIGTERM", () => process.exit(0));
}

bootstrap().catch((error) => {
  logger.error("Panel-only bootstrap failed", error);
  process.exit(1);
});
