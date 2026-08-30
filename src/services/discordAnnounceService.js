const { pe } = require("../utils/emoji");
const { env } = require("../config/env");
const { runBroadcast } = require("./broadcastService");
const { createPanelNotification } = require("./panelNotificationService");

function discordInviteUrl() {
  return String(env.aboutDiscordUrl || "https://discord.gg/VNQfrk5Wn5").trim();
}

function buildDiscordAnnounceHtml() {
  const url = discordInviteUrl();
  return [
    `${pe("celebrate")} <b>Discord Garbona открыт</b>`,
    "",
    "По вашим просьбам подняли <b>официальный Discord-сервер</b> команды.",
    "",
    `${pe("success")} Верификация через Garbona`,
    `${pe("notification")} Поддержка, баги и сотрудничество`,
    `${pe("edit")} Предложения по лендам, панели, Steam и боту`,
    `${pe("broadcast")} Новости, статус сервисов и голосовые комнаты`,
    "",
    `${pe("gift")} Залетайте — обсуждаем продукт и помогаем быстрее.`,
    url ? `\n${pe("link")} ${url}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildDiscordPanelMessageHtml() {
  const url = discordInviteUrl();
  return [
    "По вашим просьбам открыли официальный Discord-сервер Garbona.",
    "",
    "Там верификация, поддержка, предложения по лендам / панели / Steam и живое общение команды.",
    "",
    url
      ? `<a href="${url}">Залететь в Discord</a>`
      : "Ссылка на сервер скоро появится в боте.",
  ].join("<br>");
}

function buildDiscordBroadcastDraft() {
  const url = discordInviteUrl();
  return {
    text: buildDiscordAnnounceHtml(),
    parseMode: "HTML",
    disablePreview: false,
    button: url ? { text: "Залететь в Discord", url } : undefined,
  };
}

/**
 * Telegram mass DM to team + in-app panel notification.
 */
async function announceDiscordServer(telegram, { adminTelegramId = "system" } = {}) {
  const draft = buildDiscordBroadcastDraft();
  const url = discordInviteUrl();

  const notification = await createPanelNotification(
    {
      title: "Discord Garbona открыт",
      messageHtml: buildDiscordPanelMessageHtml(),
      severity: "info",
      linkType: url ? "url" : "none",
      linkUrl: url || undefined,
    },
    adminTelegramId
  );

  const broadcast = await runBroadcast(telegram, draft);

  return {
    telegramHtml: draft.text,
    inviteUrl: url,
    broadcast,
    notification: {
      id: String(notification._id),
      title: notification.title,
      severity: notification.severity,
      linkType: notification.linkType,
      linkUrl: notification.linkUrl,
      createdAt: notification.createdAt,
    },
  };
}

module.exports = {
  discordInviteUrl,
  buildDiscordAnnounceHtml,
  buildDiscordPanelMessageHtml,
  buildDiscordBroadcastDraft,
  announceDiscordServer,
};
