const { pe } = require("../utils/emoji");
const { workerPanelAppUrl } = require("../utils/panelLinks");
const { runBroadcast } = require("./broadcastService");
const { createPanelNotification } = require("./panelNotificationService");

/** Exact Telegram HTML body (custom emoji + bold). No marketplace brand names. */
function buildAutosaleAnnounceHtml() {
  return [
    `${pe("gift")} <b>Автоматическая продажа логов</b>`,
    "",
    "Добавили новый режим для валидных логов.",
    "",
    `${pe("success")} Валидные логи <b>выставляются на продажу автоматически</b>.`,
    `${pe("lock")} После продажи средства остаются <b>на холде</b>, пока не закончится гарантия — затем доля доступна к выводу.`,
    "",
    `${pe("settings")} Откройте <b>Настройки</b> в панели, чтобы включить опцию или посмотреть, как она работает.`,
  ].join("\n");
}

function buildAutosalePanelMessageHtml() {
  return [
    "Добавили автоматическую продажу валидных логов.",
    "",
    "Валидные логи выставляются на продажу автоматически. После продажи средства остаются на холде до окончания гарантии.",
    "",
    "Откройте этот раздел, чтобы включить опцию.",
  ].join("<br>");
}

function autosaleSettingsUrl() {
  const base = workerPanelAppUrl();
  if (!base) return "";
  return `${base}#settings/profile`;
}

function buildAutosaleBroadcastDraft() {
  const url = autosaleSettingsUrl();
  return {
    text: buildAutosaleAnnounceHtml(),
    parseMode: "HTML",
    disablePreview: true,
    button: url
      ? { text: "Открыть настройки", url }
      : undefined,
  };
}

/**
 * Telegram mass DM to team members + in-app panel notification for all workers.
 */
async function announceAutosaleFeature(telegram, { adminTelegramId = "system" } = {}) {
  const draft = buildAutosaleBroadcastDraft();
  const notification = await createPanelNotification(
    {
      title: "Автоматическая продажа логов",
      messageHtml: buildAutosalePanelMessageHtml(),
      severity: "info",
      linkType: "view",
      linkView: "settings",
    },
    adminTelegramId
  );

  const broadcast = await runBroadcast(telegram, draft);

  return {
    telegramHtml: draft.text,
    broadcast,
    notification: {
      id: String(notification._id),
      title: notification.title,
      severity: notification.severity,
      linkType: notification.linkType,
      linkView: notification.linkView,
      createdAt: notification.createdAt,
    },
  };
}

module.exports = {
  buildAutosaleAnnounceHtml,
  buildAutosalePanelMessageHtml,
  buildAutosaleBroadcastDraft,
  announceAutosaleFeature,
  autosaleSettingsUrl,
};
