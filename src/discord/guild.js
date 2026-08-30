const { MessageFlags, Routes } = require("discord.js");
const { env } = require("../config/env");
const { logger } = require("../utils/logger");
const { getDiscordClient } = require("./runtime");
const { buildNickname } = require("../services/discordVerifyService");
const {
  logContainer,
  resolveLogoMedia,
  successContainer,
  errorContainer,
} = require("./components");

async function fetchGuild(client = getDiscordClient()) {
  const guildId = String(env.discordGuildId || "").trim();
  if (!client || !guildId) return null;
  try {
    return await client.guilds.fetch(guildId);
  } catch (error) {
    logger.warn("Discord guild fetch failed", error.message);
    return null;
  }
}

async function fetchMember(discordId, guild = null) {
  const id = String(discordId || "").trim();
  if (!id) return null;
  const targetGuild = guild || (await fetchGuild());
  if (!targetGuild) return null;
  try {
    return await targetGuild.members.fetch(id);
  } catch (error) {
    logger.warn("Discord member fetch failed", id, error.message);
    return null;
  }
}

async function syncMemberRoles(member, { add = [], remove = [] }, reason) {
  const uniqueAdd = [...new Set(add.map((id) => String(id || "").trim()).filter(Boolean))];
  const uniqueRemove = [...new Set(remove.map((id) => String(id || "").trim()).filter(Boolean))];

  for (const roleId of uniqueRemove) {
    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId, reason);
    }
  }
  for (const roleId of uniqueAdd) {
    if (!member.roles.cache.has(roleId)) {
      await member.roles.add(roleId, reason);
    }
  }
}

async function applyVerifiedAccess(discordId, user) {
  const client = getDiscordClient();
  const id = String(discordId || "").trim();
  const verifiedRoleId = String(env.discordVerifiedRoleId || "").trim();
  const unverifiedRoleId = String(env.discordUnverifiedRoleId || "").trim();
  if (!client || !id) return { ok: false, reason: "offline" };

  const member = await fetchMember(id);
  if (!member) return { ok: false, reason: "member" };

  try {
    await syncMemberRoles(
      member,
      {
        add: [verifiedRoleId],
        remove: [unverifiedRoleId],
      },
      "Garbona verification"
    );
  } catch (error) {
    logger.warn("Discord role add failed", error.message);
    return { ok: false, reason: "role" };
  }

  try {
    const { scheduleProfitRoleSync } = require("./profitRoles");
    scheduleProfitRoleSync(user);
  } catch (_) {
    /* optional */
  }

  if (env.discordSetNickname && member.manageable) {
    const nick = buildNickname(user);
    if (nick && member.nickname !== nick && member.user.username !== nick) {
      try {
        await member.setNickname(nick, "Garbona verification");
      } catch (error) {
        logger.warn("Discord nickname skipped", error.message);
      }
    }
  }

  return { ok: true };
}

async function applyUnverifiedAccess(discordId) {
  const client = getDiscordClient();
  const id = String(discordId || "").trim();
  const verifiedRoleId = String(env.discordVerifiedRoleId || "").trim();
  const unverifiedRoleId = String(env.discordUnverifiedRoleId || "").trim();
  if (!client || !id || !unverifiedRoleId) return { ok: false, reason: "offline" };

  const member = await fetchMember(id);
  if (!member) return { ok: false, reason: "member" };

  try {
    await syncMemberRoles(
      member,
      {
        add: [unverifiedRoleId],
        remove: [verifiedRoleId],
      },
      "Garbona unverified"
    );
    return { ok: true };
  } catch (error) {
    logger.warn("Discord unverified role apply failed", error.message);
    return { ok: false, reason: "role" };
  }
}

/**
 * Assign unverified role to members who joined while the bot was offline
 * (or otherwise have neither verified nor unverified).
 * Verified / linked members keep verified access.
 */
