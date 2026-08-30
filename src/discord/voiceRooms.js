const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} = require("discord.js");
const { env } = require("../config/env");
const { logger } = require("../utils/logger");
const { ACCENT } = require("./components");
const { voiceEmojiButton, voiceEmojiMarkdown } = require("./emojis");
const DiscordVoiceConfig = require("../models/DiscordVoiceConfig");

/** @type {Map<string, { ownerId: string, locked: boolean, hidden: boolean }>} */
const rooms = new Map();

/** @type {Map<string, { createChannelId: string, categoryId: string }>} */
const configCache = new Map();

const CUSTOM_IDS = {
  panel: "gb:voice",
  hide: "gb:voice:hide",
  name: "gb:voice:name",
  transfer: "gb:voice:transfer",
  kick: "gb:voice:kick",
  allow: "gb:voice:allow",
  deny: "gb:voice:deny",
  speakOn: "gb:voice:speak_on",
  speakOff: "gb:voice:speak_off",
  limit: "gb:voice:limit",
  lock: "gb:voice:lock",
  pick: "gb:voice:pick",
  modalName: "gb:voice:modal:name",
  modalLimit: "gb:voice:modal:limit",
};

function textContainer(content) {
  return new ContainerBuilder()
    .setAccentColor(ACCENT.discord)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}

function voiceBtn(customId, action) {
  const btn = new ButtonBuilder().setCustomId(customId).setStyle(ButtonStyle.Secondary);
  const emoji = voiceEmojiButton(action);
  if (emoji) btn.setEmoji(emoji);
  return btn;
}

function voicePanelPayload() {
  const e = voiceEmojiMarkdown;
  const left = [
    `${e("hide")} — Отобразить/Скрыть комнату`,
    `${e("name")} — Изменить название комнаты`,
    `${e("transfer")} — Передать владение комнатой`,
    `${e("kick")} — Выгнать из комнаты`,
    `${e("allow")} — Выдать доступ в комнату`,
  ].join("\n");
  const right = [
    `${e("deny")} — Забрать доступ в комнату`,
    `${e("speakOn")} — Выдать право говорить`,
    `${e("speakOff")} — Забрать право говорить`,
    `${e("limit")} — Изменить лимит пользователей`,
    `${e("lock")} — Открыть/Закрыть комнату`,
  ].join("\n");

  const embed = new EmbedBuilder()
    .setColor(ACCENT.discord)
    .setTitle("Управление приватной комнатой")
    .setDescription(
      [
        "Жми следующие кнопки, чтобы настроить свою комнату",
        "Использовать их можно только когда у тебя есть приватный канал",
      ].join("\n")
    )
    .addFields(
      { name: "\u200b", value: left, inline: true },
      { name: "\u200b", value: right, inline: true }
    );

  const row1 = new ActionRowBuilder().addComponents(
    voiceBtn(CUSTOM_IDS.hide, "hide"),
    voiceBtn(CUSTOM_IDS.name, "name"),
    voiceBtn(CUSTOM_IDS.transfer, "transfer"),
    voiceBtn(CUSTOM_IDS.kick, "kick"),
    voiceBtn(CUSTOM_IDS.allow, "allow")
  );
  const row2 = new ActionRowBuilder().addComponents(
    voiceBtn(CUSTOM_IDS.deny, "deny"),
    voiceBtn(CUSTOM_IDS.speakOn, "speakOn"),
    voiceBtn(CUSTOM_IDS.speakOff, "speakOff"),
    voiceBtn(CUSTOM_IDS.limit, "limit"),
    voiceBtn(CUSTOM_IDS.lock, "lock")
  );

  return {
    embeds: [embed],
    components: [row1, row2],
  };
}

function findOwnedRoom(userId) {
  for (const [channelId, meta] of rooms.entries()) {
    if (meta.ownerId === userId) return { channelId, meta };
  }
  return null;
}

function roomNameFor(member) {
  const base = String(member?.displayName || member?.user?.username || "room")
    .replace(/[^\p{L}\p{N}\s._-]/gu, "")
    .trim()
    .slice(0, 80);
  return base || "room";
}

