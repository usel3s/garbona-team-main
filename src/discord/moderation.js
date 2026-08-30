const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { env } = require("../config/env");
const { logger } = require("../utils/logger");
const { ACCENT } = require("./components");
const { emojiMarkdown } = require("./emojis");
const DiscordModCase = require("../models/DiscordModCase");
const AppSettings = require("../models/AppSettings");
const User = require("../models/User");
const { findUserByDiscordId } = require("../services/discordVerifyService");
const { getAvailableUsd } = require("../services/withdrawalService");

const CUSTOM_IDS = {
  appealBtn: "gb:mod:appeal",
  appealModal: "gb:mod:appeal:modal",
  unbanAppeal: "gb:mod:appeal:accept",
  denyAppeal: "gb:mod:appeal:deny",
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const WARN_MUTE_THRESHOLD = 3;

const ROLE_DEFAULTS = {
  mod: "1541572769119076392", // ・Moderator
  fame: "1541573044084936845", // ・Friend (fame)
  team: "1094277292169109514", // ・Team
};

function modRoleIds() {
  return [
    String(env.discordModRoleId || ROLE_DEFAULTS.mod).trim(),
    String(env.discordFameRoleId || ROLE_DEFAULTS.fame).trim(),
  ].filter(Boolean);
}

function banRoleId() {
  return String(env.discordBanRoleId || "").trim();
}

function muteRoleId() {
  return String(env.discordMuteRoleId || "").trim();
}

function appealChannelId() {
  return String(env.discordAppealChannelId || "").trim();
}

function memberHasModAccess(member) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  const roles = modRoleIds();
  return roles.some((id) => member.roles?.cache?.has?.(id));
}

async function nextCaseId(guildId) {
  const key = `discord_mod_case_counter:${guildId || "g"}`;
  const row = await AppSettings.findOneAndUpdate(
    { key },
    { $inc: { valueNumber: 1 } },
    { upsert: true, new: true }
  );
  return Math.max(1, Number(row.valueNumber || 1));
}

async function createCase(data) {
  const caseId = await nextCaseId(data.guildId);
  return DiscordModCase.create({ ...data, caseId });
}

async function sendModLog(client, embed) {
  const channelId = String(env.discordModLogChannelId || "").trim();
  if (!channelId || !client) return;
  try {
    const ch = await client.channels.fetch(channelId);
    if (ch?.isTextBased?.()) await ch.send({ embeds: [embed] });
  } catch (error) {
    logger.warn("Mod log send failed", error.message);
  }
}

function dmTitle(type, caseId) {
  const map = {
    warn: "Выговор",
    unwarn: "Выговор снят",
    mute: "Мут",
    unmute: "Мут снят",
    ban: "Бан",
    unban: "Бан снят",
  };
  const label = map[type] || typeLabel(type);
  return caseId ? `${label} · #${caseId}` : label;
}

function dmBody(type, { reason, expiresAt, warnCount, appealChannelId: appealId } = {}) {
  const lines = [];
  if (type === "warn") {
    lines.push("Тебе выдали **выговор** на сервере Garbona.");
    if (warnCount != null) {
      lines.push(`Активные выговоры: **${warnCount}/${WARN_MUTE_THRESHOLD}**.`);
      if (warnCount >= WARN_MUTE_THRESHOLD) {
        lines.push(`При ${WARN_MUTE_THRESHOLD} выговорах выдаётся мут на неделю.`);
      }
    }
  } else if (type === "mute") {
    lines.push("Тебе выдали **мут** на сервере Garbona.");
    if (expiresAt) {
      lines.push(`До: <t:${Math.floor(new Date(expiresAt).getTime() / 1000)}:f>`);
    }
  } else if (type === "unmute") {
    lines.push("С тебя сняли **мут** на сервере Garbona.");
  } else if (type === "ban") {
    lines.push("Тебе выдали роль **бана** на сервере Garbona.");
    lines.push("Доступ к серверу ограничен — остаётся канал апелляции.");
    if (appealId) lines.push(`Апелляция: <#${appealId}>`);
  } else if (type === "unban") {
    lines.push("С тебя сняли роль **бана** на сервере Garbona.");
    lines.push("Доступ к серверу восстановлен.");
  } else if (type === "unwarn") {
    lines.push("С тебя сняли **выговор** на сервере Garbona.");
  }
  if (reason) {
    lines.push("");
    lines.push(`**Причина:** ${String(reason).slice(0, 900)}`);
  }
  return lines.join("\n");
}