async function reconcileJoinRoles(client = getDiscordClient()) {
  const guildId = String(env.discordGuildId || "").trim();
  const unverifiedRoleId = String(env.discordUnverifiedRoleId || "").trim();
  const verifiedRoleId = String(env.discordVerifiedRoleId || "").trim();
  if (!client || !guildId || !unverifiedRoleId) {
    return { ok: false, reason: "config", scanned: 0, fixed: 0 };
  }

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return { ok: false, reason: "guild", scanned: 0, fixed: 0 };

  const { findUserByDiscordId, canVerifyUser } = require("../services/discordVerifyService");

  let scanned = 0;
  let fixed = 0;
  let verified = 0;
  let skipped = 0;

  try {
    await guild.members.fetch();
  } catch (error) {
    logger.warn("Discord member reconcile fetch failed", error.message);
    return { ok: false, reason: "fetch", scanned: 0, fixed: 0 };
  }

  for (const member of guild.members.cache.values()) {
    if (member.user?.bot) continue;
    scanned += 1;

    const hasVerified = verifiedRoleId && member.roles.cache.has(verifiedRoleId);
    const hasUnverified = member.roles.cache.has(unverifiedRoleId);

    try {
      const user = await findUserByDiscordId(member.id);
      const linked = Boolean(user) && canVerifyUser(user);

      if (linked) {
        if (!hasVerified || hasUnverified) {
          await applyVerifiedAccess(member.id, user);
          verified += 1;
        } else {
          skipped += 1;
        }
        continue;
      }

      if (!hasUnverified) {
        await syncMemberRoles(
          member,
          {
            add: [unverifiedRoleId],
            remove: verifiedRoleId ? [verifiedRoleId] : [],
          },
          "Garbona join reconcile"
        );
        fixed += 1;
        // Soft rate-limit Discord role edits
        if (fixed % 8 === 0) {
          await new Promise((r) => setTimeout(r, 1200));
        }
      } else {
        skipped += 1;
      }
    } catch (error) {
      logger.warn("Discord join reconcile member failed", member.id, error.message);
    }
  }

  logger.info(
    `Discord join roles reconcile: scanned=${scanned} unverifiedFixed=${fixed} verifiedSynced=${verified} skipped=${skipped}`
  );
  return { ok: true, scanned, fixed, verified, skipped };
}

async function revokeVerifiedAccess(discordId) {
  return applyUnverifiedAccess(discordId);
}

async function sendVerifyLog({ memberId, user, method, avatarUrl }) {
  const channelId = String(env.discordLogChannelId || "").trim();
  const client = getDiscordClient();
  if (!client || !channelId) return;

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased?.()) return;
    const logo = resolveLogoMedia();
    const payload = {
      flags: MessageFlags.IsComponentsV2,
      components: [logContainer({ memberId, user, method, logoUrl: logo.url, avatarUrl })],
      allowedMentions: { users: [String(memberId)] },
    };
    if (logo.files.length) payload.files = logo.files;
    await channel.send(payload);
  } catch (error) {
    logger.warn("Discord verify log failed", error.message);
  }
}

async function editVerifyInteraction(session, container, files = []) {
  if (!session?.applicationId || !session?.interactionToken) return;
  const client = getDiscordClient();
  if (!client) return;
  try {
    await client.rest.patch(
      Routes.webhookMessage(session.applicationId, session.interactionToken),
      {
        body: {
          flags: MessageFlags.IsComponentsV2,
          components: [container.toJSON()],
        },
        files: files.length ? files : undefined,
      }
    );
  } catch (error) {
    logger.warn("Discord interaction edit failed", error.message);
  }
}

async function markInteractionSuccess(session, user) {
  const logo = resolveLogoMedia();
  await editVerifyInteraction(
    session,
    successContainer({ user, session, logoUrl: session.discordAvatarUrl || logo.url }),
    logo.files
  );
}

async function markInteractionError(session, title, body) {
  await editVerifyInteraction(session, errorContainer(title, body));
}

async function finalizeVerification({ user, session, previousDiscordId }) {
  if (previousDiscordId && previousDiscordId !== session.discordId) {
    await revokeVerifiedAccess(previousDiscordId);
  }
  const access = await applyVerifiedAccess(session.discordId, user);
  await markInteractionSuccess(session, user);
  await sendVerifyLog({
    memberId: session.discordId,
    user,
    method: session.method || "telegram",
    avatarUrl: session.discordAvatarUrl,
  });
  return access;
}

module.exports = {
  applyVerifiedAccess,
  applyUnverifiedAccess,
  revokeVerifiedAccess,
  reconcileJoinRoles,
  sendVerifyLog,
  editVerifyInteraction,
  markInteractionSuccess,
  markInteractionError,
  finalizeVerification,
};
