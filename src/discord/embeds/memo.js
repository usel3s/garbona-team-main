const path = require("path");
const fs = require("fs");
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
const { renderDiscordProfileBanner } = require("../../utils/mainMenuBannerRenderer");
const { ACCENT, ZWSP } = require("../components");

const MEMO_BANNER_FILE = path.resolve(__dirname, "../../../assets/brand/embed-memo.png");

const CUSTOM_IDS = {
  memoSelect: "gb:memo",
  notifySelect: "gb:notify",
};

const MEMO_OPTIONS = [
  {
    value: "about",
    label: "О проекте",
    description: "Подробная информация о Garbona",
    emoji: "📦",
  },
  {
    value: "roles",
    label: "Серверные роли",
    description: "Информация о серверных ролях",
    emoji: "🛡️",
  },
  {
    value: "channels",
    label: "Серверные каналы",
    description: "Информация о серверных каналах",
    emoji: "✈️",
  },
  {
    value: "notifications",
    label: "Уведомления",
    description: "Получить роли уведомлений",
    emoji: "❤️",
  },
  {
    value: "terms",
    label: "Условия использования",
    description: "Правила и условия Discord / Garbona",
    emoji: "📄",
  },
];

function textContainer(content, accent = ACCENT.discord) {
  return new ContainerBuilder()
    .setAccentColor(accent)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}

function bannerContainer(attachmentName) {
  return new ContainerBuilder()
    .setAccentColor(ACCENT.discord)
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${attachmentName}`)
      )
    );
}

function memoPanelContainer(attachmentName) {
  return new ContainerBuilder()
    .setAccentColor(ACCENT.discord)
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${attachmentName}`)
      )
    )
    .addActionRowComponents(new ActionRowBuilder().addComponents(memoSelectMenu()));
}

async function loadBanner(kind = "memo") {
  if (kind === "profile") {
    return renderDiscordProfileBanner();
  }
  if (!fs.existsSync(MEMO_BANNER_FILE)) {
    throw new Error(`Memo banner missing: ${MEMO_BANNER_FILE}`);
  }
  return fs.readFileSync(MEMO_BANNER_FILE);
}

function memoSelectMenu() {
  return new StringSelectMenuBuilder()
    .setCustomId(CUSTOM_IDS.memoSelect)
    .setPlaceholder("Хотите что-то узнать?")
    .addOptions(
      MEMO_OPTIONS.map((option) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(option.label)
          .setDescription(option.description)
          .setValue(option.value)
          .setEmoji(option.emoji)
      )
    );
}

async function buildMemoEmbedPayload() {
  const banner = await loadBanner("memo");
  const files = [new AttachmentBuilder(banner, { name: "embed-memo.png" })];

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [memoPanelContainer("embed-memo.png")],
    files,
  };
}

function aboutReplyPayload() {
  const content = [
    "**Garbona** — платформа для команды: логи, maFile, аналитика, кошелёк и панель воркера.",
    "",
    "В арсенале — *автопродажа*, *мониторинг Steam*, *статистика* и *веб-кабинет*.",
    "",
    "**Garbona Discord** — сервер команды: здесь можно **обратиться** за помощью, получить **фидбек**, **сообщить** об ошибке или **предложить** идею.",
  ].join("\n");

  return {
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    components: [textContainer(content)],
  };
}

function rolesReplyPayload() {
  const content = [
    "`@ · Team` — люди, за которыми стоит **разработка** и продукт Garbona",
    "`@ · Admin` — управление проектом и доступом",
    "`@ · Developer` — отвечающие за **разработку** бота и сервисов",
    "`@ · Curator` — кураторы команды",
    "`@ · Moderator` — контроль **голосовых** и **текстовых** чатов, а также **помощи**",
    "",
    "`@ · Verified` — участники, прошедшие **верификацию** Garbona",
    "`@ · Unverified` — новые участники до подтверждения",
    "",
    "`@ · Early Support` — люди, которые ранее **поддержали** проект",
    "`@ · Bug Hunter` — за указание на **ошибку** в `#🐞・поддержка`",
    "`@ · Idea` — за принятую **идею** в `#✨・предложения`",
    "",
    "`@ ・$100+` — статистика от **$100** (обход slowmode)",
    "`@ ・$500+` — статистика от **$500** (обход slowmode)",
    "`@ ・$2.500+` — статистика от **$2.500** (обход slowmode)",
    "",
    "`@ · Server Booster` — поддержавшие сервер через **Discord Boost**",
  ].join("\n");

  return {
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    components: [textContainer(content)],
  };
}

