const fs = require("fs");
const path = require("path");
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
} = require("discord.js");
const { env } = require("../config/env");
const { displayDiscordName } = require("../services/discordVerifyService");

const ACCENT = {
  brand: 0x2ee59d,
  pending: 0x3b9eff,
  danger: 0xff6b6b,
  discord: 0x18181d,
};

const DISCORD_LINKS = {
  terms: "https://discord.com/terms",
  guidelines: "https://discord.com/guidelines",
  privacy: "https://discord.com/privacy",
};

const ZWSP = "\u200b";
const EMSP = "\u2003";

const CUSTOM_IDS = {
  verify: "gb:verify",
};

function v2Flags(ephemeral = false) {
  return ephemeral
    ? MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    : MessageFlags.IsComponentsV2;
}

function logoFilePath() {
  const candidates = [
    path.resolve(__dirname, "../../panel/worker/assets/logo.png"),
    path.resolve(__dirname, "../../panel/assets/logo.png"),
    path.resolve(__dirname, "../../assets/brand/gb-icon.png"),
  ];
  return candidates.find((file) => fs.existsSync(file)) || "";
}

function publicLogoUrl() {
  const base = String(env.panelPublicUrl || "").replace(/\/$/, "");
  return base ? `${base}/app/assets/logo.png` : "";
}

function resolveLogoMedia() {
  const file = logoFilePath();
  if (file) {
    return {
      url: "attachment://garbona.png",
      files: [new AttachmentBuilder(file, { name: "garbona.png" })],
    };
  }
  const url = publicLogoUrl();
  if (/^https:\/\//i.test(url)) return { url, files: [] };
  return { url: "", files: [] };
}

function escapeMd(value) {
  return String(value ?? "").replace(/([\\_*~`|>])/g, "\\$1");
}

function formatAtUsername(username) {
  const safe = String(username ?? "").trim().replace(/`/g, "'");
  return safe ? `\`@${safe}\`` : "";
}

function legalLinksLine() {
  const gap = EMSP.repeat(6);
  const links = [
    `• [Условия Discord](${DISCORD_LINKS.terms})`,
    `[Правила сообщества](${DISCORD_LINKS.guidelines})`,
    `[Конфиденциальность](${DISCORD_LINKS.privacy})`,
  ];
  const rulesUrl = String(env.discordRulesUrl || "").trim();
  if (rulesUrl) links[2] = `[Правила сервера](${rulesUrl})`;
  return links.join(gap);
}

function verifyIntroText() {
  const body =
    "Чтобы получить доступ к общению на сервере, необходимо пройти верификацию — нажмите кнопку ниже. " +
    "Завершая проверку, вы подтверждаете согласие с правилами сервера и условиями Discord TOS.";
  return [
    "# Добро пожаловать!",
    ZWSP,
    `> ${EMSP}${body}`,
    ZWSP,
    legalLinksLine(),
  ].join("\n");
}

function verifyKeyButton() {
  return new ButtonBuilder()
    .setCustomId(CUSTOM_IDS.verify)
    .setStyle(ButtonStyle.Secondary)
    .setEmoji("🔑");
}

function verifyButton(label = "Верификация") {
  return new ButtonBuilder()
    .setCustomId(CUSTOM_IDS.verify)
    .setStyle(ButtonStyle.Secondary)
    .setLabel(label);
}

function thumbnailOrNone(section, url) {
  if (url) {
    section.setThumbnailAccessory(new ThumbnailBuilder().setURL(url));
  }
  return section;
}

function verifyIntroContainer() {
  return new ContainerBuilder()
    .setAccentColor(ACCENT.discord)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(verifyIntroText()));
}

function verifyPanelComponents() {
  return [
    verifyIntroContainer(),
    new ActionRowBuilder().addComponents(verifyKeyButton()),
  ];
}

function verifyPanelContainer() {
  return verifyIntroContainer();
}

function methodChoiceContainer({ session, telegramUrl, panelUrl, logoUrl }) {
  const name = escapeMd(displayDiscordName(session));
  const username = formatAtUsername(session.discordUsername);
  const identity = username ? `**${name}** · ${username}` : `**${name}**`;
  const header = new SectionBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      ["# Подтверждение", identity, "Ссылка одноразовая · 10 минут."].join("\n")
    )
  );
  thumbnailOrNone(header, session.discordAvatarUrl || logoUrl);

  const container = new ContainerBuilder()
    .setAccentColor(ACCENT.discord)
    .addSectionComponents(header);

  const buttons = [];
  if (telegramUrl) {
    buttons.push(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(telegramUrl).setLabel("Telegram")
    );
  }
  if (panelUrl) {
    buttons.push(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(panelUrl).setLabel("Панель")
    );
  }

  if (buttons.length) {
    container.addActionRowComponents(new ActionRowBuilder().addComponents(buttons));
    return container;
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "Ссылки недоступны. Админу нужно проверить BOT_USERNAME и PANEL_PUBLIC_URL."
    )
  );
  return container;
}

