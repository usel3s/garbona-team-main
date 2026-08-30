const { Markup } = require("telegraf");
const Application = require("../models/Application");
const { env } = require("../config/env");
const { moderatorApplicationKeyboard } = require("../keyboards/application");
const { getForm } = require("./formService");
const { pe, btn } = require("../utils/emoji");
const { logger } = require("../utils/logger");
const { setTeamMember } = require("./userService");
const { acceptedStartKeyboard, homeOnlyKeyboard } = require("../keyboards/common");
const { workerPanelAppUrl } = require("../utils/panelLinks");
const { ensureWorkerPanelAccount } = require("./panelAccountService");
const { applicationCampaignSnapshot, resolveCampaignLabel } = require("./adCampaignService");

const PAGE_SIZE = 5;
/** Повторная подача после отклонения — не раньше чем через 7 дней. */
const REAPPLY_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function formatUnlockDate(date) {
  return new Date(date).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const SUBSCRIBED_STATUSES = new Set([
  "creator",
  "administrator",
  "member",
  "restricted",
]);

function requiredInfoChannelUrl() {
  return (
    env.aboutInfoChannelUrl ||
    "https://t.me/garbonainfo"
  );
}

/**
 * Проверка подписки на info-канал (обязательна для заявки).
 * @returns {Promise<"yes"|"no"|"error">}
 */
async function checkInfoChannelSubscription(telegram, telegramId) {
  const chatId = String(env.aboutInfoChatId || "").trim();
  if (!chatId || !telegram || !telegramId) return "error";

  try {
    const member = await telegram.getChatMember(chatId, Number(telegramId));
    return SUBSCRIBED_STATUSES.has(member?.status) ? "yes" : "no";
  } catch (error) {
    logger.warn(
      "Info channel subscription check failed",
      String(telegramId),
      error.message
    );
    return "error";
  }
}

function notSubscribedGateMessage() {
  return [
    `${pe("lock")} <b>Подписка обязательна</b>`,
    "",
    "Перед подачей заявки подпишись на наш канал:",
    requiredInfoChannelUrl(),
    "",
    "После подписки нажми «Я подписался · проверить».",
  ].join("\n");
}

/**
 * Можно ли пользователю подавать заявку.
 * pending — нельзя; rejected — только через неделю после отклонения.
 * Подписка на ABOUT_INFO_CHAT_ID — обязательна (нужен ctx.telegram / bot.telegram).
 *
 * @param {object} user
 * @param {{ telegram?: import("telegraf").Telegram }} [options]
 */
async function getApplicationSubmitGate(user, options = {}) {
  if (!user?._id) {
    return {
      allowed: false,
      reason: "unknown",
      message: `${pe("error")} Не удалось проверить заявку. Попробуй позже.`,
    };
  }

  if (user.isBanned) {
    return {
      allowed: false,
      reason: "banned",
      message: `${pe("userBlocked")} Ты заблокирован и не можешь отправлять заявки.`,
    };
  }

  if (!String(user.username || "").trim()) {
    return {
      allowed: false,
      reason: "no_username",
      message: [
        `${pe("error")} У вас не установлен username в Telegram.`,
        "",
        "Чтобы подать заявку, пожалуйста, установите username в настройках Telegram:",
        "Настройки → Имя пользователя → Установите username",
        "",
        "После этого нажмите /start и попробуйте снова.",
      ].join("\n"),
    };
  }

  if (user.isTeamMember) {
    return {
      allowed: false,
      reason: "member",
      message: `${pe("info")} Ты уже состоишь в команде.`,
    };
  }

  const pending = await Application.findOne({
    userId: user._id,
    status: "pending",
  }).sort({ createdAt: -1 });

  if (pending) {
    return {
      allowed: false,
      reason: "pending",
      message: [
        `${pe("time")} <b>Заявка на рассмотрении</b>`,
        "",
        "Пока админы не примут решение, подать заявку повторно нельзя.",
        "Ожидай ответа — бот пришлёт уведомление.",
      ].join("\n"),
    };
  }

  const accepted = await Application.findOne({
    userId: user._id,
    status: "accepted",
  }).sort({ updatedAt: -1 });

  if (accepted) {
    return {
      allowed: false,
      reason: "accepted",
      message: `${pe("success")} Твоя заявка уже была принята.`,
    };
  }

  const lastRejected = await Application.findOne({
    userId: user._id,
    status: "rejected",
  }).sort({ updatedAt: -1 });

  if (lastRejected) {
    const decidedAt = lastRejected.updatedAt || lastRejected.createdAt;
    const unlockAt = new Date(decidedAt).getTime() + REAPPLY_COOLDOWN_MS;
    if (Date.now() < unlockAt) {
      return {
        allowed: false,
        reason: "cooldown",
        unlockAt: new Date(unlockAt),
        message: [
          `${pe("error")} <b>Заявка отклонена</b>`,
          "",
          "Подать заявку снова можно только через <b>7 дней</b> после отклонения.",
          `Доступно с: <b>${formatUnlockDate(unlockAt)}</b>`,
        ].join("\n"),
      };
    }
  }

  if (options.telegram) {
    const sub = await checkInfoChannelSubscription(
      options.telegram,
      user.telegramId
    );
    if (sub === "no") {
      return {
        allowed: false,
        reason: "not_subscribed",
        message: notSubscribedGateMessage(),
      };
    }
    if (sub === "error") {
      return {
        allowed: false,
        reason: "sub_check_failed",
        message: [
          `${pe("error")} Не удалось проверить подписку на канал.`,
          "",
          "Убедись, что ты подписан:",
          requiredInfoChannelUrl(),
          "",
          "Затем нажми «Я подписался · проверить» ещё раз.",
          "Если ошибка повторяется — напиши в поддержку.",
        ].join("\n"),
      };
    }
  }

  return { allowed: true, reason: "ok", message: "" };
}

async function createAndSendApplication(ctx, user, formId, answers) {
  const gate = await getApplicationSubmitGate(user, { telegram: ctx.telegram });
  if (!gate.allowed) {
    const err = new Error(gate.reason || "submit_blocked");
    err.code = "APPLICATION_BLOCKED";
    err.gate = gate;
    throw err;
  }

  const form = await getForm(formId);
  const campaignSnapshot = applicationCampaignSnapshot(user);
  const application = await Application.create({
    userId: user._id,
    formId,
    answers,
    status: "pending",
    ...campaignSnapshot,
  });

  try {
    const campaignLabel = await resolveCampaignLabel(
      campaignSnapshot.campaignId,
      campaignSnapshot.campaignSlug
    );
    const message = await ctx.telegram.sendMessage(
      env.applicationsChannelId,
      buildApplicationChannelText(user, answers, form, campaignLabel),
      {
        parse_mode: "HTML",
        reply_markup: moderatorApplicationKeyboard(application._id.toString()).reply_markup,
      }
    );
    application.channelMessageId = String(message.message_id);
    await application.save();
  } catch (error) {
    logger.warn(
      "Application saved but channel send failed",
      application._id.toString(),
      error.message
    );
  }

  return application;
}

function buildApplicationChannelText(user, answers, form, campaignLabel = null) {
  const lines = [
    `${pe("notification")} <b>Новая заявка в команду</b>`,
    "",
    `<b>User ID:</b> <code>${user.telegramId}</code>`,
    `<b>Username:</b> @${user.username || "unknown"}`,
    "",
  ];
  if (campaignLabel?.name) {
    lines.push(
      `<b>Реклама:</b> ${campaignLabel.name}\n<code>${campaignLabel.telegramUrl || ""}</code>`,
      ""
    );
  }
  for (const q of form.questions) {
    lines.push(`<b>${q.label}:</b> ${answers[q.key] || "-"}`);
  }
  const known = new Set(form.questions.map((q) => q.key));
  for (const [key, value] of Object.entries(answers || {})) {
    if (!known.has(key) && value) {
      lines.push(`<b>${key}:</b> ${value}`);
    }
  }
  return lines.join("\n");
}

async function formatApplicationCard(application, form) {
  const user = application.userId;
  const statusMap = {
    pending: "На рассмотрении",
    accepted: "Принята",
    rejected: "Отклонена",
  };
  const answers = application.answers || {};
  const campaignLabel = await resolveCampaignLabel(
    application.campaignId,
    application.campaignSlug
  );
  const lines = [
    `${pe("notification")} <b>Заявка</b> <code>${application._id}</code>`,
    "",
    `<b>Статус:</b> ${statusMap[application.status] || application.status}`,
    `<b>ID:</b> <code>${user?.telegramId || "—"}</code>`,
    `<b>Username:</b> @${user?.username || "unknown"}`,
    `<b>Создана:</b> ${new Date(application.createdAt).toLocaleString("ru-RU")}`,
    "",
  ];
  if (campaignLabel?.name) {
    lines.push(
      `<b>Реклама:</b> ${campaignLabel.name}\n<code>${campaignLabel.telegramUrl || ""}</code>`,
      ""
    );
  }

  const known = new Set((form?.questions || []).map((q) => q.key));
  for (const q of form?.questions || []) {
    lines.push(`<b>${q.label}:</b> ${answers[q.key] || "—"}`);
  }
  for (const [key, value] of Object.entries(answers)) {
    if (!known.has(key) && value) {
      lines.push(`<b>${key}:</b> ${value}`);
    }
  }

  if (application.moderatorId) {
    lines.push("");
    lines.push(`<b>Модератор:</b> <code>${application.moderatorId}</code>`);
  }

  if (!application.channelMessageId) {
    lines.push("");
    lines.push(`${pe("info")} <i>Не отправлена в канал модерации</i>`);
  }

  return lines.join("\n");
}

async function getPendingApplicationById(applicationId) {
  return Application.findById(applicationId).populate("userId");
}

async function getApplicationById(applicationId) {
  return Application.findById(applicationId).populate("userId");
}

async function updateApplicationStatus(applicationId, status, moderatorId) {
  return Application.findByIdAndUpdate(
    applicationId,
    { status, moderatorId: String(moderatorId) },
    { new: true }
  ).populate("userId");
}

async function listApplications({ status, statuses, page = 0 } = {}) {
  const filter = {};
  if (status) filter.status = status;
  else if (statuses?.length) filter.status = { $in: statuses };

  const skip = Math.max(0, page) * PAGE_SIZE;
  const [items, total] = await Promise.all([
    Application.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(PAGE_SIZE)
      .populate("userId", "telegramId username firstName avatarUrl isTeamMember")
      .lean(),
    Application.countDocuments(filter),
  ]);

  return {
    items,
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

function buildDecisionChannelMarkup(applicationId, action, moderatorName) {
  const resultLabel =
    action === "accept" ? `Принял: ${moderatorName}` : `Отклонил: ${moderatorName}`;
  const rows = [
    [btn(resultLabel, "moderate:done", action === "accept" ? "success" : "error")],
  ];
  if (action === "accept") {
    rows.push([
      btn("Изменить → отклонить", `moderate:reject:${applicationId}`, "error"),
    ]);
  } else {
    rows.push([
      btn("Изменить → принять", `moderate:accept:${applicationId}`, "success"),
    ]);
  }
  return Markup.inlineKeyboard(rows).reply_markup;
}

const WORKERS_WELCOME_INVITE_TTL_SEC = 7 * 24 * 60 * 60;

function hasWorkersChat() {
  return Boolean(String(env.aboutWorkersChatId || "").trim());
}

async function createWorkersChatInvite(telegram, telegramId, { ttlSec = WORKERS_WELCOME_INVITE_TTL_SEC } = {}) {
  const chatId = String(env.aboutWorkersChatId || "").trim();
  if (!chatId || !telegram) return null;
  try {
    const created = await telegram.createChatInviteLink(chatId, {
      expire_date: Math.floor(Date.now() / 1000) + ttlSec,
      member_limit: 1,
    });
    return created?.invite_link || null;
  } catch (error) {
    logger.warn(
      "Failed to create workers chat invite",
      String(telegramId || ""),
      error.message
    );
    return null;
  }
}

function buildAcceptedApplicantMessage(reversed, { hasChat, hasPanel }) {
  const lines = [
    `${pe("celebrate")} <b>${reversed ? "Решение изменено: заявка принята!" : "Заявка принята!"}</b>`,
    "",
    "Добро пожаловать в команду Garbona.",
  ];
  if (hasChat) {
    lines.push(
      "",
      "Вступи в наш чат — там можно найти единомышленников и просто пообщаться."
    );
  }
  if (hasPanel) {
    lines.push("", "Сайты и ссылки теперь в панели.");
  } else if (!hasChat) {
    lines.push("", "Нажми кнопку ниже, чтобы открыть меню.");
  }
  return lines.join("\n");
}

async function notifyApplicantDecision(telegram, user, action, { reversed = false } = {}) {
  if (!user?.telegramId) return;
  try {
    if (action === "accept") {
      const hasChat = hasWorkersChat();
      const hasPanel = Boolean(workerPanelAppUrl());
      const chatInviteUrl = hasChat
        ? await createWorkersChatInvite(telegram, user.telegramId)
        : "";
      await telegram.sendMessage(
        user.telegramId,
        buildAcceptedApplicantMessage(reversed, { hasChat, hasPanel }),
        {
          parse_mode: "HTML",
          reply_markup: acceptedStartKeyboard({
            chatInviteUrl,
            showChatCallback: hasChat && !chatInviteUrl,
          }).reply_markup,
        }
      );
    } else {
      await telegram.sendMessage(
        user.telegramId,
        reversed
          ? [
              `${pe("error")} <b>Решение по заявке изменено</b>`,
              "",
              "Ранее принятая заявка отклонена. Доступ к команде отозван.",
            ].join("\n")
          : `${pe("error")} К сожалению, твоя заявка была отклонена.`,
        {
          parse_mode: "HTML",
          reply_markup: homeOnlyKeyboard().reply_markup,
        }
      );
    }
  } catch (error) {
    logger.warn("Failed to notify applicant", user.telegramId, error.message);
  }
}

/**
 * Принять / отклонить заявку, в т.ч. сменить уже вынесенное решение.
 * action: "accept" | "reject"
 */
async function decideApplication(telegram, applicationId, action, moderator) {
  if (action !== "accept" && action !== "reject") {
    return { ok: false, reason: "invalid_action" };
  }

  const application = await getApplicationById(applicationId);
  if (!application) {
    return { ok: false, reason: "not_found" };
  }

  const newStatus = action === "accept" ? "accepted" : "rejected";
  if (application.status === newStatus) {
    return { ok: false, reason: "same_status", updated: application, action };
  }

  if (
    application.status !== "pending" &&
    application.status !== "accepted" &&
    application.status !== "rejected"
  ) {
    return { ok: false, reason: "already_processed", updated: application };
  }

  const previousStatus = application.status;
  const reversed = previousStatus !== "pending";
  const updated = await updateApplicationStatus(applicationId, newStatus, moderator.id);

  if (action === "accept") {
    await setTeamMember(updated.userId.telegramId, true);
    try {
      await ensureWorkerPanelAccount(updated.userId);
    } catch (error) {
      logger.error(
        "Failed to provision site access",
        updated.userId.telegramId,
        error?.response?.data || error.message
      );
    }
    if (env.treasuryPayoutEnabled) {
      try {
        const { ensureWorkerWallet } = require("./treasuryWalletService");
        await ensureWorkerWallet(updated.userId.telegramId);
      } catch (error) {
        logger.error(
          "Failed to provision treasury wallet",
          updated.userId.telegramId,
          error.message
        );
      }
    }
  } else if (previousStatus === "accepted") {
    await setTeamMember(updated.userId.telegramId, false);
  }

  await notifyApplicantDecision(telegram, updated.userId, action, { reversed });

  if (application.channelMessageId) {
    try {
      const moderatorName = moderator.first_name || moderator.username || "Admin";
      await telegram.editMessageReplyMarkup(
        env.applicationsChannelId,
        Number(application.channelMessageId),
        undefined,
        buildDecisionChannelMarkup(String(application._id), action, moderatorName)
      );
    } catch (error) {
      logger.warn("Failed to update channel application message", error.message);
    }
  }

  return {
    ok: true,
    updated,
    action,
    previousStatus,
    reversed,
  };
}

module.exports = {
  PAGE_SIZE,
  REAPPLY_COOLDOWN_MS,
  getApplicationSubmitGate,
  checkInfoChannelSubscription,
  requiredInfoChannelUrl,
  buildApplicationChannelText,
  formatApplicationCard,
  createAndSendApplication,
  getPendingApplicationById,
  getApplicationById,
  updateApplicationStatus,
  listApplications,
  decideApplication,
  buildDecisionChannelMarkup,
  createWorkersChatInvite,
};