function privateRoomPermissionOverwrites(guild, member) {
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
    },
    {
      id: member.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.Stream,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.MoveMembers,
        PermissionFlagsBits.MuteMembers,
      ],
    },
  ];

  const unverifiedRoleId = String(env.discordUnverifiedRoleId || "").trim();
  if (unverifiedRoleId) {
    overwrites.push({
      id: unverifiedRoleId,
      deny: [PermissionFlagsBits.ViewChannel],
    });
  }

  return overwrites;
}

async function getVoiceConfig(guildId) {
  const id = String(guildId || env.discordGuildId || "").trim();
  if (!id) {
    return {
      createChannelId: String(env.discordVoiceCreateChannelId || "").trim(),
      categoryId: String(env.discordVoiceCategoryId || "").trim(),
    };
  }
  if (configCache.has(id)) return configCache.get(id);

  const doc = await DiscordVoiceConfig.findOne({ guildId: id }).lean();
  const cfg = {
    createChannelId:
      String(doc?.createChannelId || env.discordVoiceCreateChannelId || "").trim(),
    categoryId: String(doc?.categoryId || env.discordVoiceCategoryId || "").trim(),
  };
  configCache.set(id, cfg);
  return cfg;
}

async function saveVoiceConfig(guildId, { createChannelId, categoryId, panelChannelId }) {
  const id = String(guildId || "").trim();
  if (!id) throw new Error("guildId required");
  const update = {
    createChannelId: String(createChannelId || "").trim(),
    categoryId: String(categoryId || "").trim(),
  };
  if (panelChannelId != null) {
    update.panelChannelId = String(panelChannelId || "").trim();
  }
  await DiscordVoiceConfig.findOneAndUpdate(
    { guildId: id },
    { $set: update },
    { upsert: true, new: true }
  );
  configCache.set(id, {
    createChannelId: update.createChannelId,
    categoryId: update.categoryId,
  });
  return update;
}

async function createPrivateRoom(member, triggerChannel, categoryId) {
  const guild = member.guild;
  const parentId =
    String(categoryId || "").trim() ||
    triggerChannel?.parentId ||
    null;
  const name = roomNameFor(member);

  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildVoice,
    parent: parentId || undefined,
    userLimit: 0,
    reason: "Garbona private voice room",
    permissionOverwrites: privateRoomPermissionOverwrites(guild, member),
  });

  rooms.set(channel.id, { ownerId: member.id, locked: false, hidden: false });
  await member.voice.setChannel(channel);
  return channel;
}

async function deleteRoomIfEmpty(channel) {
  if (!channel || channel.type !== ChannelType.GuildVoice) return;
  if (!rooms.has(channel.id)) return;
  if (channel.members.size > 0) return;
  rooms.delete(channel.id);
  try {
    await channel.delete("Garbona private room empty");
  } catch (error) {
    logger.warn("Voice room delete failed", error.message);
  }
}

async function onVoiceStateUpdate(oldState, newState) {
  const guildId = String(env.discordGuildId || newState.guild?.id || oldState.guild?.id || "").trim();
  if (env.discordGuildId && guildId && guildId !== String(env.discordGuildId).trim()) return;

  const cfg = await getVoiceConfig(guildId);
  const createId = cfg.createChannelId;
  if (!createId) return;

  try {
    // Join trigger → create room
    if (newState.channelId === createId && newState.member && !newState.member.user.bot) {
      const existing = findOwnedRoom(newState.member.id);
      if (existing) {
        const ch = await newState.guild.channels.fetch(existing.channelId).catch(() => null);
        if (ch) {
          await newState.member.voice.setChannel(ch);
          return;
        }
        rooms.delete(existing.channelId);
      }
      await createPrivateRoom(newState.member, newState.channel, cfg.categoryId);
    }

    // Leave → cleanup empty temp rooms
    if (oldState.channelId && oldState.channelId !== createId && rooms.has(oldState.channelId)) {
      const left =
        oldState.channel ||
        (await oldState.guild.channels.fetch(oldState.channelId).catch(() => null));
      await deleteRoomIfEmpty(left);
    }
  } catch (error) {
    logger.warn("Voice room state update failed", error.message);
  }
}

