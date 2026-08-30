const { PermissionFlagsBits, Events, MessageFlags } = require("discord.js");
const { env } = require("../config/env");
const { logger } = require("../utils/logger");
const {
  createVerifySession,
  findUserByDiscordId,
  canVerifyUser,
  discordAvatarUrl,
  buildTelegramStartUrl,
  buildPanelVerifyUrl,
} = require("../services/discordVerifyService");
const {
  CUSTOM_IDS,
  v2Flags,
  resolveLogoMedia,
  verifyPanelComponents,
  methodChoiceContainer,
  alreadyVerifiedContainer,
  errorContainer,
  statusContainer,
  setupPostedContainer,
} = require("./components");
const { applyVerifiedAccess, applyUnverifiedAccess } = require("./guild");
const { buildEmbedPayload } = require("./embeds");
const {
  CUSTOM_IDS: MEMO_IDS,
  buildMemoSelectReply,
  notifyAckPayload,
} = require("./embeds/memo");
const {
  voicePanelPayload,
  saveVoiceConfig,
  onVoiceStateUpdate,
  handleVoiceButton,
  handleVoiceModal,
  handleVoiceUserSelect,
} = require("./voiceRooms");
const {
  supportChannelId,
  publishSupportPanel,
  handleSupportSelect,
  handleSupportModal,
  handleSupportClose,
} = require("./support");
const {
  handleModCommand,
  handleAppealButton,
  handleAppealModal,
  handleAppealStaffButton,
} = require("./moderation");
const { handleAboutButton } = require("./about");
const {
  handleHelpCommand,
  handleHelpSelect,
  handlePingCommand,
} = require("./helpPing");
const { handleMusicCommand } = require("./music");
const { ensureModerationSetup } = require("./modSetup");
const { ensureSuggestionsForum } = require("./suggestions");

function mediaFor(avatarUrl, logo) {
  if (avatarUrl && !avatarUrl.startsWith("attachment://")) {
    return { url: avatarUrl, files: [] };
  }
  return { url: avatarUrl || logo.url, files: logo.files };
}

function discordIdentity(user) {
  return {
    discordId: user.id,
    discordUsername: user.username || "",
    discordGlobalName: user.globalName || user.displayName || "",
    discordAvatarUrl: user.displayAvatarURL({ size: 256, extension: "png" }),
  };
}

async function replyV2(interaction, container, { ephemeral = true, files = [] } = {}) {
  const payload = {
    flags: v2Flags(ephemeral),
    components: [container],
  };
  if (files.length) payload.files = files;
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(payload);
  }
  return interaction.reply(payload);
}

async function startVerifyFlow(interaction) {
  const logo = resolveLogoMedia();
  const identity = discordIdentity(interaction.user);
  const media = mediaFor(identity.discordAvatarUrl, logo);
  const existing = await findUserByDiscordId(identity.discordId);

  if (existing) {
    if (!canVerifyUser(existing)) {
      await replyV2(
        interaction,
        errorContainer(
          "Нет доступа",
          existing.isBanned
            ? "Аккаунт Garbona заблокирован."
            : "Этот Discord привязан к аккаунту, который больше не в команде.",
          media.url
        ),
        { files: media.files }
      );
      return;
    }
    const access = await applyVerifiedAccess(identity.discordId, existing);
    await replyV2(
      interaction,
      alreadyVerifiedContainer({
        user: existing,
        logoUrl: media.url,
        avatarUrl: identity.discordAvatarUrl,
      }),
      { files: media.files }
    );
    if (!access.ok && access.reason === "role") {
      logger.warn("Discord verified user is linked but role was not applied");
    }
    return;
  }

  const session = await createVerifySession({
    ...identity,
    guildId: interaction.guildId || env.discordGuildId,
    applicationId: interaction.applicationId || interaction.client.application?.id || "",
    interactionToken: interaction.token,
  });

  const telegramUrl = buildTelegramStartUrl(env.botUsername, session.token);
  const panelUrl = buildPanelVerifyUrl(env.panelPublicUrl, session.token);

  await replyV2(
    interaction,
    methodChoiceContainer({
      session,
      telegramUrl,
      panelUrl,
      logoUrl: media.url,
    }),
    { files: media.files }
  );
}

