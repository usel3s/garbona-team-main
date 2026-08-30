const User = require("../models/User");
const { pe, urlBtn } = require("../utils/emoji");
const { Markup } = require("telegraf");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function callerMention(caller) {
  if (caller?.username) return `@${escapeHtml(caller.username)}`;
  return `<code>${escapeHtml(caller?.telegramId || "—")}</code>`;
}

function buildCallerCardHtml(caller) {
  const description = String(caller.callerDescription || "").trim() || "Описание пока не указано.";
  const percent = Number(caller.callerPercent) || 80;
  const minProfits = Math.max(0, Number(caller.callerMinProfits) || 0);
  return [
    `${pe("broadcast")} <b>Прозвонщица</b> ${callerMention(caller)}`,
    "",
    `${pe("edit")} <b>Описание</b>`,
    escapeHtml(description),
    "",
    `${pe("info")} <b>Условия</b>`,
    `${pe("analytics")} Процент: <b>${percent}%</b>`,
    `${pe("statistics")} Обязательно профитов: <b>${minProfits}</b>`,
  ].join("\n");
}

function callerCardKeyboard(caller) {
  const username = String(caller?.username || "").trim().replace(/^@/, "");
  if (!username) {
    return Markup.inlineKeyboard([]);
  }
  return Markup.inlineKeyboard([
    [urlBtn("Написать в личные", `https://t.me/${username}`, "broadcast")],
  ]);
}

async function updateCallerSettings(telegramId, { description, percent, minProfits }) {
  const update = {};
  if (description != null) update.callerDescription = String(description).trim().slice(0, 500);
  if (percent != null) {
    const p = Number(percent);
    if (!Number.isFinite(p) || p < 1 || p > 100) throw new Error("Процент должен быть от 1 до 100.");
    update.callerPercent = p;
  }
  if (minProfits != null) {
    const n = Number(minProfits);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      throw new Error("Количество профитов должно быть целым числом ≥ 0.");
    }
    update.callerMinProfits = n;
  }
  return User.findOneAndUpdate({ telegramId: String(telegramId) }, update, { new: true });
}

module.exports = {
  buildCallerCardHtml,
  callerCardKeyboard,
  updateCallerSettings,
};
