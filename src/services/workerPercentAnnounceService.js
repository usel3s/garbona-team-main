const { pe } = require("../utils/emoji");
const AppSettings = require("../models/AppSettings");
const User = require("../models/User");
const { runBroadcast } = require("./broadcastService");
const { createPanelNotification } = require("./panelNotificationService");
const { getGlobalWorkerPercent, DEFAULT_WORKER_PERCENT, GLOBAL_PERCENT_KEY } = require("./settingsService");

const PREVIOUS_WORKER_PERCENT = 80;
const MIGRATION_KEY = "workerPercentMigratedTo70";

function buildWorkerPercentAnnounceHtml({ from = PREVIOUS_WORKER_PERCENT, to = DEFAULT_WORKER_PERCENT } = {}) {
  return [
    `${pe("analytics")} <b>Процент воркера изменён</b>`,
    "",
    `Стало <b>${to}%</b> вместо ${from}%.`,
  ].join("\n");
}

function buildWorkerPercentPanelMessageHtml({ from = PREVIOUS_WORKER_PERCENT, to = DEFAULT_WORKER_PERCENT } = {}) {
  return `Доля воркера теперь <b>${to}%</b>. Было ${from}%.`;
}

function buildWorkerPercentBroadcastDraft(opts = {}) {
  return {
    text: buildWorkerPercentAnnounceHtml(opts),
    parseMode: "HTML",
    disablePreview: true,
  };
}

async function announceWorkerPercentChange(
  telegram,
  { from = PREVIOUS_WORKER_PERCENT, to = DEFAULT_WORKER_PERCENT, adminTelegramId = "system" } = {}
) {
  const draft = buildWorkerPercentBroadcastDraft({ from, to });
  const notification = await createPanelNotification(
    {
      title: "Процент изменён",
      messageHtml: buildWorkerPercentPanelMessageHtml({ from, to }),
      severity: "info",
      linkType: "none",
    },
    adminTelegramId
  );

  const broadcast = telegram
    ? await runBroadcast(telegram, draft)
    : { sent: 0, failed: 0, skipped: true };

  return {
    telegramHtml: draft.text,
    broadcast,
    notification: {
      id: String(notification._id),
      title: notification.title,
      severity: notification.severity,
      createdAt: notification.createdAt,
    },
  };
}

async function migrateDefaultWorkerPercentTo70(telegram, { adminTelegramId = "boot" } = {}) {
  const done = await AppSettings.findOne({ key: MIGRATION_KEY });
  if (done?.valueNumber === 1) return { skipped: true };

  const previous = await getGlobalWorkerPercent(PREVIOUS_WORKER_PERCENT);
  await AppSettings.findOneAndUpdate(
    { key: GLOBAL_PERCENT_KEY },
    { valueNumber: DEFAULT_WORKER_PERCENT },
    { upsert: true, new: true }
  );
  const users = await User.updateMany(
    { profitPercent: PREVIOUS_WORKER_PERCENT },
    { $set: { profitPercent: DEFAULT_WORKER_PERCENT } }
  );

  const announced = await announceWorkerPercentChange(telegram, {
    from: PREVIOUS_WORKER_PERCENT,
    to: DEFAULT_WORKER_PERCENT,
    adminTelegramId,
  });

  await AppSettings.findOneAndUpdate(
    { key: MIGRATION_KEY },
    { valueNumber: 1 },
    { upsert: true, new: true }
  );

  return {
    skipped: false,
    previous,
    to: DEFAULT_WORKER_PERCENT,
    usersUpdated: Number(users.modifiedCount || 0),
    announced,
  };
}

module.exports = {
  PREVIOUS_WORKER_PERCENT,
  buildWorkerPercentAnnounceHtml,
  buildWorkerPercentPanelMessageHtml,
  buildWorkerPercentBroadcastDraft,
  announceWorkerPercentChange,
  migrateDefaultWorkerPercentTo70,
};
