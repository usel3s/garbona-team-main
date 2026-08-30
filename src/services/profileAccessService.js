"use strict";

const path = require("path");
const fs = require("fs");
const { env } = require("../config/env");
const { ensureUser, isAdminTelegramId } = require("./userService");
const { getUserProfitStatsByTelegramId } = require("./profitService");
const { profileDeepLink } = require("./topService");
const { upsertBotPhoto, upsertBotMessage } = require("../utils/message");
const { pe } = require("../utils/emoji");

/** Минимальная сумма профитов (доля воркера за всё время), чтобы смотреть чужие профили. */
const MIN_PROFILE_VIEW_PROFIT_USD = 20;

const BANNER_PATH = path.join(__dirname, "../../assets/brand/access-denied-banner.png");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatProfileOwnerLinkHtml(label, telegramId, botUsername = env.botUsername) {
  const safe = escapeHtml(label);
  const tid = String(telegramId || "").trim();
  if (!tid) return `<b>${safe}</b>`;
  const href = profileDeepLink(botUsername, tid, "all");
  if (!href) return `<b>${safe}</b>`;
  return `<a href="${href}"><b>${safe}</b></a>`;
}

/**
 * Можно ли зрителю смотреть профиль targetTelegramId.
 * Свой профиль и админы — всегда. Иначе нужно ≥ $20 профитов.
 */
async function canViewOtherProfile(viewerFrom, targetTelegramId) {
  const viewerId = String(viewerFrom?.id || "").trim();
  const targetId = String(targetTelegramId || "").trim();
  if (!targetId) {
    return { ok: false, reason: "not_found", profitUsd: 0, requiredUsd: MIN_PROFILE_VIEW_PROFIT_USD };
  }
  if (viewerId && viewerId === targetId) {
    return { ok: true, self: true, profitUsd: null, requiredUsd: MIN_PROFILE_VIEW_PROFIT_USD };
  }
  if (viewerFrom?.id && isAdminTelegramId(viewerFrom.id)) {
    return { ok: true, admin: true, profitUsd: null, requiredUsd: MIN_PROFILE_VIEW_PROFIT_USD };
  }

  const viewer = await ensureUser(viewerFrom);
  if (viewer?.role === "admin") {
    return { ok: true, admin: true, profitUsd: null, requiredUsd: MIN_PROFILE_VIEW_PROFIT_USD };
  }

  const stats = await getUserProfitStatsByTelegramId(viewerId, "all");
  const profitUsd = Number(stats?.periodProfit || 0);
  if (profitUsd + 1e-9 < MIN_PROFILE_VIEW_PROFIT_USD) {
    return {
      ok: false,
      reason: "low_profit",
      profitUsd,
      requiredUsd: MIN_PROFILE_VIEW_PROFIT_USD,
    };
  }
  return { ok: true, profitUsd, requiredUsd: MIN_PROFILE_VIEW_PROFIT_USD };
}

function accessDeniedCaption(gate = {}) {
  const need = Number(gate.requiredUsd || MIN_PROFILE_VIEW_PROFIT_USD);
  const have = Number(gate.profitUsd || 0);
  return [
    `${pe("lock")} <b>Доступ запрещен</b>`,
    "",
    `Смотреть чужие профили можно при сумме профитов от <b>$${need.toFixed(0)}</b>.`,
    `У вас сейчас: <b>$${have.toFixed(2)}</b>.`,
  ].join("\n");
}

async function sendAccessDenied(ctx, gate = {}, extra = {}) {
  const caption = accessDeniedCaption(gate);
  if (fs.existsSync(BANNER_PATH)) {
    return upsertBotPhoto(
      ctx,
      { source: BANNER_PATH },
      {
        caption,
        parse_mode: "HTML",
        ...extra,
      }
    );
  }
  return upsertBotMessage(ctx, caption, { parse_mode: "HTML", ...extra });
}

/** Для /mp в чате — replyWithPhoto без upsert. */
async function replyAccessDenied(ctx, gate = {}, extra = {}) {
  const caption = accessDeniedCaption(gate);
  if (fs.existsSync(BANNER_PATH)) {
    return ctx.replyWithPhoto(
      { source: BANNER_PATH, filename: "access-denied.png" },
      { caption, parse_mode: "HTML", ...extra }
    );
  }
  return ctx.reply(caption, { parse_mode: "HTML", ...extra });
}

module.exports = {
  MIN_PROFILE_VIEW_PROFIT_USD,
  formatProfileOwnerLinkHtml,
  canViewOtherProfile,
  accessDeniedCaption,
  sendAccessDenied,
  replyAccessDenied,
};
