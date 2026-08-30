const {
  ChannelType,
  EmbedBuilder,
  SortOrderType,
} = require("discord.js");
const { env } = require("../config/env");
const { logger } = require("../utils/logger");
const { ACCENT } = require("./components");
const { emojiMarkdown } = require("./emojis");

const SUGGESTIONS_CHANNEL_ID = "1541569013296136295";

/** Forum tags tailored to Garbona product surface. Name ≤ 20 chars (Discord limit). */
const SUGGESTION_TAGS = [
  { name: "Ленды", moderated: false },
  { name: "Панель", moderated: false },
  { name: "Steam / логи", moderated: false },
  { name: "MaFile", moderated: false },
  { name: "Telegram-бот", moderated: false },
  { name: "Автопродажа", moderated: false },
  { name: "Кошелёк", moderated: false },
  { name: "Статистика", moderated: false },
  { name: "Discord", moderated: false },
  { name: "Другое", moderated: false },
];

const TOPIC =
  "Идеи по лендам, панели, Steam/логам, MaFile, боту, автопродаже, кошельку и Discord. " +
  "Одна тема — одна идея. Выбери тег и опиши кратко: что, зачем, как проверить.";

function suggestionsChannelId() {
  return String(env.discordSuggestionsChannelId || SUGGESTIONS_CHANNEL_ID).trim();
}

function suggestionsGuideEmbed() {
  const tip = emojiMarkdown("dover") || "✨";
  return new EmbedBuilder()
    .setColor(ACCENT.pending)
    .setTitle(`${tip} Предложения Garbona`)
    .setDescription(
      [
        "Сюда кидаем **идеи по продукту** — то, что реально улучшит работу команды.",
        "",
        "**Как оформить**",
        "1. Создай пост и выбери **тег** направления",
        "2. Коротко: проблема → идея → зачем это нужно",
        "3. Одна тема = одна идея (без оффтопа и жалоб)",
        "",
        "**Что сюда подходит**",
        "• **Ленды** — шаблоны, конверсия, UX посадочных",
        "• **Панель** — кабинет воркера, сайты, аналитика",
        "• **Steam / логи / MaFile** — мониторинг, карточки, автопродажа",
        "• **Telegram-бот** — меню, сценарии, удобство",
        "• **Кошелёк / статистика** — выводы, холд, отчёты",
        "• **Discord** — каналы, роли, модерация, комнаты",
        "",
        "Баги и срочная помощь — в `#🐞・поддержка`, не сюда.",
      ].join("\n")
    )
    .setFooter({ text: "Garbona · Предложения" })
    .setTimestamp(new Date());
}

async function ensureSuggestionsForum(guild, { publishGuide = true } = {}) {
  const channelId = suggestionsChannelId();
  let channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    channel = guild.channels.cache.find((c) => /предложен/i.test(c.name || ""));
  }
  if (!channel) {
    throw new Error("Канал предложений не найден");
  }
  if (channel.type !== ChannelType.GuildForum) {
    throw new Error(`Канал предложений не форум (type=${channel.type})`);
  }

  await channel.setTopic(TOPIC).catch((err) => {
    logger.warn("Suggestions topic update failed", err.message);
  });

  try {
    await channel.setAvailableTags(SUGGESTION_TAGS);
  } catch (error) {
    logger.warn("Suggestions tags update failed", error.message);
    throw error;
  }

  try {
    await channel.setDefaultSortOrder(SortOrderType.LatestActivity);
  } catch (_) {
    /* optional */
  }

  try {
    await channel.setDefaultReactionEmoji({ name: "👍" });
  } catch (_) {
    /* optional */
  }

  let guideThreadId = null;
  if (publishGuide) {
    const active = await channel.threads.fetchActive().catch(() => null);
    const existing = active?.threads?.find(
      (t) => /как предлагать|предложения garbona|гайд/i.test(t.name || "")
    );
    if (existing) {
      guideThreadId = existing.id;
    } else {
      const created = await channel.threads.create({
        name: "Как предлагать идеи",
        message: { embeds: [suggestionsGuideEmbed()] },
        appliedTags: [],
        reason: "Garbona suggestions guide",
      });
      guideThreadId = created.id;
      try {
        await created.pin();
      } catch (_) {
        /* pin may require Manage Messages */
      }
    }
  }

  return {
    channelId: channel.id,
    tags: SUGGESTION_TAGS.map((t) => t.name),
    guideThreadId,
  };
}

module.exports = {
  SUGGESTIONS_CHANNEL_ID,
  SUGGESTION_TAGS,
  suggestionsChannelId,
  suggestionsGuideEmbed,
  ensureSuggestionsForum,
};