/**
 * Best-effort DM to the punished / restored user.
 */
async function dmUserModAction(client, userId, type, opts = {}) {
  if (!client || !userId) return false;
  try {
    const user = await client.users.fetch(userId);
    const embed = new EmbedBuilder()
      .setColor(typeColor(type))
      .setTitle(dmTitle(type, opts.caseId))
      .setDescription(dmBody(type, opts))
      .setFooter({ text: "Garbona · Модерация" })
      .setTimestamp(new Date());
    await user.send({ embeds: [embed] });
    return true;
  } catch (error) {
    logger.warn("Mod DM failed", userId, error.message);
    return false;
  }
}

function typeLabel(type) {
  return (
    {
      warn: "Выговор",
      unwarn: "Снятие выговора",
      mute: "Мут",
      unmute: "Размут",
      ban: "Бан",
      unban: "Разбан",
      appeal: "Апелляция",
    }[type] || type
  );
}

function typeColor(type) {
  if (type === "ban" || type === "warn") return 0xed4245;
  if (type === "mute") return 0xfaa61a;
  if (type === "unban" || type === "unmute" || type === "unwarn") return 0x57f287;
  return ACCENT.discord;
}

function caseEmbed(modCase, { title } = {}) {
  const fields = [
    { name: "Пользователь", value: `<@${modCase.userId}>`, inline: true },
    { name: "Модератор", value: modCase.moderatorId ? `<@${modCase.moderatorId}>` : "—", inline: true },
    { name: "Кейс", value: `#${modCase.caseId}`, inline: true },
  ];
  if (modCase.reason) fields.push({ name: "Причина", value: modCase.reason.slice(0, 1000) });
  if (modCase.expiresAt) {
    fields.push({
      name: "До",
      value: `<t:${Math.floor(new Date(modCase.expiresAt).getTime() / 1000)}:f>`,
      inline: true,
    });
  }
  return new EmbedBuilder()
    .setColor(typeColor(modCase.type))
    .setTitle(title || typeLabel(modCase.type))
    .addFields(fields)
    .setFooter({ text: "Garbona · Модерация" })
    .setTimestamp(new Date(modCase.createdAt || Date.now()));
}

async function activeWarnCount(guildId, userId) {
  return DiscordModCase.countDocuments({
    guildId,
    userId,
    type: "warn",
    active: true,
  });
}