async function handleEmbedCommand(interaction) {
  const roleId = String(env.discordEmbedRoleId || "").trim();
  if (!roleId || !interaction.member?.roles?.cache?.has(roleId)) {
    await replyV2(
      interaction,
      errorContainer("Нет доступа", "Команда доступна только роли embed.")
    );
    return;
  }

  const type = interaction.options.getString("type", true);
  const target = interaction.options.getChannel("channel") || interaction.channel;

  if (!target || typeof target.send !== "function") {
    await replyV2(
      interaction,
      errorContainer("Нельзя сюда", "Выбери текстовый канал сервера.")
    );
    return;
  }

  const payload = await buildEmbedPayload(type);
  await target.send(payload);
  await replyV2(interaction, setupPostedContainer(target.id));
}

async function handleVerifySetup(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await replyV2(
      interaction,
      errorContainer("Недостаточно прав", "Нужно право Manage Server, чтобы публиковать панель.")
    );
    return;
  }

  const target =
    interaction.options.getChannel("channel") ||
    interaction.channel;

  if (!target || typeof target.send !== "function") {
    await replyV2(
      interaction,
      errorContainer("Нельзя сюда", "Выбери текстовый канал сервера.")
    );
    return;
  }

  const logo = resolveLogoMedia();
  const payload = {
    flags: MessageFlags.IsComponentsV2,
    components: verifyPanelComponents(),
  };
  if (logo.files.length) payload.files = logo.files;
  await target.send(payload);

  await replyV2(interaction, setupPostedContainer(target.id), { files: logo.files });
}

async function handleVoiceSetup(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await replyV2(
      interaction,
      errorContainer("Недостаточно прав", "Нужно право Manage Server, чтобы публиковать панель.")
    );
    return;
  }

  const createChannel = interaction.options.getChannel("create", true);
  const category = interaction.options.getChannel("category", true);
  const target = interaction.options.getChannel("channel") || interaction.channel;

  if (!target || typeof target.send !== "function") {
    await replyV2(
      interaction,
      errorContainer("Нельзя сюда", "Выбери текстовый канал для панели.")
    );
    return;
  }

  await saveVoiceConfig(interaction.guildId, {
    createChannelId: createChannel.id,
    categoryId: category.id,
    panelChannelId: target.id,
  });

  await target.send(voicePanelPayload());
  await replyV2(
    interaction,
    errorContainer(
      "Готово",
      [
        `Панель опубликована в <#${target.id}>.`,
        `Создать: <#${createChannel.id}>`,
        `Категория: **${category.name}**`,
      ].join("\n")
    )
  );
}

async function handleVerifyStatus(interaction) {
  const logo = resolveLogoMedia();
  const avatarUrl = discordAvatarUrl(interaction.user.id, interaction.user.avatar);
  const media = mediaFor(avatarUrl, logo);
  const user = await findUserByDiscordId(interaction.user.id);
  await replyV2(
    interaction,
    statusContainer({
      linked: Boolean(user) && canVerifyUser(user),
      user,
      memberTag: `<@${interaction.user.id}>`,
      logoUrl: media.url,
      avatarUrl,
    }),
    { files: media.files }
  );
}

async function handleSupportSetup(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await replyV2(
      interaction,
      errorContainer("Недостаточно прав", "Нужно право Manage Server, чтобы публиковать панель.")
    );
    return;
  }

  const target =
    interaction.options.getChannel("channel") ||
    (await interaction.client.channels.fetch(supportChannelId()).catch(() => null)) ||
    interaction.channel;

  if (!target || typeof target.send !== "function") {
    await replyV2(
      interaction,
      errorContainer("Нельзя сюда", "Выбери текстовый канал поддержки.")
    );
    return;
  }

  await publishSupportPanel(target);
  await replyV2(interaction, setupPostedContainer(target.id));
}

async function handleModSetup(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await replyV2(
      interaction,
      errorContainer("Недостаточно прав", "Нужно право Manage Server.")
    );
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  try {
    const result = await ensureModerationSetup(interaction.guild, { publishPanel: true });
    await interaction.editReply({
      content: [
        "Модерация настроена.",
        `Роль бана: <@&${result.banRoleId}>`,
        `Апелляция: <#${result.appealChannelId}>`,
        "Moderator и Fame получили Moderate Members (чтобы видеть /ban /mute /warn /info).",
        "Добавь ID в `.env` на VPS, если setup писал только локальный файл:",
        `\`DISCORD_BAN_ROLE_ID=${result.banRoleId}\``,
        `\`DISCORD_APPEAL_CHANNEL_ID=${result.appealChannelId}\``,
      ].join("\n"),
    });
  } catch (error) {
    logger.warn("mod-setup failed", error.message);
    await interaction.editReply({ content: `Ошибка setup: ${error.message}` });
  }
}

