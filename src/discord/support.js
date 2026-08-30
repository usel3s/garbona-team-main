const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { env } = require("../config/env");
const { logger } = require("../utils/logger");
const { ACCENT } = require("./components");
const { emojiMarkdown, emojiForButton } = require("./emojis");
const DiscordSupportTicket = require("../models/DiscordSupportTicket");
const AppSettings = require("../models/AppSettings");
const { memberHasModAccess } = require("./moderation");

const SUPPORT_CHANNEL_ID = "1541569011396120679";
const PANEL_MSG_KEY = "discord_support_panel_message_id";
const COUNTER_KEY = "discord_support_ticket_counter";

const CUSTOM_IDS = {
  select: "gb:support:select",
  modal: "gb:support:modal",
  close: "gb:support:close",
};

const TYPES = {
  help: {
    value: "help",
    label: "Помощь",
    description: "Помощь и поддержка по Garbona",
    emoji: "invite",
    title: "Помощь",
  },
  bug: {
    value: "bug",
    label: "Обнаружение бага",
    description: "Сообщение о баге или уязвимости",
    emoji: "name",
    title: "Баг",
  },
  collab: {
    value: "collab",
    label: "Сотрудничество",
    description: "Предложение о партнёрстве",
    emoji: "dover",
    title: "Сотрудничество",
  },
};

function supportChannelId() {
  return String(env.discordSupportChannelId || SUPPORT_CHANNEL_ID).trim();
}

async function getStats(guildId) {
  const gid = String(guildId || env.discordGuildId || "").trim();
  const match = gid ? { guildId: gid } : {};
  const [total, open] = await Promise.all([
    DiscordSupportTicket.countDocuments(match),
    DiscordSupportTicket.countDocuments({ ...match, status: "open" }),
  ]);
  return {
    total,
    open,
    closed: Math.max(0, total - open),
  };
}

async function nextTicketId(guildId) {
  const key = `${COUNTER_KEY}:${guildId || "global"}`;
  const row = await AppSettings.findOneAndUpdate(
    { key },
    { $inc: { valueNumber: 1 } },
    { upsert: true, new: true }
  );
  return Math.max(1, Number(row.valueNumber || 1));
}

function optionEmoji(key) {
  const overrideId = String(env.discordSupportEmojiId || "").trim();
  if (overrideId) return { id: overrideId };
  return emojiForButton(TYPES[key]?.emoji || "invite");
}

function buildSupportSelect() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(CUSTOM_IDS.select)
    .setPlaceholder("Помощь")
    .setMinValues(1)
    .setMaxValues(1);

  for (const key of ["help", "bug", "collab"]) {
    const type = TYPES[key];
    const opt = new StringSelectMenuOptionBuilder()
      .setLabel(type.label)
      .setDescription(type.description)
      .setValue(type.value);
    const emoji = optionEmoji(key);
    if (emoji?.id || emoji?.name) opt.setEmoji(emoji);
    menu.addOptions(opt);
  }
  return menu;
}

async function buildSupportPanelPayload(guildId) {
  const stats = await getStats(guildId);
  const blue = emojiMarkdown("status_blue") || "🔵";
  const red = emojiMarkdown("status_red") || "🔴";
  const green = emojiMarkdown("status_green") || "🟢";

  const description = [
    "Если вам **требуется** помощь, вы хотите огласить **баг** или обсудить **деловое** предложение выберите соответствующий **пункт** в меню.",
    "",
    "> Статистика",
    `> - ${blue} **Всего обращений:** ${stats.total}`,
    `> - ${red} **Требуют рассмотрения:** ${stats.open}`,
    `> - ${green} **Обработано:** ${stats.closed}`,
  ].join("\n");

  const embed = new EmbedBuilder()
    .setColor(ACCENT.discord)
    .setDescription(description);

  const row = new ActionRowBuilder().addComponents(buildSupportSelect());
  return { embeds: [embed], components: [row] };
}

function supportModal(type) {
  const meta = TYPES[type] || TYPES.help;
  return new ModalBuilder()
    .setCustomId(`${CUSTOM_IDS.modal}:${meta.value}`)
    .setTitle("Создание запроса")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("subject")
          .setLabel("Тема")
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder("Кратко опиши запрос…")
          .setRequired(true)
          .setMinLength(8)
          .setMaxLength(800)
      )
    );
}