async function listUserHistory(guildId, userId, limit = 15) {
  return DiscordModCase.find({ guildId, userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

function historyEmbed(targetUser, cases, warnCount) {
  const lines = cases.length
    ? cases.map((c) => {
        const ts = Math.floor(new Date(c.createdAt).getTime() / 1000);
        const active = c.active ? "" : " · ~~снято~~";
        return `\`#${c.caseId}\` **${typeLabel(c.type)}** · <t:${ts}:R>${active}\n└ ${c.reason || "—"}${c.moderatorId ? ` · <@${c.moderatorId}>` : ""}`;
      })
    : ["Нарушений нет."];

  return new EmbedBuilder()
    .setColor(ACCENT.discord)
    .setTitle(`История нарушений · ${targetUser.tag || targetUser.username || targetUser.id}`)
    .setThumbnail(targetUser.displayAvatarURL?.({ size: 256 }) || null)
    .setDescription(lines.join("\n\n").slice(0, 4000))
    .addFields({
      name: "Активные выговоры",
      value: `**${warnCount}** / ${WARN_MUTE_THRESHOLD}`,
      inline: true,
    })
    .setFooter({ text: "Garbona · Модерация" })
    .setTimestamp(new Date());
}

async function buildInfoEmbed(member, discordUser) {
  const linked = await findUserByDiscordId(discordUser.id);
  const warnCount = await activeWarnCount(member.guild.id, discordUser.id);
  const cases = await listUserHistory(member.guild.id, discordUser.id, 8);
  const joined = member.joinedTimestamp
    ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`
    : "—";
  const created = `<t:${Math.floor(discordUser.createdTimestamp / 1000)}:R>`;
  const roles = member.roles.cache
    .filter((r) => r.id !== member.guild.id)
    .sort((a, b) => b.position - a.position)
    .map((r) => `<@&${r.id}>`)
    .slice(0, 15);
  const timeoutUntil = member.communicationDisabledUntilTimestamp
    ? `<t:${Math.floor(member.communicationDisabledUntilTimestamp / 1000)}:f>`
    : "нет";

  const embed = new EmbedBuilder()
    .setColor(ACCENT.pending)
    .setTitle(`Информация · ${discordUser.tag || discordUser.username}`)
    .setThumbnail(discordUser.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: "Discord ID", value: `\`${discordUser.id}\``, inline: true },
      { name: "Аккаунт", value: created, inline: true },
      { name: "На сервере", value: joined, inline: true },
      { name: "Мут", value: timeoutUntil, inline: true },
      { name: "Выговоры", value: `**${warnCount}** / ${WARN_MUTE_THRESHOLD}`, inline: true },
      {
        name: "Роли",
        value: roles.length ? roles.join(" ") : "—",
      }
    )
    .setFooter({ text: "Garbona · Info" })
    .setTimestamp(new Date());

  if (linked) {
    const available = await getAvailableUsd(linked).catch(() => Number(linked.totalProfit || 0));
    embed.addFields(
      {
        name: "Garbona",
        value: [
          `TG: \`${linked.telegramId}\`${linked.username ? ` · @${linked.username}` : ""}`,
          `Панель: \`${linked.panelUsername || "—"}\``,
          `Кастом ID: \`${linked.customId || "—"}\``,
        ].join("\n"),
      },
      {
        name: "Статус команды",
        value: [
          `Участник: **${linked.isTeamMember ? "да" : "нет"}**`,
          `Бан в боте: **${linked.isBanned ? "да" : "нет"}**`,
          `Куратор: **${linked.isCurator ? "да" : "нет"}**`,
          `%: **${linked.profitPercent ?? 70}%**`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Финансы",
        value: [
          `Профит: **$${(Number(linked.totalProfit) || 0).toFixed(2)}**`,
          `Доступно: **$${(Number(available) || 0).toFixed(2)}**`,
          `Холд: **$${(Number(linked.frozenSaleUsd) || 0).toFixed(2)}**`,
        ].join("\n"),
        inline: true,
      }
    );
  } else {
    embed.addFields({
      name: "Garbona",
      value: "Discord не привязан к аккаунту Garbona.",
    });
  }

  if (cases.length) {
    embed.addFields({
      name: "Последние нарушения",
      value: cases
        .slice(0, 5)
        .map((c) => {
          const ts = Math.floor(new Date(c.createdAt).getTime() / 1000);
          return `\`#${c.caseId}\` ${typeLabel(c.type)} · <t:${ts}:R>`;
        })
        .join("\n")
        .slice(0, 1000),
    });
  }

  return embed;
}

async function applyWarn({ guild, target, moderator, reason }) {
  const guildId = guild.id;
  const warns = await activeWarnCount(guildId, target.id);
  const modCase = await createCase({
    guildId,
    userId: target.id,
    type: "warn",
    reason: reason || "Без причины",
    moderatorId: moderator.id,
    moderatorTag: moderator.user?.tag || moderator.tag || "",
    active: true,
  });

  const linked = await findUserByDiscordId(target.id);
  if (linked) {
    linked.warns = linked.warns || [];
    linked.warns.push({
      reason: reason || "Без причины",
      adminId: moderator.id,
      adminName: moderator.user?.tag || "",
      createdAt: new Date(),
    });
    await linked.save().catch(() => null);
  }

  const nextWarns = warns + 1;
  let muteCase = null;
  if (nextWarns >= WARN_MUTE_THRESHOLD) {
    const member = await guild.members.fetch(target.id).catch(() => null);
    if (member) {
      muteCase = await applyMute({
        guild,
        targetMember: member,
        moderator,
        reason: `Авто-мут: ${WARN_MUTE_THRESHOLD} выговора`,
        durationMs: WEEK_MS,
      });
    }
    await DiscordModCase.updateMany(
      { guildId, userId: target.id, type: "warn", active: true },
      { $set: { active: false } }
    );
  }

  const embed = caseEmbed(modCase, {
    title: `${emojiMarkdown("nope") || "⚠"} Выговор #${modCase.caseId} · ${nextWarns}/${WARN_MUTE_THRESHOLD}`,
  });
  await sendModLog(guild.client, embed);
  const warnCountAfter = nextWarns >= WARN_MUTE_THRESHOLD ? 0 : nextWarns;
  await dmUserModAction(guild.client, target.id, "warn", {
    caseId: modCase.caseId,
    reason: modCase.reason,
    warnCount: nextWarns,
  });
  return { modCase, warnCount: warnCountAfter, muteCase };
}

async function applyUnwarn({ guild, target, moderator, reason }) {
  const last = await DiscordModCase.findOne({
    guildId: guild.id,
    userId: target.id,
    type: "warn",
    active: true,
  }).sort({ createdAt: -1 });
  if (!last) return { ok: false, error: "Нет активных выговоров." };
  last.active = false;
  await last.save();
  const modCase = await createCase({
    guildId: guild.id,
    userId: target.id,
    type: "unwarn",
    reason: reason || `Снят кейс #${last.caseId}`,
    moderatorId: moderator.id,
    moderatorTag: moderator.user?.tag || "",
    active: false,
    meta: { removedCaseId: last.caseId },
  });
  await sendModLog(guild.client, caseEmbed(modCase));
  return { ok: true, modCase, removed: last };
}

async function applyMute({ guild, targetMember, target, moderator, reason, durationMs }) {
  const member = targetMember || (await guild.members.fetch(target.id).catch(() => null));
  if (!member) throw new Error("Участник не найден на сервере.");
  const ms = Math.min(Math.max(Number(durationMs) || WEEK_MS, 60_000), 28 * 24 * 60 * 60 * 1000);
  await member.timeout(ms, reason || "Mute");
  const muteRole = muteRoleId();
  if (muteRole) await member.roles.add(muteRole, reason || "Mute").catch(() => null);

  const modCase = await createCase({
    guildId: guild.id,
    userId: member.id,
    type: "mute",
    reason: reason || "Без причины",
    moderatorId: moderator.id,
    moderatorTag: moderator.user?.tag || "",
    durationMs: ms,
    expiresAt: new Date(Date.now() + ms),
    active: true,
  });
  await sendModLog(guild.client, caseEmbed(modCase, { title: `${emojiMarkdown("close") || "🔇"} Мут #${modCase.caseId}` }));
  await dmUserModAction(guild.client, member.id, "mute", {
    caseId: modCase.caseId,
    reason: modCase.reason,
    expiresAt: modCase.expiresAt,
  });
  return modCase;
}

async function applyUnmute({ guild, targetMember, target, moderator, reason }) {
  const member = targetMember || (await guild.members.fetch(target.id).catch(() => null));
  if (!member) throw new Error("Участник не найден на сервере.");
  await member.timeout(null, reason || "Unmute");
  const muteRole = muteRoleId();
  if (muteRole) await member.roles.remove(muteRole, reason || "Unmute").catch(() => null);
  await DiscordModCase.updateMany(
    { guildId: guild.id, userId: member.id, type: "mute", active: true },
    { $set: { active: false } }
  );
  const modCase = await createCase({
    guildId: guild.id,
    userId: member.id,
    type: "unmute",
    reason: reason || "Размут",
    moderatorId: moderator.id,
    moderatorTag: moderator.user?.tag || "",
    active: false,
  });
  await sendModLog(guild.client, caseEmbed(modCase));
  await dmUserModAction(guild.client, member.id, "unmute", {
    caseId: modCase.caseId,
    reason: modCase.reason,
  });
  return modCase;
}

async function applyBanRole({ guild, targetMember, target, moderator, reason }) {
  const member = targetMember || (await guild.members.fetch(target.id).catch(() => null));
  if (!member) throw new Error("Участник не найден на сервере.");
  const roleId = banRoleId();
  if (!roleId) throw new Error("Не настроен DISCORD_BAN_ROLE_ID. Запусти setup-discord-moderation.js");

  await member.roles.add(roleId, reason || "Ban role");
  // Keep verified for hierarchy; ban overwrites hide channels.
  const modCase = await createCase({
    guildId: guild.id,
    userId: member.id,
    type: "ban",
    reason: reason || "Без причины",
    moderatorId: moderator.id,
    moderatorTag: moderator.user?.tag || "",
    active: true,
  });
  await sendModLog(guild.client, caseEmbed(modCase, { title: `${emojiMarkdown("ban") || "🚫"} Бан #${modCase.caseId}` }));

  const appealId = appealChannelId();
  await dmUserModAction(guild.client, member.id, "ban", {
    caseId: modCase.caseId,
    reason: modCase.reason,
    appealChannelId: appealId,
  });
  return { modCase, appealChannelId: appealId };
}

async function applyUnbanRole({ guild, targetMember, target, moderator, reason }) {
  const member = targetMember || (await guild.members.fetch(target.id).catch(() => null));
  if (!member) throw new Error("Участник не найден на сервере.");
  const roleId = banRoleId();
  if (roleId) await member.roles.remove(roleId, reason || "Unban").catch(() => null);
  await DiscordModCase.updateMany(
    { guildId: guild.id, userId: member.id, type: "ban", active: true },
    { $set: { active: false } }
  );
  const modCase = await createCase({
    guildId: guild.id,
    userId: member.id,
    type: "unban",
    reason: reason || "Разбан",
    moderatorId: moderator.id,
    moderatorTag: moderator.user?.tag || "",
    active: false,
  });
  await sendModLog(guild.client, caseEmbed(modCase));
  await dmUserModAction(guild.client, member.id, "unban", {
    caseId: modCase.caseId,
    reason: modCase.reason,
  });
  return modCase;
}

function appealPanelPayload() {
  const embed = new EmbedBuilder()
    .setColor(ACCENT.danger)
    .setTitle(`${emojiMarkdown("private") || "⚖"} Апелляция бана`)
    .setDescription(
      [
        "Ты получил роль бана и видишь только этот канал.",
        "",
        "Если считаешь наказание ошибочным — подай апелляцию.",
        "Опиши ситуацию коротко и по делу. Спам и токсичность = отказ.",
      ].join("\n")
    )
    .setFooter({ text: "Garbona · Апелляции" });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CUSTOM_IDS.appealBtn)
      .setStyle(ButtonStyle.Primary)
      .setLabel("Подать апелляцию")
  );
  return { embeds: [embed], components: [row] };
}

