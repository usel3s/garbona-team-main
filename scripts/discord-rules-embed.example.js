/**
 * Пример JS-кода для rules embed (Components V2).
 * В боте используется src/discord/embeds/rules.js — этот файл для копирования/правок.
 */
const {
  AttachmentBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  TextDisplayBuilder,
} = require("discord.js");

const ACCENT = 0x18181d;
const ZWSP = "\u200b";

const sections = [
  {
    title: "Введение",
    body:
      "Данные правила относятся к серверу Garbona. Для использования нашей продукции вам требуется " +
      "ознакомиться и принять Условия пользования и Политику конфиденциальности Garbona. " +
      "Так же вы, как и наш проект, учитываем ToS и политику самого Discord.",
  },
  {
    title: "Адекватное поведение",
    body:
      "Воздержитесь от оскорблений, грубостей, злоупотребления матом и прочих разновидностей буянства.\n" +
      "Уважайте собеседников и не создавайте другим дискомфорт.",
  },
  {
    title: "Загрязнение сервера",
    body:
      "Запрещается чрезмерно использовать КАПС и ЗаБоРчИк, а также Zalgo-шрифты, флуд и спам. " +
      "Помимо этого вам запрещено использовать сервер в целях привлечения коммерческой выгоды " +
      "и размещать рекламу сторонних ресурсов.",
  },
  {
    title: "Язык",
    body:
      "Garbona в данный момент ориентируется исключительно на один сегмент — русский, " +
      "соответственно разговоры на любых других языках будут рассматриваться как нарушение.",
  },
  {
    title: "Жалоба",
    body:
      "Если вам не нравится пользователь, можете подать на него жалобу или обсудить его поведение " +
      "с одним из модераторов, или просто заглушить его для себя.",
  },
];

function section(title, body) {
  return new ContainerBuilder()
    .setAccentColor(ACCENT)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [`${ZWSP}**┃ ${title}**`, "```", body.trim(), "```"].join("\n")
      )
    );
}

async function buildRulesMessage(bannerBuffer) {
  const files = [new AttachmentBuilder(bannerBuffer, { name: "garbona-rules.png" })];
  const components = [
    new ContainerBuilder().addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL("attachment://garbona-rules.png")
      )
    ),
    ...sections.map((item) => section(item.title, item.body)),
  ];

  return {
    flags: MessageFlags.IsComponentsV2,
    components,
    files,
  };
}

module.exports = { buildRulesMessage, sections };