async function handleSupportSelect(interaction) {
  if (interaction.customId !== CUSTOM_IDS.select) return false;
  const value = String(interaction.values?.[0] || "").trim();
  if (!TYPES[value]) {
    await interaction.reply({ content: "Неизвестный тип запроса.", ephemeral: true });
    return true;
  }
  await interaction.showModal(supportModal(value));
  return true;
}

async function refreshSupportPanel(client, guildId) {
  const channelId = supportChannelId();
  const row = await AppSettings.findOne({ key: PANEL_MSG_KEY }).lean();
  const messageId = String(row?.valueString || "").trim();
  if (!channelId || !messageId || !client) return;
  try {
    const channel = await client.channels.fetch(channelId);
    const message = await channel.messages.fetch(messageId);
    const payload = await buildSupportPanelPayload(guildId);
    await message.edit({
      content: null,
      embeds: payload.embeds,
      components: payload.components,
      attachments: [],
    });
  } catch (error) {
    logger.warn("Support panel refresh failed", error.message);
  }
}

async function handleSupportModal(interaction) {
  if (!String(interaction.customId || "").startsWith(`${CUSTOM_IDS.modal}:`)) return false;
  const type = interaction.customId.slice(`${CUSTOM_IDS.modal}:`.length);
  const meta = TYPES[type] || TYPES.help;
  const subject = String(interaction.fields.getTextInputValue("subject") || "").trim();
  if (subject.length < 8) {
    await interaction.reply({ content: "Тема слишком короткая.", ephemeral: true });
    return true;
  }

  await interaction.deferReply({ ephemeral: true });

  const guildId = String(interaction.guildId || env.discordGuildId || "").trim();
  const ticketId = await nextTicketId(guildId);
  const channelId = supportChannelId();
  const staffRoleId = String(env.discordEmbedRoleId || "").trim();

  let thread = null;
  let staffMessageId = "";
  try {
    const parent = await interaction.client.channels.fetch(channelId);
    if (!parent?.isTextBased?.()) throw new Error("support_channel_missing");

    const embed = new EmbedBuilder()
      .setColor(ACCENT.pending)
      .setTitle(`${meta.title} · #${ticketId}`)
      .setDescription(subject)
      .addFields(
        {
          name: "Автор",
          value: `<@${interaction.user.id}> (\`${interaction.user.tag}\`)`,
          inline: true,
        },
        { name: "Тип", value: meta.label, inline: true },
        { name: "Статус", value: "Открыт", inline: true }
      )
      .setFooter({ text: "Garbona · Поддержка" })
      .setTimestamp(new Date());

    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_IDS.close}:${ticketId}`)
        .setStyle(ButtonStyle.Danger)
        .setLabel("Закрыть тикет")
    );

    if (parent.threads) {
      thread = await parent.threads.create({
        name: `${meta.value}-${ticketId}-${interaction.user.username}`.slice(0, 90),
        autoArchiveDuration: 10080,
        type: ChannelType.PrivateThread,
        reason: `Support ticket #${ticketId}`,
        invitable: false,
      });
      await thread.members.add(interaction.user.id).catch(() => null);
      const sent = await thread.send({
        content: staffRoleId ? `<@&${staffRoleId}>` : undefined,
        embeds: [embed],
        components: [closeRow],
        allowedMentions: staffRoleId ? { roles: [staffRoleId] } : undefined,
      });
      staffMessageId = String(sent.id);
    } else {
      const sent = await parent.send({ embeds: [embed], components: [closeRow] });
      staffMessageId = String(sent.id);
    }
  } catch (error) {
    logger.warn("Support ticket create failed", error.message);
    await interaction.editReply({
      content: "Не удалось создать запрос. Напиши в поддержку позже или обратись к куратору.",
    });
    return true;
  }

  await DiscordSupportTicket.create({
    guildId,
    ticketId,
    type: meta.value,
    status: "open",
    subject,
    userId: interaction.user.id,
    username: interaction.user.username || "",
    threadId: thread?.id || "",
    staffMessageId,
  });

  await refreshSupportPanel(interaction.client, guildId);

  await interaction.editReply({
    content: thread
      ? `Запрос **#${ticketId}** создан. Перейди в ${thread}: опиши детали там.`
      : `Запрос **#${ticketId}** отправлен. Ожидай ответа поддержки.`,
  });
  return true;
}

