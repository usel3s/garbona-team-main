const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
} = require("discord.js");
const { ACCENT } = require("./components");
const { findUserByDiscordId } = require("../services/discordVerifyService");
const { getAvailableUsd } = require("../services/withdrawalService");
const DiscordModCase = require("../models/DiscordModCase");
const DiscordSupportTicket = require("../models/DiscordSupportTicket");
const SteamLog = require("../models/SteamLog");
const Feedback = require("../models/Feedback");
const WithdrawalRequest = require("../models/WithdrawalRequest");
const ProfitTransaction = require("../models/ProfitTransaction");
const {
  WARN_MUTE_THRESHOLD,
  banRoleId,
  memberHasModAccess,
  typeLabel,
  activeWarnCount,
} = require("./moderation");

const ABOUT_PREFIX = "gb:about";
const TABS = [
  { id: "discord", label: "Discord" },
  { id: "garbona", label: "Garbona" },
  { id: "finance", label: "Финансы" },
  { id: "mods", label: "Нарушения" },
  { id: "activity", label: "Активность" },
];
const MODS_PER_PAGE = 5;

function parseAboutCustomId(customId) {
  const parts = String(customId || "").split(":");
  // gb:about:tab:targetId:page
  if (parts.length < 5 || parts[0] !== "gb" || parts[1] !== "about") return null;
  return {
    tab: parts[2],
    targetId: parts[3],
    page: Math.max(0, Number(parts[4]) || 0),
  };
}

