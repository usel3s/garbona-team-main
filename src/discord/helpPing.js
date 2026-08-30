const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require("discord.js");
const mongoose = require("mongoose");
const { env } = require("../config/env");
const { ACCENT } = require("./components");
const { emojiMarkdown } = require("./emojis");

const HELP_SELECT = "gb:help:select";
const PING_STATUS_BTN = "gb:ping:status";

const HELP_CATEGORIES = {
  main: {
    label: "Основные",
    description: "help, ping",
    commands: [
      { name: "/help", desc: "Список команд" },
      { name: "/ping", desc: "Задержки бота и сервисов" },
    ],
  },
  mod: {
    label: "Модерация",
    description: "Только Moderator / Fame",
    commands: [
      { name: "/about", desc: "Карточка пользователя (Discord + панель)" },
      { name: "/warn", desc: "Выговор (3 = мут на неделю)" },
      { name: "/unwarn", desc: "Снять выговор" },
      { name: "/mute", desc: "Мут (timeout)" },
      { name: "/unmute", desc: "Снять мут" },
      { name: "/ban", desc: "Роль бана + апелляция" },
    ],
  },
  music: {
    label: "Музыка",
    description: "YouTube (HQ) / SoundCloud / плейлисты",
    commands: [
      { name: "/play", desc: "Играть трек или плейлист (поиск / ссылка)" },
      { name: "/skip", desc: "Пропустить трек" },
      { name: "/pause", desc: "Пауза" },
      { name: "/resume", desc: "Продолжить" },
      { name: "/stop", desc: "Стоп и очистка очереди" },
      { name: "/queue", desc: "Очередь" },
      { name: "/np", desc: "Сейчас играет" },
    ],
  },
};

function helpEmbed(categoryKey = "main") {
  const cat = HELP_CATEGORIES[categoryKey] || HELP_CATEGORIES.main;
  const total = Object.values(HELP_CATEGORIES).reduce((n, c) => n + c.commands.length, 0);
  const lines = cat.commands.map((c) => `\`${c.name}\` — ${c.desc}`);

  return new EmbedBuilder()
    .setColor(ACCENT.discord)
    .setTitle(`— • Помощь · ${cat.label}`)
    .setDescription(lines.join("\n"))
    .setFooter({ text: `Garbona · Всего команд: ${total}` })
    .setTimestamp(new Date());
}

function helpSelectRow(selected = "main") {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(HELP_SELECT)
      .setPlaceholder("Выберите раздел")
      .addOptions(
        Object.entries(HELP_CATEGORIES).map(([value, cat]) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(cat.label)
            .setDescription(cat.description)
            .setValue(value)
            .setDefault(value === selected)
        )
      )
  );
}

async function handleHelpCommand(interaction) {
  if (interaction.commandName !== "help") return false;
  await interaction.reply({
    embeds: [helpEmbed("main")],
    components: [helpSelectRow("main")],
    ephemeral: true,
  });
  return true;
}

async function handleHelpSelect(interaction) {
  if (interaction.customId !== HELP_SELECT) return false;
  const value = interaction.values?.[0] || "main";
  await interaction.update({
    embeds: [helpEmbed(value)],
    components: [helpSelectRow(value)],
  });
  return true;
}

async function measureDbPing() {
  const started = Date.now();
  if (mongoose.connection.readyState !== 1) {
    return { ok: false, ms: Date.now() - started };
  }
  await mongoose.connection.db.admin().command({ ping: 1 });
  return { ok: true, ms: Date.now() - started };
}

async function handlePingCommand(interaction) {
  if (interaction.commandName !== "ping") return false;
  const t0 = Date.now();
  await interaction.deferReply();
  const cmdMs = Date.now() - t0;
  const ws = Number(interaction.client.ws?.ping);
  const db = await measureDbPing().catch(() => ({ ok: false, ms: null }));

  const guildId = String(env.discordGuildId || interaction.guildId || "").trim();
  const statusChannelId = String(env.discordStatusChannelId || "").trim();
  const statusUrl =
    guildId && statusChannelId
      ? `https://discord.com/channels/${guildId}/${statusChannelId}`
      : "https://garbona.cc";

  const icon = emojiMarkdown("status_online") || "📡";
  const embed = new EmbedBuilder()
    .setColor(ACCENT.pending)
    .setTitle(`${icon} Ping`)
    .setDescription(
      [
        `**Задержка (WebSocket):** **${Number.isFinite(ws) ? `${Math.round(ws)}ms` : "—"}**`,
        `**Обработка команд:** **${cmdMs}ms**`,
        `**База данных:** **${db.ok ? `${db.ms}ms` : "offline"}**`,
        "",
        `Гильдия: \`${interaction.guild?.name || "—"}\``,
        `Shard: \`${interaction.guild?.shardId ?? 0}\``,
      ].join("\n")
    )
    .setFooter({ text: "Garbona · Ping" })
    .setTimestamp(new Date());

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel("Статус сервисов")
      .setURL(statusUrl)
  );

  await interaction.editReply({ embeds: [embed], components: [row] });
  return true;
}

module.exports = {
  HELP_SELECT,
  PING_STATUS_BTN,
  handleHelpCommand,
  handleHelpSelect,
  handlePingCommand,
  HELP_CATEGORIES,
};