async function getOwnedChannel(interaction) {
  const owned = findOwnedRoom(interaction.user.id);
  if (!owned) {
    return {
      error: "У тебя нет активной приватной комнаты. Зайди в голосовой канал «Создать».",
    };
  }
  const channel = await interaction.guild.channels.fetch(owned.channelId).catch(() => null);
  if (!channel) {
    rooms.delete(owned.channelId);
    return { error: "Комната уже удалена. Создай новую через «Создать»." };
  }
  return { channel, meta: owned.meta };
}

function ephemeralOk(title, body) {
  return {
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    components: [textContainer(`# ${title}\n${body}`)],
  };
}

function userPickMenu(action) {
  return new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(`${CUSTOM_IDS.pick}:${action}`)
      .setPlaceholder("Выбери пользователя")
      .setMinValues(1)
      .setMaxValues(1)
  );
}

async function handleVoiceButton(interaction) {
  const id = interaction.customId;
  if (!id.startsWith("gb:voice:")) return false;

  const owned = await getOwnedChannel(interaction);
  if (owned.error) {
    await interaction.reply(ephemeralOk("Нет комнаты", owned.error));
    return true;
  }
  const { channel, meta } = owned;

  if (id === CUSTOM_IDS.hide) {
    meta.hidden = !meta.hidden;
    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
      ViewChannel: meta.hidden ? false : true,
    });
    await interaction.reply(
      ephemeralOk(
        meta.hidden ? "Скрыть комнату" : "Показать комнату",
        meta.hidden
          ? `<@${interaction.user.id}>, комната **скрыта** для всех.`
          : `<@${interaction.user.id}>, комната снова **видна**.`
      )
    );
    return true;
  }

  if (id === CUSTOM_IDS.lock) {
    meta.locked = !meta.locked;
    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
      Connect: meta.locked ? false : true,
    });
    await interaction.reply(
      ephemeralOk(
        meta.locked ? "Закрыть комнату" : "Открыть комнату",
        meta.locked
          ? `<@${interaction.user.id}>, комната **закрыта**.`
          : `<@${interaction.user.id}>, комната **открыта**.`
      )
    );
    return true;
  }

  if (id === CUSTOM_IDS.name) {
    const modal = new ModalBuilder()
      .setCustomId(CUSTOM_IDS.modalName)
      .setTitle("Название комнаты")
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("name")
            .setLabel("Новое название")
            .setStyle(TextInputStyle.Short)
            .setMinLength(1)
            .setMaxLength(100)
            .setRequired(true)
            .setValue(channel.name.slice(0, 100))
        )
      );
    await interaction.showModal(modal);
    return true;
  }

  if (id === CUSTOM_IDS.limit) {
    const modal = new ModalBuilder()
      .setCustomId(CUSTOM_IDS.modalLimit)
      .setTitle("Лимит пользователей")
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("limit")
            .setLabel("Лимит (0 = без лимита, макс 99)")
            .setStyle(TextInputStyle.Short)
            .setMinLength(1)
            .setMaxLength(2)
            .setRequired(true)
            .setValue(String(channel.userLimit || 0))
        )
      );
    await interaction.showModal(modal);
    return true;
  }

  const pickMap = {
    [CUSTOM_IDS.transfer]: "transfer",
    [CUSTOM_IDS.kick]: "kick",
    [CUSTOM_IDS.allow]: "allow",
    [CUSTOM_IDS.deny]: "deny",
    [CUSTOM_IDS.speakOn]: "speak_on",
    [CUSTOM_IDS.speakOff]: "speak_off",
  };
  const action = pickMap[id];
  if (action) {
    await interaction.reply({
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      components: [
        textContainer("# Выбери пользователя"),
        userPickMenu(action),
      ],
    });
    return true;
  }

  return false;
}

