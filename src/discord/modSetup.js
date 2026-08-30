const {
  ChannelType,
  PermissionFlagsBits,
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const { env } = require("../config/env");
const { logger } = require("../utils/logger");
const { appealPanelPayload, modRoleIds } = require("./moderation");

const BAN_ROLE_NAME = "・Ban";
const APPEAL_CHANNEL_NAME = "📩・апелляция";
const ENV_PATH = path.resolve(process.cwd(), ".env");

function upsertEnvVar(key, value) {
  if (!value) return;
  let text = "";
  try {
    text = fs.readFileSync(ENV_PATH, "utf8");
  } catch (_) {
    text = "";
  }
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(text)) {
    text = text.replace(re, line);
  } else {
    text = `${text.trimEnd()}\n${line}\n`;
  }
  fs.writeFileSync(ENV_PATH, text, "utf8");
  process.env[key] = value;
  if (key === "DISCORD_BAN_ROLE_ID") env.discordBanRoleId = value;
  if (key === "DISCORD_APPEAL_CHANNEL_ID") env.discordAppealChannelId = value;
}

async function ensureModerationSetup(guild, { publishPanel = true } = {}) {
  await guild.roles.fetch();
  await guild.channels.fetch();

  const everyone = guild.roles.everyone;
  const modIds = modRoleIds();

  // Ensure Mod + Fame can see slash commands (default_member_permissions = ModerateMembers)
  for (const roleId of modIds) {
    const role = guild.roles.cache.get(roleId);
    if (!role) continue;
    const next = role.permissions.add(PermissionFlagsBits.ModerateMembers);
    if (!role.permissions.equals(next)) {
      await role.setPermissions(next, "Garbona mod commands visibility").catch((err) => {
        logger.warn(`Could not grant ModerateMembers to ${role.name}`, err.message);
      });
    }
  }

  let banRole =
    (env.discordBanRoleId && guild.roles.cache.get(env.discordBanRoleId)) ||
    guild.roles.cache.find((r) => r.name === BAN_ROLE_NAME);

  if (!banRole) {
    banRole = await guild.roles.create({
      name: BAN_ROLE_NAME,
      colors: { primaryColor: 0xed4245 },
      hoist: true,
      mentionable: false,
      reason: "Garbona ban restriction role",
      permissions: [],
    });
  }
  upsertEnvVar("DISCORD_BAN_ROLE_ID", banRole.id);

  // Hide every channel from ban role (Deny beats other Allows). Appeal re-opens below.
  for (const channel of guild.channels.cache.values()) {
    if (!channel.permissionOverwrites?.edit) continue;
    if (channel.isThread?.()) continue;
    try {
      await channel.permissionOverwrites.edit(banRole.id, {
        ViewChannel: false,
        SendMessages: false,
        Connect: false,
      });
    } catch (_) {
      /* skip */
    }
  }

  let appeal =
    (env.discordAppealChannelId && guild.channels.cache.get(env.discordAppealChannelId)) ||
    guild.channels.cache.find((c) => c.name === APPEAL_CHANNEL_NAME);

  if (!appeal) {
    const parent =
      guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && /админ|admin/i.test(c.name)) ||
      null;
    appeal = await guild.channels.create({
      name: APPEAL_CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: parent?.id || null,
      topic: "Апелляции бана. Только с ролью Ban — одна кнопка, без спама.",
      permissionOverwrites: [
        { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: banRole.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.SendMessages,
          ],
        },
        ...modIds.map((id) => ({
          id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ManageMessages,
          ],
        })),
      ],
      reason: "Garbona appeal channel",
    });
  } else {
    await appeal.permissionOverwrites.edit(everyone.id, { ViewChannel: false }).catch(() => null);
    await appeal.permissionOverwrites
      .edit(banRole.id, {
        ViewChannel: true,
        ReadMessageHistory: true,
        SendMessages: true,
      })
      .catch(() => null);
    for (const id of modIds) {
      await appeal.permissionOverwrites
        .edit(id, {
          ViewChannel: true,
          ReadMessageHistory: true,
          SendMessages: true,
          ManageMessages: true,
        })
        .catch(() => null);
    }
  }

  // Ban role should still see appeal after the global hide pass
  await appeal.permissionOverwrites
    .edit(banRole.id, {
      ViewChannel: true,
      ReadMessageHistory: true,
      SendMessages: true,
    })
    .catch(() => null);

  upsertEnvVar("DISCORD_APPEAL_CHANNEL_ID", appeal.id);

  if (publishPanel && typeof appeal.send === "function") {
    const recent = await appeal.messages.fetch({ limit: 20 }).catch(() => null);
    const already = recent?.find(
      (m) => m.author?.id === guild.client.user.id && m.embeds?.[0]?.title?.includes("Апелляция")
    );
    if (!already) {
      await appeal.send(appealPanelPayload());
    }
  }

  return {
    banRoleId: banRole.id,
    appealChannelId: appeal.id,
  };
}

module.exports = { ensureModerationSetup, BAN_ROLE_NAME, APPEAL_CHANNEL_NAME };