function appealModal() {
  return new ModalBuilder()
    .setCustomId(CUSTOM_IDS.appealModal)
    .setTitle("Апелляция")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("body")
          .setLabel("Почему снять бан?")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMinLength(20)
          .setMaxLength(1000)
          .setPlaceholder("Кратко опиши ситуацию и почему наказание несправедливо…")
      )
    );
}

async function handleAppealButton(interaction) {
  if (interaction.customId !== CUSTOM_IDS.appealBtn) return false;
  const roleId = banRoleId();
  if (roleId && !interaction.member?.roles?.cache?.has(roleId)) {
    await interaction.reply({ content: "Апелляция доступна только с ролью бана.", ephemeral: true });
    return true;
  }
  await interaction.showModal(appealModal());
  return true;
}

async function handleAppealModal(interaction) {
  if (interaction.customId !== CUSTOM_IDS.appealModal) return false;
  const body = String(interaction.fields.getTextInputValue("body") || "").trim();
  await interaction.deferReply({ ephemeral: true });

  const modCase = await createCase({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    type: "appeal",
    reason: body,
    moderatorId: "",
    moderatorTag: "",
    active: true,
  });

  const embed = new EmbedBuilder()
    .setColor(ACCENT.pending)
    .setTitle(`Апелляция #${modCase.caseId}`)
    .setDescription(body)
    .addFields(
      { name: "Автор", value: `<@${interaction.user.id}>`, inline: true },
      { name: "Статус", value: "На рассмотрении", inline: true }
    )
    .setFooter({ text: "Garbona · Апелляции" })
    .setTimestamp(new Date());

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CUSTOM_IDS.unbanAppeal}:${interaction.user.id}:${modCase.caseId}`)
      .setStyle(ButtonStyle.Success)
      .setLabel("Снять бан"),
    new ButtonBuilder()
      .setCustomId(`${CUSTOM_IDS.denyAppeal}:${interaction.user.id}:${modCase.caseId}`)
      .setStyle(ButtonStyle.Danger)
      .setLabel("Отклонить")
  );

  const channelId = String(env.discordModLogChannelId || "").trim();
  if (channelId) {
    try {
      const ch = await interaction.client.channels.fetch(channelId);
      if (ch?.isTextBased?.()) {
        await ch.send({ embeds: [embed], components: [row] });
      }
    } catch (error) {
      logger.warn("Appeal mod-log failed", error.message);
    }
  } else {
    await sendModLog(interaction.client, embed);
  }

  await interaction.editReply({ content: `Апелляция **#${modCase.caseId}** отправлена модераторам.` });
  return true;
}