async function handleVoiceModal(interaction) {
  if (interaction.customId === CUSTOM_IDS.modalName) {
    const owned = await getOwnedChannel(interaction);
    if (owned.error) {
      await interaction.reply(ephemeralOk("Нет комнаты", owned.error));
      return true;
    }
    const name = interaction.fields.getTextInputValue("name").trim().slice(0, 100);
    if (!name) {
      await interaction.reply(ephemeralOk("Ошибка", "Название не может быть пустым."));
      return true;
    }
    await owned.channel.setName(name, "Garbona voice rename");
    await interaction.reply(
      ephemeralOk("Название", `<@${interaction.user.id}>, комната переименована в **${name}**.`)
    );
    return true;
  }

  if (interaction.customId === CUSTOM_IDS.modalLimit) {
    const owned = await getOwnedChannel(interaction);
    if (owned.error) {
      await interaction.reply(ephemeralOk("Нет комнаты", owned.error));
      return true;
    }
    const raw = Number(interaction.fields.getTextInputValue("limit"));
    const limit = Number.isFinite(raw) ? Math.max(0, Math.min(99, Math.floor(raw))) : 0;
    await owned.channel.setUserLimit(limit, "Garbona voice limit");
    await interaction.reply(
      ephemeralOk(
        "Лимит",
        limit
          ? `<@${interaction.user.id}>, лимит комнаты: **${limit}**.`
          : `<@${interaction.user.id}>, лимит снят.`
      )
    );
    return true;
  }

  return false;
}

async function handleVoiceUserSelect(interaction) {
  if (!interaction.customId.startsWith(`${CUSTOM_IDS.pick}:`)) return false;
  const action = interaction.customId.slice(`${CUSTOM_IDS.pick}:`.length);
  const owned = await getOwnedChannel(interaction);
  if (owned.error) {
    await interaction.update(ephemeralOk("Нет комнаты", owned.error));
    return true;
  }

  const targetId = interaction.values?.[0];
  if (!targetId) {
    await interaction.update(ephemeralOk("Ошибка", "Пользователь не выбран."));
    return true;
  }

  const { channel, meta } = owned;
  const mention = `<@${targetId}>`;

  if (action === "transfer") {
    if (targetId === interaction.user.id) {
      await interaction.update(ephemeralOk("Владение", "Ты уже владелец."));
      return true;
    }
    meta.ownerId = targetId;
    await channel.permissionOverwrites.edit(targetId, {
      ViewChannel: true,
      Connect: true,
      Speak: true,
      ManageChannels: true,
      MoveMembers: true,
      MuteMembers: true,
    });
    await channel.permissionOverwrites.edit(interaction.user.id, {
      ManageChannels: null,
      MoveMembers: null,
      MuteMembers: null,
    });
    await interaction.update(
      ephemeralOk("Владение", `Владение комнатой передано ${mention}.`)
    );
    return true;
  }

  if (action === "kick") {
    const member = await interaction.guild.members.fetch(targetId).catch(() => null);
    if (member?.voice?.channelId === channel.id) {
      await member.voice.disconnect("Garbona voice kick");
    }
    await interaction.update(ephemeralOk("Кик", `${mention} выгнан(а) из комнаты.`));
    return true;
  }

  if (action === "allow") {
    await channel.permissionOverwrites.edit(targetId, {
      ViewChannel: true,
      Connect: true,
    });
    await interaction.update(ephemeralOk("Доступ", `${mention} получил(а) доступ в комнату.`));
    return true;
  }

  if (action === "deny") {
    await channel.permissionOverwrites.edit(targetId, {
      Connect: false,
    });
    const member = await interaction.guild.members.fetch(targetId).catch(() => null);
    if (member?.voice?.channelId === channel.id) {
      await member.voice.disconnect("Garbona voice deny");
    }
    await interaction.update(ephemeralOk("Доступ", `У ${mention} забран доступ.`));
    return true;
  }

  if (action === "speak_on") {
    await channel.permissionOverwrites.edit(targetId, { Speak: true });
    await interaction.update(ephemeralOk("Голос", `${mention} может говорить.`));
    return true;
  }

  if (action === "speak_off") {
    await channel.permissionOverwrites.edit(targetId, { Speak: false });
    await interaction.update(ephemeralOk("Голос", `У ${mention} забрано право говорить.`));
    return true;
  }

  return false;
}

module.exports = {
  CUSTOM_IDS,
  rooms,
  voicePanelPayload,
  getVoiceConfig,
  saveVoiceConfig,
  onVoiceStateUpdate,
  handleVoiceButton,
  handleVoiceModal,
  handleVoiceUserSelect,
};
