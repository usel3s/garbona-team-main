const path = require("path");
const fs = require("fs");
const {
  AttachmentBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  TextDisplayBuilder,
} = require("discord.js");
const { ACCENT, ZWSP } = require("../components");

const RULES_BANNER_FILE = path.resolve(__dirname, "../../../assets/brand/embed-rules.png");

const RULES_SECTIONS = [
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

function rulesSectionContainer({ title, body }) {
  return new ContainerBuilder()
    .setAccentColor(ACCENT.discord)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [`${ZWSP}**┃ ${title}**`, "```", String(body || "").trim(), "```"].join("\n")
      )
    );
}

async function loadRulesBannerBuffer() {
  if (!fs.existsSync(RULES_BANNER_FILE)) {
    throw new Error(`Rules banner missing: ${RULES_BANNER_FILE}`);
  }
  return fs.readFileSync(RULES_BANNER_FILE);
}

function rulesBannerContainer() {
  return new ContainerBuilder().addMediaGalleryComponents(
    new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL("attachment://embed-rules.png")
    )
  );
}

async function buildRulesEmbedPayload() {
  const banner = await loadRulesBannerBuffer();
  const files = [new AttachmentBuilder(banner, { name: "embed-rules.png" })];
  const components = [rulesBannerContainer(), ...RULES_SECTIONS.map(rulesSectionContainer)];

  return {
    flags: MessageFlags.IsComponentsV2,
    components,
    files,
  };
}

module.exports = {
  RULES_SECTIONS,
  rulesSectionContainer,
  rulesBannerContainer,
  buildRulesEmbedPayload,
};