function channelsReplyPayload() {
  const block = (title, lines) =>
    [`\`- ▷ ${title}\``, ...lines.map((line) => `> ${line}`), ""].join("\n");

  const content = [
    block("Информация", [
      "`#📖・памятка` — ознакомление с информацией сервера",
      "`#📘・правила` — правила сервера, которые нужно соблюдать",
      "`🎤・опросы` — проведение опросов среди комьюнити",
    ]),
    block("Оповещения", [
      "`📢・новости` — важные объявления, связанные с проектом",
      "`🤖・статус` — отслеживание состояния наших сервисов",
      "`🔧・коммиты` — изменения в наших сервисах",
    ]),
    block("Технические", [
      "`#🐞・поддержка` — получение помощи от нашей команды",
      "`✨・предложения` — идеи по лендам, панели, Steam, боту и кошельку",
    ]),
    block("Текстовые", [
      "`#💭・общение` — общий чат для общения",
      "`#🗑️・корзина` — чат для использования команд ботов",
    ]),
  ].join("\n");

  return {
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    components: [textContainer(content)],
  };
}

function notifySelectMenu() {
  return new StringSelectMenuBuilder()
    .setCustomId(CUSTOM_IDS.notifySelect)
    .setPlaceholder("Выберете роль для уведомлений...")
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel("Очистить выбор")
        .setValue("clear")
        .setEmoji("🗑️"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Уведомление о состоянии")
        .setValue("status")
        .setEmoji("❤️"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Уведомление об обновлениях")
        .setValue("updates")
        .setEmoji("📄"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Уведомление об опросах")
        .setValue("polls")
        .setEmoji("📊")
    );
}

async function notificationsReplyPayload() {
  const banner = await loadBanner("profile");
  const content =
    "Хотите быть в **курсе** всех новостей и обновлений? Тогда вы можете **выбрать** нужные категории **уведомлений** в меню.";

  return {
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    components: [
      bannerContainer("garbona-profile.png"),
      textContainer(content),
      new ActionRowBuilder().addComponents(notifySelectMenu()),
    ],
    files: [new AttachmentBuilder(banner, { name: "garbona-profile.png" })],
  };
}

function termsReplyPayload() {
  const content = [
    `${ZWSP}**┃ Условия использования**`,
    "```",
    "Используя сервер и продукты Garbona, вы подтверждаете согласие с правилами сервера, условиями Discord и политикой проекта.",
    "",
    "Discord Terms: https://discord.com/terms",
    "Community Guidelines: https://discord.com/guidelines",
    "Privacy: https://discord.com/privacy",
    "```",
  ].join("\n");

  return {
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    components: [textContainer(content)],
  };
}

async function buildMemoSelectReply(value) {
  switch (value) {
    case "about":
      return aboutReplyPayload();
    case "roles":
      return rolesReplyPayload();
    case "channels":
      return channelsReplyPayload();
    case "notifications":
      return notificationsReplyPayload();
    case "terms":
      return termsReplyPayload();
    default:
      return {
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [textContainer("Неизвестный пункт меню.")],
      };
  }
}

function notifyAckPayload(choice) {
  const map = {
    clear: "Выбор уведомлений очищен.",
    status: "Категория: уведомления о состоянии.",
    updates: "Категория: уведомления об обновлениях.",
    polls: "Категория: уведомления об опросах.",
  };
  const body =
    map[choice] ||
    "Выбор сохранён. Роли уведомлений можно настроить в Discord после выдачи ID ролей.";

  return {
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    components: [textContainer(body)],
  };
}

module.exports = {
  CUSTOM_IDS,
  MEMO_OPTIONS,
  buildMemoEmbedPayload,
  buildMemoSelectReply,
  notifyAckPayload,
};
