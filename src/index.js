const { Telegraf, session, Scenes } = require("telegraf");
const { env, validateEnv } = require("./config/env");
const { connectDatabase } = require("./config/db");
const { registerStartCommand } = require("./commands/start");
const { registerFeedbackCommand } = require("./commands/feedback");
const { registerCuratorCommand } = require("./commands/curator");
const { registerBranchCommand } = require("./commands/branch");
const { registerCallerCommand } = require("./commands/caller");
const { registerMpCommand } = require("./commands/mp");
const { registerTopCommands } = require("./commands/top");
const { registerModerationCommands } = require("./commands/moderation");
const { registerCallbackHandlers } = require("./handlers/callbackHandler");
const { registerBranchHandlers } = require("./handlers/branchHandler");
const { registerTextHandlers } = require("./handlers/textHandler");
const { registerInlineHandlers } = require("./handlers/inlineHandler");
const { registerServiceMessageHandlers } = require("./handlers/serviceMessageHandler");
const { registerDiscordVerifyHandlers } = require("./handlers/discordVerifyHandler");
const { applicationScene } = require("./scenes/applicationScene");
const { postbotScene } = require("./scenes/postbotScene");
const { broadcastScene } = require("./scenes/broadcastScene");
const { registerSitesHandlers } = require("./handlers/sitesHandler");
const { startSteamMonitor, recheckSteamId } = require("./services/steamMonitorService");
const { isAdminTelegramId } = require("./services/userService");
const { logger } = require("./utils/logger");
const { pe } = require("./utils/emoji");
const {
  isIgnorableTelegramError,
  getTelegramErrorText,
  patchSafeAnswerCbQuery,
} = require("./utils/telegramSafe");
const { clearPendingInputs, isBotCommandText } = require("./utils/session");

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

  const { backfillTeamCustomIds } = require("./services/userService");
  try {
    const result = await backfillTeamCustomIds();
    if (result.updated > 0) {
      logger.info(`Assigned customId to ${result.updated} team member(s)`);
    }
  } catch (error) {
    logger.warn("customId backfill failed", error.message);
  }

  const bot = new Telegraf(env.botToken);
  const stage = new Scenes.Stage([applicationScene, postbotScene, broadcastScene]);

  bot.use(session());

  bot.use(async (ctx, next) => {
    patchSafeAnswerCbQuery(ctx);
    return next();
  });

  // Любая команда (/start и др.) сбрасывает ожидание ввода вне сцен.
  bot.use(async (ctx, next) => {
    if (ctx.message?.text && isBotCommandText(ctx.message.text)) {
      clearPendingInputs(ctx);
    }
    return next();
  });

  bot.use(stage.middleware());

  bot.use(async (ctx, next) => {
    try {
      await next();
    } catch (error) {
      if (isIgnorableTelegramError(error)) {
        logger.warn("Ignored telegram error", getTelegramErrorText(error));
        return;
      }

      logger.error("Unhandled bot error", error);

      try {
        if (ctx.callbackQuery) {
          await ctx.answerCbQuery("Ошибка. Попробуй ещё раз", { show_alert: true });
        }
      } catch (_) {
        /* ignore */
      }

      try {
        if (ctx.chat?.id) {
          await ctx.reply(`${pe("error")} Произошла ошибка. Попробуй ещё раз позже.`, {
            parse_mode: "HTML",
          });
        }
      } catch (_) {
        /* ignore */
      }
    }
  });

  bot.catch((error, ctx) => {
    if (isIgnorableTelegramError(error)) {
      logger.warn("Ignored telegraf catch error", getTelegramErrorText(error));
      return;
    }
    logger.error("Telegraf catch", error, ctx?.updateType || "");
  });

  registerServiceMessageHandlers(bot);
  registerStartCommand(bot);
  registerFeedbackCommand(bot);
  registerCuratorCommand(bot);
  registerBranchCommand(bot);
  registerCallerCommand(bot);
  registerMpCommand(bot);
  registerTopCommands(bot);
  registerModerationCommands(bot);
  registerCallbackHandlers(bot);
  registerBranchHandlers(bot);
  registerDiscordVerifyHandlers(bot);
  registerSitesHandlers(bot);
  registerInlineHandlers(bot);
  registerTextHandlers(bot);
  bot.command("recheck_steam", async (ctx) => {
    if (!isAdminTelegramId(ctx.from.id)) {
      await ctx.reply(`${pe("error")} Недостаточно прав.`, { parse_mode: "HTML" });
      return;
    }
    const steamId = String(ctx.message?.text || "").split(/\s+/)[1];
    if (!steamId) {
      await ctx.reply(`${pe("info")} Использование: <code>/recheck_steam &lt;id&gt;</code>`, { parse_mode: "HTML" });
      return;
    }
    try {
      await ctx.reply(`${pe("loading")} Запускаю проверку Steam ID <code>${steamId}</code>.`, { parse_mode: "HTML" });
      const log = await recheckSteamId(bot, steamId);
      await ctx.reply(`${pe("success")} Проверка завершена.\nСтатус: <b>${log.status}</b>${log.errorMessage ? `\n${pe("error")} ${log.errorMessage}` : ""}`, { parse_mode: "HTML" });
    } catch (error) {
      await ctx.reply(`${pe("error")} ${error.message}`, { parse_mode: "HTML" });
    }
  });

  process.on("unhandledRejection", (reason) => {
    if (isIgnorableTelegramError(reason)) {
      logger.warn("Ignored unhandledRejection", getTelegramErrorText(reason));
      return;
    }
    logger.error("Unhandled rejection", reason);
  });

  process.on("uncaughtException", (error) => {
    if (isIgnorableTelegramError(error)) {
      logger.warn("Ignored uncaughtException", getTelegramErrorText(error));
      return;
    }
    logger.error("Uncaught exception", error);
  });

  const { startPanelServer } = require("./panel/httpServer");
  startPanelServer(bot);

  const { startDiscordBot, stopDiscordBot } = require("./discord");
  startDiscordBot().catch((error) => {
    logger.error("Discord bot failed to start", error);
  });

  // Steam monitor + pin must NOT wait on bot.launch — Telegraf can hang on
  // getMe/429 while the panel is already up, and new valid logs would never send.
  startSteamMonitor(bot);
  const {
    startAutoLogSaleMonitor,
    syncExistingAutoSalesFromUproject,
    bindTelegram: bindAutoSaleTelegram,
  } = require("./services/autoLogSaleService");
  bindAutoSaleTelegram(bot.telegram);
  startAutoLogSaleMonitor();
  void syncExistingAutoSalesFromUproject()
    .then((result) => {
      if (result?.skipped) return;
      logger.info("Auto sale backfill from UProject", result);
    })
    .catch((error) => {
      logger.warn("Auto sale backfill failed", error.message);
    });
  const { syncUprojectTeamShareDebits } = require("./services/uprojectTeamShareService");
  void syncUprojectTeamShareDebits()
    .then((result) => {
      if (result?.imported || result?.canceled) {
        logger.info("UProject team-share debits synced", result);
      }
    })
    .catch((error) => {
      logger.warn("UProject team-share sync failed", error.message);
    });
  const { migrateDefaultWorkerPercentTo70 } = require("./services/workerPercentAnnounceService");
  void migrateDefaultWorkerPercentTo70(bot.telegram)
    .then((result) => {
      if (result?.skipped) return;
      logger.info("Worker percent migrated to 70", {
        previous: result.previous,
        usersUpdated: result.usersUpdated,
        broadcast: result.announced?.broadcast,
      });
    })
    .catch((error) => {
      logger.warn("Worker percent migration failed", error.message);
    });
  const { startDynamicPinScheduler } = require("./services/dynamicPinService");
  startDynamicPinScheduler(bot);
  const { scheduleDailyArrivalDigest } = require("./services/dailyArrivalDigestService");
  scheduleDailyArrivalDigest(bot);

  // Launch is best-effort and must not block the event loop forever on 429/getMe.
  void bot
    .launch({
      allowedUpdates: [
        "message",
        "callback_query",
        "inline_query",
        "chosen_inline_result",
      ],
      dropPendingUpdates: true,
    })
    .then(() => {
      logger.info("Bot polling started");
    })
    .catch((error) => {
      if (isIgnorableTelegramError(error)) {
        logger.warn("Bot launch deferred by Telegram rate limit", getTelegramErrorText(error));
      } else {
        logger.error("Bot launch failed", error);
      }
    });

  // Telegram setup is best-effort; never block panel availability on these calls.
  void (async () => {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    try {
      const me = await bot.telegram.getMe();
      if (me?.username && !env.botUsername) {
        env.botUsername = me.username;
      }
    } catch (error) {
      logger.warn("Failed to resolve bot username", getTelegramErrorText(error));
    }

    try {
      await bot.telegram.setMyCommands([
        { command: "start", description: "Главное меню" },
        { command: "feedback", description: "Фидбек: баг, вопрос или идея" },
      ]);
    } catch (error) {
      logger.warn("Failed to set bot commands", getTelegramErrorText(error));
    }

    try {
      const { workerPanelAppUrl } = require("./utils/panelLinks");
      const panelUrl = workerPanelAppUrl();
      if (panelUrl) {
        await bot.telegram.setChatMenuButton({
          menu_button: {
            type: "web_app",
            text: "Панель",
            web_app: { url: panelUrl },
          },
        });
      }
    } catch (error) {
      logger.warn("Failed to set chat menu button", getTelegramErrorText(error));
    }
  })();

  async function shutdown(signal) {
    try {
      await stopDiscordBot();
    } catch (error) {
      logger.warn("Discord shutdown failed", error.message);
    }
    try {
      bot.stop(signal);
    } catch (error) {
      if (!/not running/i.test(String(error?.message || error))) {
        logger.warn("Bot stop failed", error.message || error);
      }
    }
  }

  process.once("SIGINT", () => {
    shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    shutdown("SIGTERM");
  });
}

bootstrap().catch((error) => {
  logger.error("Bootstrap failed", error);
  process.exit(1);
});