async function handleAppealStaffButton(interaction) {
  const id = String(interaction.customId || "");
  const accept = id.startsWith(`${CUSTOM_IDS.unbanAppeal}:`);
  const deny = id.startsWith(`${CUSTOM_IDS.denyAppeal}:`);
  if (!accept && !deny) return false;
  if (!memberHasModAccess(interaction.member)) {
    await interaction.reply({ content: "Недостаточно прав.", ephemeral: true });
    return true;
  }
  const parts = id.split(":");
  const caseId = parts.pop();
  const userId = parts.pop();
  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  if (accept) {
    if (member) {
      await applyUnbanRole({
        guild: interaction.guild,
        targetMember: member,
        target: member.user,
        moderator: interaction.member,
        reason: `Апелляция #${caseId} одобрена`,
      });
    }
    await DiscordModCase.updateOne(
      { guildId: interaction.guildId, caseId: Number(caseId) },
      { $set: { active: false, meta: { decision: "accepted", by: interaction.user.id } } }
    );
    await interaction.reply({ content: `Бан снят у <@${userId}>.`, ephemeral: true });
  } else {
    await DiscordModCase.updateOne(
      { guildId: interaction.guildId, caseId: Number(caseId) },
      { $set: { active: false, meta: { decision: "denied", by: interaction.user.id } } }
    );
    await interaction.reply({ content: `Апелляция #${caseId} отклонена.`, ephemeral: true });
  }
  try {
    await interaction.message.edit({ components: [] });
  } catch (_) {
    /* ignore */
  }
  return true;
}

