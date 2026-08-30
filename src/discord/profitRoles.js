const { PermissionFlagsBits } = require("discord.js");
const { env } = require("../config/env");
const { logger } = require("../utils/logger");
const { getDiscordClient } = require("./runtime");
const ProfitTransaction = require("../models/ProfitTransaction");
const { NON_STAT_CREDIT_KINDS } = require("../models/ProfitTransaction");
const User = require("../models/User");
const fs = require("fs");
const path = require("path");

/**
 * Lifetime worker-share tiers (not wallet balance — withdrawals don't demote incorrectly
 * unless profit transactions are reversed).
 */
const PROFIT_TIERS = [
  {
    key: "copper",
    name: "・$100+",
    minUsd: () => numEnv(env.discordProfitTierCopperUsd, 100),
    color: 0xc47a3a,
    envKey: "DISCORD_PROFIT_ROLE_COPPER_ID",
    roleId: () => String(env.discordProfitRoleCopperId || "1541905985411481660").trim(),
  },
  {
    key: "silver",
    name: "・$500+",
    minUsd: () => numEnv(env.discordProfitTierSilverUsd, 500),
    color: 0x9aa4b2,
    envKey: "DISCORD_PROFIT_ROLE_SILVER_ID",
    roleId: () => String(env.discordProfitRoleSilverId || "1541905986279837766").trim(),
  },
  {
    key: "gold",
    name: "・$2.500+",
    minUsd: () => numEnv(env.discordProfitTierGoldUsd, 2500),
    color: 0xe8b84a,
    envKey: "DISCORD_PROFIT_ROLE_GOLD_ID",
    roleId: () => String(env.discordProfitRoleGoldId || "1541905987290529854").trim(),
  },
];

function numEnv(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function upsertEnvVar(key, value) {
  if (!value) return;
  const envPath = path.resolve(process.cwd(), ".env");
  let text = "";
  try {
    text = fs.readFileSync(envPath, "utf8");
  } catch (_) {
    text = "";
  }
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(text)) text = text.replace(re, line);
  else text = `${text.trimEnd()}\n${line}\n`;
  fs.writeFileSync(envPath, text, "utf8");
  applyEnvRoleId(key, value);
}

/** In-memory only — used on bot restart without touching .env or Discord role settings. */
function applyEnvRoleId(key, value) {
  if (!value) return;
  process.env[key] = value;
  if (key === "DISCORD_PROFIT_ROLE_COPPER_ID") env.discordProfitRoleCopperId = value;
  if (key === "DISCORD_PROFIT_ROLE_SILVER_ID") env.discordProfitRoleSilverId = value;
  if (key === "DISCORD_PROFIT_ROLE_GOLD_ID") env.discordProfitRoleGoldId = value;
}

async function lifetimeProfitUsd(user) {
  if (!user?._id) return 0;
  const [agg] = await ProfitTransaction.aggregate([
    {
      $match: {
        userId: user._id,
        kind: { $nin: NON_STAT_CREDIT_KINDS },
      },
    },
    { $group: { _id: null, total: { $sum: "$workerShare" } } },
  ]);
  return Number((agg?.total || 0).toFixed(2));
}

function tiersUnlocked(lifetimeUsd) {
  return PROFIT_TIERS.filter((t) => lifetimeUsd >= t.minUsd());
}

/**
 * Resolve profit tier roles. By default only reads existing roles — no create/edit/reorder.
 * Pass { configure: true } from setup scripts to create missing roles and sync settings.
 */
async function ensureProfitRoles(guild, { configure = false } = {}) {
  await guild.roles.fetch();
  const created = [];
  const missing = [];

  for (const tier of PROFIT_TIERS) {
    let role =
      (tier.roleId() && guild.roles.cache.get(tier.roleId())) ||
      guild.roles.cache.find((r) => r.name === tier.name);

    if (!role) {
      if (!configure) {
        missing.push(tier.key);
        logger.warn(`Profit role not found (skipped): ${tier.name}`);
        continue;
      }
      role = await guild.roles.create({
        name: tier.name,
        colors: { primaryColor: tier.color },
        hoist: true,
        mentionable: false,
        permissions: [PermissionFlagsBits.BypassSlowmode],
        reason: `Garbona profit tier ${tier.key}`,
      });
      created.push(tier.key);
    } else if (configure) {
      const nextPerms = role.permissions.add(PermissionFlagsBits.BypassSlowmode);
      const patch = {};
      if (role.name !== tier.name) patch.name = tier.name;
      if (!role.permissions.equals(nextPerms)) patch.permissions = nextPerms;
      if (!role.hoist) patch.hoist = true;
      if (Object.keys(patch).length) {
        await role.edit(patch, "Garbona profit tier sync").catch(() => null);
      }
    }

    if (configure) upsertEnvVar(tier.envKey, role.id);
    else applyEnvRoleId(tier.envKey, role.id);
  }

  if (configure) {
    const gold = guild.roles.cache.get(String(env.discordProfitRoleGoldId || "").trim());
    const silver = guild.roles.cache.get(String(env.discordProfitRoleSilverId || "").trim());
    const copper = guild.roles.cache.get(String(env.discordProfitRoleCopperId || "").trim());
    try {
      if (copper && silver && gold) {
        const base = Math.max(copper.position, silver.position, gold.position, 1);
        await copper.setPosition(base);
        await silver.setPosition(base + 1);
        await gold.setPosition(base + 2);
      }
    } catch (error) {
      logger.warn("Profit role position adjust skipped", error.message);
    }
  }

  return {
    created,
    missing,
    configured: configure,
    roles: {
      copper: env.discordProfitRoleCopperId,
      silver: env.discordProfitRoleSilverId,
      gold: env.discordProfitRoleGoldId,
    },
    thresholds: {
      copper: PROFIT_TIERS[0].minUsd(),
      silver: PROFIT_TIERS[1].minUsd(),
      gold: PROFIT_TIERS[2].minUsd(),
    },
  };
}

