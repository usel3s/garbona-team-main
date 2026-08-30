const User = require("../models/User");
const CuratorApplication = require("../models/CuratorApplication");
const ProfitTransaction = require("../models/ProfitTransaction");
const { pe } = require("../utils/emoji");
const { Markup } = require("telegraf");
const { btn } = require("../utils/emoji");
const { profitStatsFilter } = require("./profitService");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function curatorMention(curator) {
  if (curator?.username) return `@${escapeHtml(curator.username)}`;
  return `<code>${escapeHtml(curator?.telegramId || "—")}</code>`;
}

function buildCuratorCardHtml(curator) {
  const description = String(curator.curatorDescription || "").trim() || "Описание пока не указано.";
  const percent = Number(curator.curatorPercent) || 80;
  const minProfits = Math.max(0, Number(curator.curatorMinProfits) || 0);
  return [
    `${pe("users")} <b>Куратор</b> ${curatorMention(curator)}`,
    "",
    `${pe("edit")} <b>Описание</b>`,
    escapeHtml(description),
    "",
    `${pe("info")} <b>Условия</b>`,
    `${pe("analytics")} Процент: <b>${percent}%</b>`,
    `${pe("statistics")} Обязательно профитов: <b>${minProfits}</b>`,
  ].join("\n");
}

function curatorCardKeyboard(curator) {
  const curatorTelegramId =
    typeof curator === "object" && curator != null ? curator.telegramId : curator;
  return Markup.inlineKeyboard([
    [btn("Подать заявку", `curator:apply:${curatorTelegramId}`, "notification")],
  ]);
}

async function countUserProfits(user) {
  if (!user?._id) return 0;
  return ProfitTransaction.countDocuments(profitStatsFilter({ userId: user._id }));
}

async function updateCuratorSettings(telegramId, { description, percent, minProfits }) {
  const update = {};
  if (description != null) update.curatorDescription = String(description).trim().slice(0, 500);
  if (percent != null) {
    const p = Number(percent);
    if (!Number.isFinite(p) || p < 1 || p > 100) throw new Error("Процент должен быть от 1 до 100.");
    update.curatorPercent = p;
  }
  if (minProfits != null) {
    const n = Number(minProfits);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      throw new Error("Количество профитов должно быть целым числом ≥ 0.");
    }
    update.curatorMinProfits = n;
  }
  return User.findOneAndUpdate({ telegramId: String(telegramId) }, update, { new: true });
}

async function getPendingApplication(applicantTelegramId, curatorTelegramId) {
  return CuratorApplication.findOne({
    applicantTelegramId: String(applicantTelegramId),
    curatorTelegramId: String(curatorTelegramId),
    status: "pending",
  });
}

async function createCuratorApplication(applicant, curator) {
  if (!curator?.isCurator) throw new Error("Этот пользователь не куратор.");
  if (String(applicant.telegramId) === String(curator.telegramId)) {
    throw new Error("Нельзя подать заявку самому себе.");
  }
  if (applicant.curatorTelegramId) {
    throw new Error("Вы уже привязаны к куратору.");
  }
  if (applicant.branchId || applicant.canCreateBranch || applicant.isCurator) {
    throw new Error("Филиал и куратор одновременно недоступны.");
  }

  const existingPending = await CuratorApplication.findOne({
    applicantTelegramId: String(applicant.telegramId),
    status: "pending",
  });
  if (existingPending) {
    throw new Error("У вас уже есть заявка на рассмотрении.");
  }

  const profits = await countUserProfits(applicant);
  const required = Math.max(0, Number(curator.curatorMinProfits) || 0);
  if (profits < required) {
    throw new Error(`Нужно минимум ${required} профитов. Сейчас: ${profits}.`);
  }

  return CuratorApplication.create({
    applicantTelegramId: String(applicant.telegramId),
    curatorTelegramId: String(curator.telegramId),
    status: "pending",
  });
}

async function acceptCuratorApplication(applicationId, curatorTelegramId) {
  const app = await CuratorApplication.findById(applicationId);
  if (!app || app.status !== "pending") throw new Error("Заявка не найдена или уже обработана.");
  if (String(app.curatorTelegramId) !== String(curatorTelegramId)) {
    throw new Error("Это не ваша заявка.");
  }

  const applicant = await User.findOne({ telegramId: app.applicantTelegramId });
  if (!applicant) throw new Error("Заявитель не найден.");
  if (applicant.curatorTelegramId) {
    app.status = "rejected";
    await app.save();
    throw new Error("Заявитель уже привязан к другому куратору.");
  }
  if (applicant.branchId || applicant.isCurator) {
    app.status = "rejected";
    await app.save();
    throw new Error("Заявитель связан с филиалом.");
  }

  applicant.curatorTelegramId = String(app.curatorTelegramId);
  await applicant.save();
  app.status = "accepted";
  await app.save();

  await CuratorApplication.updateMany(
    {
      applicantTelegramId: app.applicantTelegramId,
      status: "pending",
      _id: { $ne: app._id },
    },
    { status: "rejected" }
  );

  return { app, applicant };
}

async function rejectCuratorApplication(applicationId, curatorTelegramId) {
  const app = await CuratorApplication.findById(applicationId);
  if (!app || app.status !== "pending") throw new Error("Заявка не найдена или уже обработана.");
  if (String(app.curatorTelegramId) !== String(curatorTelegramId)) {
    throw new Error("Это не ваша заявка.");
  }
  app.status = "rejected";
  await app.save();
  return app;
}

function curatorApplicationModerationKeyboard(applicationId) {
  const id = String(applicationId);
  return Markup.inlineKeyboard([
    [
      btn("Принять", `curator:accept:${id}`, "success"),
      btn("Отклонить", `curator:reject:${id}`, "error"),
    ],
  ]);
}

function buildCuratorApplicationNotifyHtml(applicant) {
  const nick = applicant.username ? `@${escapeHtml(applicant.username)}` : "без username";
  return [
    `${pe("notification")} <b>Заявка к куратору</b>`,
    "",
    `${pe("profile")} От: ${nick}`,
    `${pe("users")} ID: <code>${escapeHtml(applicant.telegramId)}</code>`,
  ].join("\n");
}

module.exports = {
  escapeHtml,
  curatorMention,
  buildCuratorCardHtml,
  curatorCardKeyboard,
  countUserProfits,
  updateCuratorSettings,
  getPendingApplication,
  createCuratorApplication,
  acceptCuratorApplication,
  rejectCuratorApplication,
  curatorApplicationModerationKeyboard,
  buildCuratorApplicationNotifyHtml,
};