function parseDurationMs(raw) {
  const text = String(raw || "").trim().toLowerCase();
  if (!text) return WEEK_MS;
  const m = text.match(/^(\d+)\s*(mins?|m|hrs?|h|days?|d|weeks?|w)?$/i);
  if (!m) return WEEK_MS;
  const n = Number(m[1]);
  const unit = (m[2] || "d").toLowerCase();
  if (unit.startsWith("m")) return n * 60_000;
  if (unit.startsWith("h")) return n * 3_600_000;
  if (unit.startsWith("w")) return n * WEEK_MS;
  return n * 86_400_000;
}

async function denyIfNoMod(interaction) {
  if (memberHasModAccess(interaction.member)) return false;
  await interaction.reply({
    content: "Команда только для Moderator и Fame.",
    ephemeral: true,
  });
  return true;
}

async function handleModCommand(interaction) {
  const name = interaction.commandName;
  const modCommands = new Set(["ban", "mute", "unmute", "warn", "unwarn", "about"]);
  if (!modCommands.has(name)) return false;
  if (await denyIfNoMod(interaction)) return true;

  const targetUser = interaction.options.getUser("user", true);
  const reason = interaction.options.getString("reason") || "";

  if (name === "about") {
    await interaction.deferReply({ ephemeral: true });
    const { buildAboutPayload } = require("./about");
    const payload = await buildAboutPayload(interaction.guild, targetUser, "discord", 0);
    await interaction.editReply(payload);
    return true;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    if (name === "warn") {
      const result = await applyWarn({
        guild: interaction.guild,
        target: targetUser,
        moderator: interaction.member,
        reason,
      });
      const lines = [
        `Выговор **#${result.modCase.caseId}** → <@${targetUser.id}>`,
        `Активные: **${result.warnCount}/${WARN_MUTE_THRESHOLD}**`,
      ];
      if (result.muteCase) {
        lines.push(`Авто-мут на неделю: кейс **#${result.muteCase.caseId}**`);
      }
      const cases = await listUserHistory(interaction.guildId, targetUser.id, 10);
      await interaction.editReply({
        content: lines.join("\n"),
        embeds: [historyEmbed(targetUser, cases, result.warnCount)],
      });
      return true;
    }

    if (name === "unwarn") {
      const result = await applyUnwarn({
        guild: interaction.guild,
        target: targetUser,
        moderator: interaction.member,
        reason,
      });
      if (!result.ok) {
        await interaction.editReply({ content: result.error });
        return true;
      }
      const warns = await activeWarnCount(interaction.guildId, targetUser.id);
      const cases = await listUserHistory(interaction.guildId, targetUser.id, 10);
      await interaction.editReply({
        content: `Снят выговор **#${result.removed.caseId}** у <@${targetUser.id}>. Осталось: **${warns}**`,
        embeds: [historyEmbed(targetUser, cases, warns)],
      });
      return true;
    }

    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      await interaction.editReply({ content: "Пользователь не на сервере." });
      return true;
    }

    if (name === "mute") {
      const durationRaw = interaction.options.getString("duration") || "7d";
      const modCase = await applyMute({
        guild: interaction.guild,
        targetMember: member,
        moderator: interaction.member,
        reason,
        durationMs: parseDurationMs(durationRaw),
      });
      await interaction.editReply({
        content: `Мут **#${modCase.caseId}** → <@${targetUser.id}> до <t:${Math.floor(modCase.expiresAt.getTime() / 1000)}:f>`,
      });
      return true;
    }

    if (name === "unmute") {
      const modCase = await applyUnmute({
        guild: interaction.guild,
        targetMember: member,
        moderator: interaction.member,
        reason: reason || "Размут",
      });
      await interaction.editReply({
        content: `Размут **#${modCase.caseId}** → <@${targetUser.id}>`,
      });
      return true;
    }

    if (name === "ban") {
      const result = await applyBanRole({
        guild: interaction.guild,
        targetMember: member,
        moderator: interaction.member,
        reason,
      });
      const appeal = result.appealChannelId ? ` · апелляция: <#${result.appealChannelId}>` : "";
      await interaction.editReply({
        content: `Роль бана **#${result.modCase.caseId}** → <@${targetUser.id}>${appeal}`,
      });
      return true;
    }
  } catch (error) {
    logger.warn("Mod command failed", error.message);
    await interaction.editReply({ content: `Ошибка: ${error.message || "неизвестно"}` });
  }
  return true;
}

module.exports = {
  CUSTOM_IDS,
  WARN_MUTE_THRESHOLD,
  WEEK_MS,
  modRoleIds,
  memberHasModAccess,
  banRoleId,
  appealChannelId,
  applyWarn,
  applyUnwarn,
  applyMute,
  applyUnmute,
  applyBanRole,
  applyUnbanRole,
  buildInfoEmbed,
  historyEmbed,
  listUserHistory,
  activeWarnCount,
  appealPanelPayload,
  handleAppealButton,
  handleAppealModal,
  handleAppealStaffButton,
  handleModCommand,
  caseEmbed,
  sendModLog,
  typeLabel,
};