async function syncProfitRolesForMember(member, user, { lifetimeUsd } = {}) {
  if (!member || member.user?.bot) return { ok: false, reason: "member" };
  const total = lifetimeUsd != null ? lifetimeUsd : await lifetimeProfitUsd(user);
  const unlocked = new Set(tiersUnlocked(total).map((t) => t.key));

  const add = [];
  const remove = [];
  for (const tier of PROFIT_TIERS) {
    const id = tier.roleId();
    if (!id) continue;
    const has = member.roles.cache.has(id);
    const should = unlocked.has(tier.key);
    if (should && !has) add.push(id);
    if (!should && has) remove.push(id);
  }

  for (const roleId of remove) {
    await member.roles.remove(roleId, "Garbona profit tier").catch(() => null);
  }
  for (const roleId of add) {
    await member.roles.add(roleId, "Garbona profit tier").catch(() => null);
  }

  return {
    ok: true,
    lifetimeUsd: total,
    unlocked: [...unlocked],
    added: add.length,
    removed: remove.length,
  };
}

async function syncProfitRolesForUser(user) {
  const discordId = String(user?.discordId || "").trim();
  if (!discordId) return { ok: false, reason: "no_discord" };
  const client = getDiscordClient();
  if (!client) return { ok: false, reason: "offline" };
  const guildId = String(env.discordGuildId || "").trim();
  if (!guildId) return { ok: false, reason: "guild" };

  try {
    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(discordId).catch(() => null);
    if (!member) return { ok: false, reason: "member" };
    return syncProfitRolesForMember(member, user);
  } catch (error) {
    logger.warn("Profit role sync failed", discordId, error.message);
    return { ok: false, reason: "error", error: error.message };
  }
}

async function reconcileProfitRoles(client = getDiscordClient()) {
  const guildId = String(env.discordGuildId || "").trim();
  if (!client || !guildId) return { ok: false, scanned: 0 };

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return { ok: false, scanned: 0 };

  await ensureProfitRoles(guild);

  const users = await User.find({
    discordId: { $type: "string", $gt: "" },
    isTeamMember: true,
    isBanned: { $ne: true },
  })
    .select("_id telegramId discordId")
    .lean();

  let scanned = 0;
  let updated = 0;
  for (const user of users) {
    scanned += 1;
    const member = await guild.members.fetch(user.discordId).catch(() => null);
    if (!member) continue;
    const result = await syncProfitRolesForMember(member, user);
    if (result.added || result.removed) updated += 1;
    if (scanned % 10 === 0) await new Promise((r) => setTimeout(r, 800));
  }

  logger.info(`Discord profit roles reconcile: scanned=${scanned} updated=${updated}`);
  return { ok: true, scanned, updated };
}

function scheduleProfitRoleSync(user) {
  if (!user?.discordId) return;
  setImmediate(() => {
    syncProfitRolesForUser(user).catch((error) => {
      logger.warn("Deferred profit role sync failed", error.message);
    });
  });
}

function formatThresholdLabel(usd) {
  const n = Number(usd) || 0;
  if (n >= 2500) return "$2.500";
  if (n >= 500) return "$500";
  if (n >= 100) return "$100";
  return `$${n}`;
}

function buildProfitRolesAnnounceEmbed() {
  const { EmbedBuilder } = require("discord.js");
  const { emojiMarkdown } = require("./emojis");
  const { ACCENT } = require("./components");
  const icon = emojiMarkdown("statistics") || emojiMarkdown("analytics") || "📊";

  const lines = PROFIT_TIERS.map((tier) => {
    const id = tier.roleId();
    const mention = id ? `<@&${id}>` : `**${tier.name}**`;
    const amount = formatThresholdLabel(tier.minUsd());
    return `${mention}  — роль за статистику от **${amount}**`;
  });

  return new EmbedBuilder()
    .setColor(ACCENT.brand)
    .setTitle(`${icon} Роли за статистику`)
    .setDescription(
      [
        "Если у вас имеется определённая сумма в статистике, вы получаете соответствующую роль:",
        "",
        ...lines,
        "",
        "Чем выше ваша статистика — тем выше ваша роль!",
        "",
        "_Роли выдаются автоматически по lifetime-профиту и дают обход медленного режима._",
      ].join("\n")
    )
    .setFooter({ text: "Garbona · Статистика" })
    .setTimestamp(new Date());
}

async function publishProfitRolesAnnounce(client, channelId) {
  const channel =
    (channelId && (await client.channels.fetch(channelId).catch(() => null))) ||
    null;
  let target = channel;
  if (!target) {
    const guild = await client.guilds.fetch(env.discordGuildId);
    await guild.channels.fetch();
    target =
      guild.channels.cache.find((c) => /новости/i.test(c.name || "")) ||
      guild.channels.cache.find((c) => /памятка/i.test(c.name || ""));
  }
  if (!target?.isTextBased?.()) {
    throw new Error("Не найден канал для анонса (#новости / #памятка)");
  }
  await ensureProfitRoles(await client.guilds.fetch(env.discordGuildId));
  const sent = await target.send({ embeds: [buildProfitRolesAnnounceEmbed()] });
  return { channelId: target.id, messageId: sent.id };
}

module.exports = {
  PROFIT_TIERS,
  lifetimeProfitUsd,
  ensureProfitRoles,
  syncProfitRolesForUser,
  syncProfitRolesForMember,
  reconcileProfitRoles,
  scheduleProfitRoleSync,
  buildProfitRolesAnnounceEmbed,
  publishProfitRolesAnnounce,
};
