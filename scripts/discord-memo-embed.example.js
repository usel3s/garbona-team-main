/**
 * Пример JS: памятка Discord (banner + select menu + ephemeral replies).
 * В боте: src/discord/embeds/memo.js
 */
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
} = require("discord.js");

const ACCENT = 0x18181d;

function banner(name) {
  return new ContainerBuilder().addMediaGalleryComponents(
    new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL(`attachment://${name}`)
    )
  );
}

function text(content) {
  return new ContainerBuilder()
    .setAccentColor(ACCENT)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}

async function buildMemoPanel(bannerBuffer) {
  return {
    flags: MessageFlags.IsComponentsV2,
    files: [new AttachmentBuilder(bannerBuffer, { name: "garbona-memo.png" })],
    components: [
      banner("garbona-memo.png"),
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("gb:memo")
          .setPlaceholder("Хотите что-то узнать?")
          .addOptions(
            {
              label: "О проекте",
              description: "Подробная информация о Garbona",
              value: "about",
              emoji: "📦",
            },
            {
              label: "Серверные роли",
              description: "Информация о серверных ролях",
              value: "roles",
              emoji: "🛡️",
            },
            {
              label: "Серверные каналы",
              description: "Информация о серверных каналах",
              value: "channels",
              emoji: "✈️",
            },
            {
              label: "Уведомления",
              description: "Получить роли уведомлений",
              value: "notifications",
              emoji: "❤️",
            },
            {
              label: "Условия использования",
              description: "Правила и условия Discord / Garbona",
              value: "terms",
              emoji: "📄",
            }
          )
      ),
    ],
  };
}

module.exports = { buildMemoPanel, text, banner };