async function handleSuggestionsSetup(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await replyV2(
      interaction,
      errorContainer("Недостаточно прав", "Нужно право Manage Server.")
    );
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  try {
    const result = await ensureSuggestionsForum(interaction.guild, { publishGuide: true });
    await interaction.editReply({
      content: [
        "Форум предложений настроен.",
        `Канал: <#${result.channelId}>`,
        `Теги: ${result.tags.join(", ")}`,
        result.guideThreadId ? `Гайд: https://discord.com/channels/${interaction.guildId}/${result.channelId}/${result.guideThreadId}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });
  } catch (error) {
    logger.warn("suggestions-setup failed", error.message);
    await interaction.editReply({ content: `Ошибка setup: ${error.message}` });
  }
}

async function onInteractionCreate(interaction) {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "verify") {
        await startVerifyFlow(interaction);
        return;
      }
      if (interaction.commandName === "verify-status") {
        await handleVerifyStatus(interaction);
        return;
      }
      if (interaction.commandName === "embed") {
        await handleEmbedCommand(interaction);
        return;
      }
      if (await handleHelpCommand(interaction)) return;
      if (await handlePingCommand(interaction)) return;
      if (await handleMusicCommand(interaction)) return;
      if (await handleModCommand(interaction)) return;
    }

    if (interaction.isModalSubmit()) {
      if (await handleSupportModal(interaction)) return;
      if (await handleAppealModal(interaction)) return;
      if (await handleVoiceModal(interaction)) return;
    }

    if (interaction.isUserSelectMenu()) {
      if (await handleVoiceUserSelect(interaction)) return;
    }

    if (interaction.isButton()) {
      if (interaction.customId === CUSTOM_IDS.verify) {
        await startVerifyFlow(interaction);
        return;
      }
      if (await handleAboutButton(interaction)) return;
      if (await handleSupportClose(interaction)) return;
      if (await handleAppealButton(interaction)) return;
      if (await handleAppealStaffButton(interaction)) return;
      if (await handleVoiceButton(interaction)) return;
    }

    if (interaction.isStringSelectMenu()) {
      if (await handleHelpSelect(interaction)) return;
      if (await handleSupportSelect(interaction)) return;
      if (interaction.customId === MEMO_IDS.memoSelect) {
        const value = interaction.values?.[0] || "";
        const payload = await buildMemoSelectReply(value);
        await interaction.reply(payload);
        return;
      }
      if (interaction.customId === MEMO_IDS.notifySelect) {
        const value = interaction.values?.[0] || "";
        await interaction.reply(notifyAckPayload(value));
        return;
      }
    }
  } catch (error) {
    logger.error("Discord interaction failed", error);
    try {
      await replyV2(
        interaction,
        errorContainer(
          "Ошибка",
          "Не получилось начать верификацию. Попробуй ещё раз через минуту."
        )
      );
    } catch (replyError) {
      logger.warn("Discord error reply failed", replyError.message);
    }
  }
}

async function onGuildMemberAdd(member) {
  const guildId = String(env.discordGuildId || "").trim();
  if (guildId && member.guild.id !== guildId) return;

  try {
    const user = await findUserByDiscordId(member.id);
    const linked = Boolean(user) && canVerifyUser(user);

    if (linked) {
      await applyVerifiedAccess(member.id, user);
      return;
    }

    await applyUnverifiedAccess(member.id);
  } catch (error) {
    logger.warn("Discord member join handler failed", error.message);
  }
}

function registerDiscordHandlers(client) {
  client.on(Events.InteractionCreate, onInteractionCreate);
  client.on(Events.GuildMemberAdd, onGuildMemberAdd);
  client.on(Events.VoiceStateUpdate, onVoiceStateUpdate);
}

module.exports = {
  registerDiscordHandlers,
  startVerifyFlow,
};
