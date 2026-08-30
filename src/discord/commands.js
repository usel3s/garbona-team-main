const {
  ChannelType,
  InteractionContextType,
  ApplicationIntegrationType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  Routes,
} = require("discord.js");
const { env } = require("../config/env");
const { logger } = require("../utils/logger");

function buildSlashCommands() {
  return [
    new SlashCommandBuilder()
      .setName("verify")
      .setDescription("Подтвердить аккаунт Garbona и получить доступ")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .setContexts(
        InteractionContextType.Guild,
        InteractionContextType.BotDM,
        InteractionContextType.PrivateChannel
      )
      .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),
    new SlashCommandBuilder()
      .setName("verify-status")
      .setDescription("Показать статус верификации Discord")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .setContexts(
        InteractionContextType.Guild,
        InteractionContextType.BotDM,
        InteractionContextType.PrivateChannel
      )
      .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),
    new SlashCommandBuilder()
      .setName("help")
      .setDescription("Список команд бота")
      .setContexts(InteractionContextType.Guild)
      .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),
    new SlashCommandBuilder()
      .setName("ping")
      .setDescription("Задержки Discord / команд / базы")
      .setContexts(InteractionContextType.Guild)
      .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),
    new SlashCommandBuilder()
      .setName("embed")
      .setDescription("Опубликовать embed в канале")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .setContexts(InteractionContextType.Guild)
      .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
      .addStringOption((option) =>
        option
          .setName("type")
          .setDescription("Тип embed")
          .setRequired(true)
          .addChoices(
            { name: "Правила", value: "rules" },
            { name: "Памятка", value: "memo" }
          )
      )
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("Куда отправить")
          .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement,
            ChannelType.GuildForum
          )
          .setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName("play")
      .setDescription("Играть трек или плейлист (YouTube / SoundCloud)")
      .setContexts(InteractionContextType.Guild)
      .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
      .addStringOption((o) =>
        o.setName("query").setDescription("Название или ссылка (трек / плейлист)").setRequired(true)
      )
      .addStringOption((o) =>
        o
          .setName("engine")
          .setDescription("Источник поиска")
          .setRequired(false)
          .addChoices(
            { name: "YouTube (лучшее качество)", value: "youtube" },
            { name: "SoundCloud", value: "soundcloud" },
            { name: "Авто", value: "auto" }
          )
      ),
    new SlashCommandBuilder()
      .setName("skip")
      .setDescription("Пропустить текущий трек")
      .setContexts(InteractionContextType.Guild)
      .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),
    new SlashCommandBuilder()
      .setName("pause")
      .setDescription("Поставить на паузу")
      .setContexts(InteractionContextType.Guild)
      .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),
    new SlashCommandBuilder()
      .setName("resume")
      .setDescription("Продолжить воспроизведение")
      .setContexts(InteractionContextType.Guild)
      .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),
    new SlashCommandBuilder()
      .setName("stop")
      .setDescription("Остановить музыку и очистить очередь")
      .setContexts(InteractionContextType.Guild)
      .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),
    new SlashCommandBuilder()
      .setName("queue")
      .setDescription("Показать очередь")
      .setContexts(InteractionContextType.Guild)
      .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),
    new SlashCommandBuilder()
      .setName("np")
      .setDescription("Сейчас играет")
      .setContexts(InteractionContextType.Guild)
      .setIntegrationTypes(ApplicationIntegrationType.GuildInstall),
    new SlashCommandBuilder()
      .setName("warn")
      .setDescription("Выдать выговор (3 = мут на неделю)")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .setContexts(InteractionContextType.Guild)
      .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
      .addUserOption((o) => o.setName("user").setDescription("Пользователь").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("Причина").setRequired(false)),
    new SlashCommandBuilder()
      .setName("unwarn")
      .setDescription("Снять последний активный выговор")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .setContexts(InteractionContextType.Guild)
      .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
      .addUserOption((o) => o.setName("user").setDescription("Пользователь").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("Причина").setRequired(false)),
    new SlashCommandBuilder()
      .setName("mute")
      .setDescription("Замутить пользователя")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .setContexts(InteractionContextType.Guild)
      .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
      .addUserOption((o) => o.setName("user").setDescription("Пользователь").setRequired(true))
      .addStringOption((o) =>
        o
          .setName("duration")
          .setDescription("Длительность: 30m, 2h, 7d, 1w (по умолчанию 7d)")
          .setRequired(false)
      )
      .addStringOption((o) => o.setName("reason").setDescription("Причина").setRequired(false)),
    new SlashCommandBuilder()
      .setName("unmute")
      .setDescription("Снять мут")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .setContexts(InteractionContextType.Guild)
      .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
      .addUserOption((o) => o.setName("user").setDescription("Пользователь").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("Причина").setRequired(false)),
    new SlashCommandBuilder()
      .setName("ban")
      .setDescription("Выдать роль бана (доступ только к каналу апелляции)")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .setContexts(InteractionContextType.Guild)
      .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
      .addUserOption((o) => o.setName("user").setDescription("Пользователь").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("Причина").setRequired(false)),
    new SlashCommandBuilder()
      .setName("about")
      .setDescription("Карточка пользователя: Discord, Garbona, финансы, нарушения")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .setContexts(InteractionContextType.Guild)
      .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
      .addUserOption((o) => o.setName("user").setDescription("Пользователь").setRequired(true)),
  ];
}

async function registerSlashCommands(client) {
  const body = buildSlashCommands().map((command) => command.toJSON());
  const appId = client.application?.id;
  if (!appId) {
    throw new Error("Discord application id is missing");
  }

  const guildId = String(env.discordGuildId || "").trim();
  if (guildId) {
    await client.rest.put(Routes.applicationGuildCommands(appId, guildId), { body });
    logger.info(`Discord slash commands registered for guild ${guildId}`);
    return;
  }

  await client.rest.put(Routes.applicationCommands(appId), { body });
  logger.info("Discord global slash commands registered");
}

module.exports = { buildSlashCommands, registerSlashCommands };
