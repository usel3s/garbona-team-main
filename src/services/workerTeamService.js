const { pe } = require("../utils/emoji");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function telegramLink(username) {
  const clean = String(username || "").trim().replace(/^@/, "");
  if (!clean) return "";
  return `https://t.me/${clean}`;
}

/**
 * @param {import("../models/User")} user
 */
function serializeCuratorLike(user, { roleType } = {}) {
  const description =
    String(user?.curatorDescription || user?.callerDescription || "")
      .trim()
      .slice(0, 500) || "Описание пока не указано.";

  const percent = Number(user?.curatorPercent ?? user?.callerPercent ?? 80) || 80;
  const minProfits = Math.max(
    0,
    Number(user?.curatorMinProfits ?? user?.callerMinProfits ?? 0) || 0
  );

  const username = String(user?.username || "").trim().replace(/^@/, "");
  const telegramId = String(user?.telegramId || user?.telegram_id || "").trim();

  // В панели нужна возможность напрямую обратиться в Telegram.
  const link = telegramLink(username);

  return {
    telegramId,
    username,
    description,
    percent,
    minProfits,
    telegramLink: link,
  };
}

function teamCardHintHtml({ roleType } = {}) {
  // UI для панели проще собирать на фронте, но иногда нужно показать подсказку в тексте.
  if (roleType === "caller") return `${pe("broadcast")} Прозвонщица`;
  return `${pe("users")} Куратор`;
}

module.exports = {
  serializeCuratorLike,
  teamCardHintHtml,
  escapeHtml,
};