async function publishSupportPanel(channel) {
  const payload = await buildSupportPanelPayload(channel.guildId);
  const sent = await channel.send(payload);
  await AppSettings.findOneAndUpdate(
    { key: PANEL_MSG_KEY },
    { $set: { valueString: String(sent.id), valueNumber: null } },
    { upsert: true }
  );
  return sent;
}

function canCloseTicket(member) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  if (member.permissions?.has?.(PermissionFlagsBits.ManageThreads)) return true;
  if (member.permissions?.has?.(PermissionFlagsBits.ManageChannels)) return true;
  return memberHasModAccess(member);
}

async function handleSupportClose(interaction) {
  const id = String(interaction.customId || "");
  if (!id.startsWith(`${CUSTOM_IDS.close}:`)) return false;

  if (!canCloseTicket(interaction.member)) {
    await interaction.reply({
      content: "Закрыть тикет могут только администраторы и модерация.",
      ephemeral: true,
    });
    return true;
  }

  const ticketId = Number(id.slice(`${CUSTOM_IDS.close}:`.length));
  if (!Number.isFinite(ticketId) || ticketId < 1) {
    await interaction.reply({ content: "Некорректный тикет.", ephemeral: true });
    return true;
  }

  await interaction.deferReply({ ephemeral: true });

  const ticket = await DiscordSupportTicket.findOne({
    guildId: interaction.guildId,
    ticketId,
  });
  if (!ticket) {
    await interaction.editReply({ content: "Тикет не найден." });
    return true;
  }
  if (ticket.status === "closed") {
    await interaction.editReply({ content: `Тикет **#${ticketId}** уже закрыт.` });
    return true;
  }

  ticket.status = "closed";
  ticket.closedAt = new Date();
  ticket.closedBy = interaction.user.id;
  await ticket.save();

  const closedEmbed = new EmbedBuilder()
    .setColor(ACCENT.danger || 0xed4245)
    .setTitle(interaction.message.embeds?.[0]?.title || `Тикет #${ticketId}`)
    .setDescription(interaction.message.embeds?.[0]?.description || ticket.subject || "")
    .addFields(
      {
        name: "Автор",
        value: `<@${ticket.userId}> (\`${ticket.username || ticket.userId}\`)`,
        inline: true,
      },
      {
        name: "Тип",
        value: interaction.message.embeds?.[0]?.fields?.[1]?.value || ticket.type,
        inline: true,
      },
      { name: "Статус", value: "Закрыт", inline: true }
    )
    .setFooter({ text: `Garbona · Поддержка · закрыл ${interaction.user.tag}` })
    .setTimestamp(new Date());

  try {
    await interaction.message.edit({ embeds: [closedEmbed], components: [] });
  } catch (error) {
    logger.warn("Support close embed update failed", error.message);
  }

  const thread =
    interaction.channel?.isThread?.()
      ? interaction.channel
      : ticket.threadId
        ? await interaction.client.channels.fetch(ticket.threadId).catch(() => null)
        : null;

  if (thread?.isThread?.()) {
    try {
      await thread.send({
        embeds: [
          new EmbedBuilder()
            .setColor(ACCENT.danger || 0xed4245)
            .setTitle(`Тикет #${ticketId} закрыт`)
            .setDescription(`Закрыл <@${interaction.user.id}>`)
            .setTimestamp(new Date()),
        ],
      });
      await thread.setArchived(true, `Ticket #${ticketId} closed`).catch(() => null);
      await thread.setLocked(true, `Ticket #${ticketId} closed`).catch(() => null);
    } catch (error) {
      logger.warn("Support thread close failed", error.message);
    }
  }

  await refreshSupportPanel(interaction.client, interaction.guildId);
  await interaction.editReply({ content: `Тикет **#${ticketId}** закрыт.` });
  return true;
}

module.exports = {
  CUSTOM_IDS,
  SUPPORT_CHANNEL_ID,
  supportChannelId,
  buildSupportPanelPayload,
  publishSupportPanel,
  handleSupportSelect,
  handleSupportModal,
  handleSupportClose,
  refreshSupportPanel,
};