function money(n) {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

function yesNo(v) {
  return v ? "да" : "нет";
}

function ts(ms) {
  if (!ms) return "—";
  return `<t:${Math.floor(Number(ms) / 1000)}:f>`;
}

function tsRel(ms) {
  if (!ms) return "—";
  return `<t:${Math.floor(Number(ms) / 1000)}:R>`;
}

function aboutNavRow(targetId, activeTab, page = 0) {
  return new ActionRowBuilder().addComponents(
    ...TABS.map((tab) =>
      new ButtonBuilder()
        .setCustomId(`${ABOUT_PREFIX}:${tab.id}:${targetId}:${tab.id === "mods" ? page : 0}`)
        .setStyle(tab.id === activeTab ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setLabel(tab.label)
    )
  );
}

function modsPagerRow(targetId, page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${ABOUT_PREFIX}:mods:${targetId}:${Math.max(0, page - 1)}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel("◀")
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`${ABOUT_PREFIX}:mods:${targetId}:${page}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel(`${page + 1} / ${Math.max(1, totalPages)}`)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`${ABOUT_PREFIX}:mods:${targetId}:${Math.min(totalPages - 1, page + 1)}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel("▶")
      .setDisabled(page >= totalPages - 1)
  );
}

async function buildDiscordTab(member, user) {
  const roles = member.roles.cache
    .filter((r) => r.id !== member.guild.id)
    .sort((a, b) => b.position - a.position);
  const roleMentions = roles.map((r) => `<@&${r.id}>`).slice(0, 20);
  const banId = banRoleId();
  const hasBan = banId && member.roles.cache.has(banId);
  const timeoutUntil = member.communicationDisabledUntilTimestamp;
  const perms = member.permissions;
  const flags = [
    perms.has(PermissionFlagsBits.Administrator) && "Admin",
    perms.has(PermissionFlagsBits.ManageGuild) && "Manage Server",
    perms.has(PermissionFlagsBits.ModerateMembers) && "Moderate",
    perms.has(PermissionFlagsBits.ManageMessages) && "Manage Msg",
    perms.has(PermissionFlagsBits.KickMembers) && "Kick",
    perms.has(PermissionFlagsBits.BanMembers) && "Ban",
  ].filter(Boolean);

  return new EmbedBuilder()
    .setColor(ACCENT.pending)
    .setTitle(`About · Discord · ${user.tag || user.username}`)
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .setDescription(`Профиль <@${user.id}>`)
    .addFields(
      { name: "ID", value: `\`${user.id}\``, inline: true },
      { name: "Username", value: `\`${user.username}\``, inline: true },
      {
        name: "Display",
        value: member.displayName ? `\`${member.displayName}\`` : "—",
        inline: true,
      },
      {
        name: "Global name",
        value: user.globalName ? `\`${user.globalName}\`` : "—",
        inline: true,
      },
      { name: "Аккаунт", value: `${ts(user.createdTimestamp)}\n${tsRel(user.createdTimestamp)}`, inline: true },
      {
        name: "На сервере",
        value: member.joinedTimestamp
          ? `${ts(member.joinedTimestamp)}\n${tsRel(member.joinedTimestamp)}`
          : "—",
        inline: true,
      },
      {
        name: "Ник на сервере",
        value: member.nickname ? `\`${member.nickname}\`` : "нет",
        inline: true,
      },
      {
        name: "Буст",
        value: member.premiumSinceTimestamp
          ? `${tsRel(member.premiumSinceTimestamp)}`
          : "нет",
        inline: true,
      },
      {
        name: "Бот",
        value: yesNo(user.bot),
        inline: true,
      },
      {
        name: "Мут (timeout)",
        value: timeoutUntil ? `${ts(timeoutUntil)}\n${tsRel(timeoutUntil)}` : "нет",
        inline: true,
      },
      {
        name: "Роль бана",
        value: yesNo(hasBan),
        inline: true,
      },
      {
        name: "Выговоры DS",
        value: `**${await activeWarnCount(member.guild.id, user.id)}** / ${WARN_MUTE_THRESHOLD}`,
        inline: true,
      },
      {
        name: `Роли (${roles.size})`,
        value: roleMentions.length ? roleMentions.join(" ") : "—",
      },
      {
        name: "Ключевые права",
        value: flags.length ? flags.map((f) => `\`${f}\``).join(" · ") : "обычные",
      }
    )
    .setFooter({ text: "Garbona · About · Discord" })
    .setTimestamp(new Date());
}

async function buildGarbonaTab(member, user, linked) {
  const embed = new EmbedBuilder()
    .setColor(ACCENT.brand)
    .setTitle(`About · Garbona · ${user.tag || user.username}`)
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .setFooter({ text: "Garbona · About · Панель" })
    .setTimestamp(new Date());

  if (!linked) {
    return embed.setDescription("Discord **не привязан** к аккаунту Garbona.");
  }

  return embed.addFields(
    {
      name: "Идентификация",
      value: [
        `TG ID: \`${linked.telegramId}\``,
        `TG: ${linked.username ? `@${linked.username}` : "—"}`,
        `Имя: \`${linked.firstName || "—"}\``,
        `Кастом ID: \`${linked.customId || "—"}\``,
        `Панель логин: \`${linked.panelUsername || "—"}\``,
      ].join("\n"),
    },
    {
      name: "Статус",
      value: [
        `Роль: **${linked.role || "user"}**`,
        `В команде: **${yesNo(linked.isTeamMember)}**`,
        `Бан бота: **${yesNo(linked.isBanned)}**`,
        `Куратор: **${yesNo(linked.isCurator)}**`,
        `Прозвон: **${yesNo(linked.isCaller)}**`,
        `Модератор (панель): **${yesNo(linked.isModerator)}**`,
      ].join("\n"),
      inline: true,
    },
    {
      name: "Привязки",
      value: [
        `Куратор TG: \`${linked.curatorTelegramId || "—"}\``,
        `Прозвон TG: \`${linked.callerTelegramId || "—"}\``,
        `Discord verify: ${linked.discordVerifiedAt ? tsRel(linked.discordVerifiedAt) : "—"}`,
        `Аноним: **${yesNo(linked.isAnonymous)}**`,
        `FAKE-TAG: \`${linked.fakeProfitTag || "—"}\``,
      ].join("\n"),
      inline: true,
    },
    {
      name: "Профиль",
      value: [
        `Bio: ${linked.bio ? linked.bio.slice(0, 200) : "—"}`,
        `Панель создана: ${linked.panelCreatedAt ? tsRel(linked.panelCreatedAt) : "—"}`,
        `Аккаунт Garbona: ${linked.createdAt ? tsRel(linked.createdAt) : "—"}`,
        `Обновлён: ${linked.updatedAt ? tsRel(linked.updatedAt) : "—"}`,
        `Автопродажа логов: **${yesNo(linked.autoSellLogs !== false)}**`,
      ].join("\n"),
    },
    {
      name: "Steam settings",
      value: [
        `Версия: \`${linked.panelSteamSettingsVersion || 0}\``,
        `Настроены: ${linked.panelSteamSettingsConfiguredAt ? tsRel(linked.panelSteamSettingsConfiguredAt) : "нет"}`,
        `Ошибка: ${linked.panelSteamSettingsError || "—"}`,
      ].join("\n"),
    }
  );
}

async function buildFinanceTab(user, linked) {
  const embed = new EmbedBuilder()
    .setColor(0xfaa61a)
    .setTitle(`About · Финансы · ${user.tag || user.username}`)
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .setFooter({ text: "Garbona · About · Финансы" })
    .setTimestamp(new Date());

  if (!linked) {
    return embed.setDescription("Нет привязанного аккаунта Garbona.");
  }

  const available = await getAvailableUsd(linked).catch(() => 0);
  const [withdrawals, profits, pendingWd] = await Promise.all([
    WithdrawalRequest.countDocuments({ telegramId: linked.telegramId }),
    ProfitTransaction.countDocuments({ userId: linked._id }),
    WithdrawalRequest.countDocuments({
      telegramId: linked.telegramId,
      status: { $in: ["pending", "awaiting_payout_link"] },
    }),
  ]);
  const recentWd = await WithdrawalRequest.find({ telegramId: linked.telegramId })
    .sort({ createdAt: -1 })
    .limit(3)
    .lean();

  const payoutLines = (linked.payoutRequisites || [])
    .slice(0, 5)
    .map((r) => `\`${r.method}\` · \`${String(r.address || "").slice(0, 24)}\``);

  return embed.addFields(
    {
      name: "Баланс",
      value: [
        `Профит всего: **${money(linked.totalProfit)}**`,
        `Доступно: **${money(available)}**`,
        `Холд автопродаж: **${money(linked.frozenSaleUsd)}**`,
        `Резерв выводов: **${money(linked.reservedWithdrawalUsd)}**`,
        `Доля: **${linked.profitPercent ?? 70}%**`,
      ].join("\n"),
      inline: true,
    },
    {
      name: "Куратор / прозвон %",
      value: [
        `Куратор %: **${linked.curatorPercent ?? 80}%**`,
        `Мин. профитов кур.: **${money(linked.curatorMinProfits)}**`,
        `Прозвон %: **${linked.callerPercent ?? 80}%**`,
        `Мин. профитов прозвон: **${money(linked.callerMinProfits)}**`,
      ].join("\n"),
      inline: true,
    },
    {
      name: "Выводы",
      value: [
        `Всего заявок: **${withdrawals}**`,
        `В очереди: **${pendingWd}**`,
        `Начислений: **${profits}**`,
        `Метод по умолчанию: \`${linked.payoutMethod || "—"}\``,
      ].join("\n"),
    },
    {
      name: "Реквизиты",
      value: payoutLines.length ? payoutLines.join("\n") : linked.payoutAddress || "—",
    },
    {
      name: "Последние выводы",
      value: recentWd.length
        ? recentWd
            .map(
              (w) =>
                `${money(w.amountUsd)} · \`${w.status}\` · ${w.createdAt ? tsRel(w.createdAt) : ""}`
            )
            .join("\n")
        : "нет",
    }
  );
}

async function buildModsTab(guildId, user, page) {
  const warnCount = await activeWarnCount(guildId, user.id);
  const total = await DiscordModCase.countDocuments({ guildId, userId: user.id });
  const totalPages = Math.max(1, Math.ceil(total / MODS_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const cases = await DiscordModCase.find({ guildId, userId: user.id })
    .sort({ createdAt: -1 })
    .skip(safePage * MODS_PER_PAGE)
    .limit(MODS_PER_PAGE)
    .lean();

  const [warns, mutes, bans, appeals] = await Promise.all([
    DiscordModCase.countDocuments({ guildId, userId: user.id, type: "warn" }),
    DiscordModCase.countDocuments({ guildId, userId: user.id, type: "mute" }),
    DiscordModCase.countDocuments({ guildId, userId: user.id, type: "ban" }),
    DiscordModCase.countDocuments({ guildId, userId: user.id, type: "appeal" }),
  ]);

  const lines = cases.length
    ? cases.map((c) => {
        const active = c.active ? "" : " · ~~снято~~";
        return [
          `\`#${c.caseId}\` **${typeLabel(c.type)}** · ${tsRel(c.createdAt)}${active}`,
          `└ ${c.reason || "—"}${c.moderatorId ? ` · <@${c.moderatorId}>` : ""}`,
        ].join("\n");
      })
    : ["Нарушений нет."];

  const embed = new EmbedBuilder()
    .setColor(ACCENT.discord)
    .setTitle(`About · Нарушения · ${user.tag || user.username}`)
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .setDescription(lines.join("\n\n").slice(0, 3900))
    .addFields(
      {
        name: "Сводка",
        value: [
          `Активные выговоры: **${warnCount}** / ${WARN_MUTE_THRESHOLD}`,
          `Всего кейсов: **${total}**`,
          `Warn / Mute / Ban / Appeal: **${warns}** / **${mutes}** / **${bans}** / **${appeals}**`,
        ].join("\n"),
      }
    )
    .setFooter({ text: `Garbona · About · Нарушения · стр. ${safePage + 1}/${totalPages}` })
    .setTimestamp(new Date());

  return { embed, page: safePage, totalPages };
}

async function buildActivityTab(guildId, user, linked) {
  const embed = new EmbedBuilder()
    .setColor(0x3b9eff)
    .setTitle(`About · Активность · ${user.tag || user.username}`)
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .setFooter({ text: "Garbona · About · Активность" })
    .setTimestamp(new Date());

  const [ticketsOpen, ticketsTotal] = await Promise.all([
    DiscordSupportTicket.countDocuments({ guildId, userId: user.id, status: "open" }),
    DiscordSupportTicket.countDocuments({ guildId, userId: user.id }),
  ]);

  if (!linked) {
    return embed.addFields(
      {
        name: "Discord поддержка",
        value: `Тикеты: **${ticketsTotal}** (открыто **${ticketsOpen}**)`,
      },
      { name: "Garbona", value: "Нет привязки — остальная активность недоступна." }
    );
  }

  const tg = linked.telegramId;
  const [
    logsTotal,
    logsValid,
    logsMafile,
    feedbackOpen,
    feedbackTotal,
    withdrawals,
  ] = await Promise.all([
    SteamLog.countDocuments({ ownerTelegramId: tg }),
    SteamLog.countDocuments({ ownerTelegramId: tg, logKind: "valid" }),
    SteamLog.countDocuments({ ownerTelegramId: tg, logKind: "mafile" }),
    Feedback.countDocuments({ telegramId: tg, status: "open" }),
    Feedback.countDocuments({ telegramId: tg }),
    WithdrawalRequest.countDocuments({ telegramId: tg }),
  ]);

  const referrals = Array.isArray(linked.teamReferrals) ? linked.teamReferrals.length : 0;
  const panelWarns = Array.isArray(linked.warns) ? linked.warns.length : 0;

  return embed.addFields(
    {
      name: "Steam / логи",
      value: [
        `Всего логов: **${logsTotal}**`,
        `Valid: **${logsValid}** · MaFile: **${logsMafile}**`,
      ].join("\n"),
      inline: true,
    },
    {
      name: "Поддержка",
      value: [
        `DS тикеты: **${ticketsTotal}** (open **${ticketsOpen}**)`,
        `TG фидбек: **${feedbackTotal}** (open **${feedbackOpen}**)`,
      ].join("\n"),
      inline: true,
    },
    {
      name: "Прочее",
      value: [
        `Рефералы доменов: **${referrals}**`,
        `Выводы: **${withdrawals}**`,
        `Warns в панели (архив): **${panelWarns}**`,
      ].join("\n"),
    }
  );
}

async function buildAboutPayload(guild, targetUser, tab = "discord", page = 0) {
  const member = await guild.members.fetch(targetUser.id).catch(() => null);
  if (!member) {
    return {
      content: "Пользователь не на сервере.",
      embeds: [],
      components: [],
    };
  }

  const linked = await findUserByDiscordId(targetUser.id);
  const active = TABS.some((t) => t.id === tab) ? tab : "discord";
  let embed;
  let modsPage = 0;
  let modsTotalPages = 1;

  if (active === "garbona") {
    embed = await buildGarbonaTab(member, targetUser, linked);
  } else if (active === "finance") {
    embed = await buildFinanceTab(targetUser, linked);
  } else if (active === "mods") {
    const mods = await buildModsTab(guild.id, targetUser, page);
    embed = mods.embed;
    modsPage = mods.page;
    modsTotalPages = mods.totalPages;
  } else if (active === "activity") {
    embed = await buildActivityTab(guild.id, targetUser, linked);
  } else {
    embed = await buildDiscordTab(member, targetUser);
  }

  const components = [aboutNavRow(targetUser.id, active, modsPage)];
  if (active === "mods" && modsTotalPages > 1) {
    components.push(modsPagerRow(targetUser.id, modsPage, modsTotalPages));
  }

  return { embeds: [embed], components };
}

async function handleAboutButton(interaction) {
  const parsed = parseAboutCustomId(interaction.customId);
  if (!parsed) return false;
  if (!memberHasModAccess(interaction.member)) {
    await interaction.reply({ content: "Недостаточно прав.", ephemeral: true });
    return true;
  }

  await interaction.deferUpdate();
  const user = await interaction.client.users.fetch(parsed.targetId).catch(() => null);
  if (!user) {
    await interaction.editReply({ content: "Пользователь не найден.", embeds: [], components: [] });
    return true;
  }

  const payload = await buildAboutPayload(
    interaction.guild,
    user,
    parsed.tab,
    parsed.page
  );
  await interaction.editReply(payload);
  return true;
}

module.exports = {
  ABOUT_PREFIX,
  TABS,
  buildAboutPayload,
  handleAboutButton,
  parseAboutCustomId,
};