function successContainer({ user, session, logoUrl }) {
  const tg = formatAtUsername(user?.username) || escapeMd(user?.firstName || "участник");
  const header = new SectionBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        "# Готово",
        `**${escapeMd(displayDiscordName(session))}** связан с Garbona ${tg}.`,
        "Роль выдана — добро пожаловать на сервер.",
      ].join("\n")
    )
  );
  thumbnailOrNone(header, session?.discordAvatarUrl || logoUrl);

  return new ContainerBuilder().setAccentColor(ACCENT.discord).addSectionComponents(header);
}

function alreadyVerifiedContainer({ user, logoUrl, avatarUrl }) {
  const tg = formatAtUsername(user?.username) || "Garbona";
  const header = new SectionBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        "# Уже подтверждено",
        `Этот Discord связан с ${tg}.`,
        "Доступ на месте.",
      ].join("\n")
    )
  );
  thumbnailOrNone(header, avatarUrl || logoUrl);
  return new ContainerBuilder().setAccentColor(ACCENT.discord).addSectionComponents(header);
}

function errorContainer(title, body, logoUrl) {
  const header = new SectionBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${title}\n${body}`)
  );
  thumbnailOrNone(header, logoUrl);
  return new ContainerBuilder().setAccentColor(ACCENT.discord).addSectionComponents(header);
}

function statusContainer({ linked, user, memberTag, logoUrl, avatarUrl }) {
  const body = linked
    ? [
        "# Статус",
        `${memberTag || "Ты"} уже подтверждён — ${
          formatAtUsername(user?.username) || "аккаунт Garbona"
        }.`,
      ].join("\n")
    : [
        "# Статус",
        "Discord ещё не связан с Garbona.",
        "Нажми кнопку ниже, чтобы пройти верификацию.",
      ].join("\n");

  const header = new SectionBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(body)
  );
  thumbnailOrNone(header, avatarUrl || logoUrl);
  return new ContainerBuilder()
    .setAccentColor(ACCENT.discord)
    .addSectionComponents(header)
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        verifyButton(linked ? "Обновить" : "Верификация")
      )
    );
}

function joinDmContainer() {
  return verifyIntroContainer();
}

function logContainer({ memberId, user, method, logoUrl, avatarUrl }) {
  const via = method === "panel" ? "панель" : "Telegram";
  const tg = formatAtUsername(user?.username) || `\`${user?.telegramId || ""}\``;
  const header = new SectionBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [`# Верификация`, `<@${memberId}> → ${tg} · ${via}.`].join("\n")
    )
  );
  thumbnailOrNone(header, avatarUrl || logoUrl);
  return new ContainerBuilder().setAccentColor(ACCENT.discord).addSectionComponents(header);
}

function setupPostedContainer(channelId) {
  return new ContainerBuilder()
    .setAccentColor(ACCENT.discord)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# Готово\nПанель верификации опубликована в <#${channelId}>.`
      )
    );
}

module.exports = {
  ACCENT,
  ZWSP,
  CUSTOM_IDS,
  v2Flags,
  resolveLogoMedia,
  verifyPanelContainer,
  verifyPanelComponents,
  methodChoiceContainer,
  successContainer,
  alreadyVerifiedContainer,
  errorContainer,
  statusContainer,
  joinDmContainer,
  logContainer,
  setupPostedContainer,
};
