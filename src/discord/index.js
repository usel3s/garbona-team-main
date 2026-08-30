const {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
} = require("discord.js");
const { env } = require("../config/env");
const { logger } = require("../utils/logger");
const { setDiscordClient, getDiscordClient } = require("./runtime");
const { registerSlashCommands } = require("./commands");
const { registerDiscordHandlers } = require("./handlers");
const { startStatusBoard, stopStatusBoard } = require("./statusBoard");
const { reconcileJoinRoles } = require("./guild");
const { reconcileProfitRoles } = require("./profitRoles");
const { initMusicPlayer } = require("./music");

function isDiscordConfigured() {
  return Boolean(String(env.discordBotToken || "").trim());
}

async function startDiscordBot() {
  if (!isDiscordConfigured()) {
    logger.info("Discord bot skipped (DISCORD_BOT_TOKEN is empty)");
    return null;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.GuildMember],
    allowedMentions: { parse: [] },
  });

  registerDiscordHandlers(client);

  client.once(Events.ClientReady, async (readyClient) => {
    setDiscordClient(readyClient);
    logger.info(`Discord bot started as ${readyClient.user.tag}`);
    if (!env.discordGuildId || !env.discordVerifiedRoleId || !env.discordUnverifiedRoleId) {
      logger.warn(
        "Discord roles skipped until DISCORD_GUILD_ID, DISCORD_UNVERIFIED_ROLE_ID and DISCORD_VERIFIED_ROLE_ID are set"
      );
    }
    try {
      await readyClient.user.setPresence({
        status: "online",
        activities: [{ name: "Garbona", type: ActivityType.Watching }],
      });
    } catch (error) {
      logger.warn("Discord presence skipped", error.message);
    }
    try {
      await initMusicPlayer(readyClient);
    } catch (error) {
      logger.warn("Discord music player init failed", error.message);
    }
    try {
      await registerSlashCommands(readyClient);
    } catch (error) {
      logger.error("Discord command registration failed", error);
    }
    try {
      startStatusBoard(readyClient);
    } catch (error) {
      logger.warn("Discord status board start failed", error.message);
    }
    // Catch members who joined while the bot was offline.
    setImmediate(() => {
      reconcileJoinRoles(readyClient).catch((error) => {
        logger.warn("Discord join roles reconcile failed", error.message);
      });
      reconcileProfitRoles(readyClient).catch((error) => {
        logger.warn("Discord profit roles reconcile failed", error.message);
      });
    });
  });

  client.on(Events.Error, (error) => {
    logger.error("Discord client error", error);
  });
  client.on(Events.Warn, (message) => {
    logger.warn("Discord client warn", message);
  });

  try {
    await client.login(env.discordBotToken);
  } catch (error) {
    logger.error("Discord login failed", error);
    logger.warn(
      "Проверь DISCORD_BOT_TOKEN и Privileged Intent Server Members Intent в Discord Developer Portal"
    );
    setDiscordClient(null);
    try {
      client.destroy();
    } catch (_) {
      /* ignore */
    }
    return null;
  }

  return client;
}

async function stopDiscordBot() {
  stopStatusBoard();
  const client = getDiscordClient();
  setDiscordClient(null);
  if (!client) return;
  try {
    await client.destroy();
    logger.info("Discord bot stopped");
  } catch (error) {
    logger.warn("Discord bot stop failed", error.message);
  }
}

module.exports = {
  isDiscordConfigured,
  startDiscordBot,
  stopDiscordBot,
};
