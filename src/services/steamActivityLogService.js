const { env } = require("../config/env");
const { logger } = require("../utils/logger");
const { getUserByTelegramId } = require("./userService");

const STATUS_LABELS = {
  Ok: "Валид",
  Invalid: "Невалид",
  InvalidSession: "Невалидная сессия",
  Processing: "На снятии",
  OnProcessing: "В обработке",
  Empty: "Пустой",
  MaFile: "MaFile",
  Sold: "Продан",
  OnHandle: "Обрабатывается",
  OnSell: "На продаже",
  OnHold: "На удержании",
  Processed: "Обработан",
  InvalidRCode: "Неверный RCode",
  Locked: "Заблокирован",
  Restored: "Восстановлен",
  Converted: "Конвертирован",
  RedLocked: "КТ",
};

const MAFILE_PANEL_LABELS = {
  pending: "В ожидании снятия",
  withdrawn: "Успешно снят",
  invalid: "Невалид",
  sold: "Продан",
};

const BATCH_FLUSH_MS = 1500;
const BATCH_MAX_LINES = 28;
const BATCH_MAX_CHARS = 3400;

let telegramApi = null;
const pendingLines = [];
let flushTimer = null;
let flushInFlight = Promise.resolve();

function bindTelegram(telegram) {
  if (telegram?.sendMessage) telegramApi = telegram;
}

function formatStamp(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${hh}:${mm} ${day}.${month}`;
}

function moneyUsd(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "$0.00";
  return `$${n.toFixed(2)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function code(value) {
  return `<code>${escapeHtml(value)}</code>`;
}

function bold(value) {
  return `<b>${value}</b>`;
}

function statusLabel(status) {
  const key = String(status || "").trim();
  return STATUS_LABELS[key] || key || "—";
}

/**
 * «Воркер» — кликабельная ссылка на профиль TG.
 */
function workerRef(user, ownerTelegramId, { html = true } = {}) {
  const customId = String(user?.customId || "").trim();
  const tg = String(ownerTelegramId || user?.telegramId || "").trim();
  const idPart = customId || tg || "—";
  const username = String(user?.username || "").trim().replace(/^@/, "");
  if (html) {
    let linked = "Воркер";
    if (/^[A-Za-z0-9_]{4,32}$/.test(username)) {
      linked = `<a href="https://t.me/${username}">Воркер</a>`;
    } else if (/^\d+$/.test(tg)) {
      linked = `<a href="tg://user?id=${tg}">Воркер</a>`;
    }
    return `${linked}(${code(idPart)})`;
  }
  return `Воркер(id=${idPart})`;
}

function accountHighlights(account) {
  const parts = [];
  const prime =
    account?.is_prime === true ||
    account?.isPrime === true ||
    account?.steamInfo?.isPrime === true ||
    account?.steamInfo?.is_prime === true;
  if (prime) parts.push("CS2 PRIME");

  const games = Array.isArray(account?.games)
    ? account.games
    : Array.isArray(account?.steamInfo?.games)
      ? account.steamInfo.games
      : [];
  const names = games
    .map((g) => String(g?.name || g?.title || "").trim())
    .filter(Boolean)
    .slice(0, 2);
  for (const name of names) {
    if (!parts.includes(name)) parts.push(name);
  }

  const tag = String(account?.customTeamTag || account?.customTag || "").trim();
  if (tag) parts.push(tag);

  return parts;
}

function linkifyDetail(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const parts = [];
  const re = /(https?:\/\/[^\s<]+)/g;
  let last = 0;
  let match;
  while ((match = re.exec(raw))) {
    if (match.index > last) {
      parts.push(escapeHtml(raw.slice(last, match.index)));
    }
    let url = match[1];
    let trailing = "";
    const trimmed = url.match(/^(.*?)([),.;]+)$/);
    if (trimmed) {
      url = trimmed[1];
      trailing = trimmed[2];
    }
    const safe = escapeHtml(url);
    parts.push(`<a href="${safe}">${safe}</a>${escapeHtml(trailing)}`);
    last = match.index + match[0].length;
  }
  if (last < raw.length) parts.push(escapeHtml(raw.slice(last)));
  return parts.join("");
}

function stripRubAmounts(text) {
  return String(text || "")
    .replace(/₽\s*[\d.,]+(?:\s*→\s*)?/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function formatTypeId(sourceId) {
  const id = String(sourceId || "").trim();
  if (!id) return "";
  const label = /^\d+$/.test(id) ? `#${id}` : id;
  return `Тип: ${code(label)}`;
}

function withTypeId(sourceId, ...parts) {
  const typeLine = formatTypeId(sourceId);
  return [typeLine, ...parts.filter(Boolean)].join(" · ");
}

function buildLine(stamp, head, detail) {
  const tail = String(detail || "").trim();
  return `[${escapeHtml(stamp)}] [${head}]${tail ? ` : ${tail}` : ""}`;
}

function queueActivityLine(line) {
  const text = String(line || "").trim();
  if (!text) return Promise.resolve(false);
  pendingLines.push(text);
  scheduleFlush();
  if (pendingLines.length >= BATCH_MAX_LINES || pendingChars() >= BATCH_MAX_CHARS) {
    return flushActivityBatch();
  }
  return Promise.resolve(true);
}

function pendingChars() {
  return pendingLines.reduce((sum, line) => sum + line.length + 1, 0);
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushActivityBatch();
  }, BATCH_FLUSH_MS);
}

async function flushActivityBatch() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushInFlight = flushInFlight.then(async () => {
    while (pendingLines.length) {
      const chunk = [];
      let size = 0;
      while (pendingLines.length) {
        const next = pendingLines[0];
        const add = next.length + (chunk.length ? 1 : 0);
        if (chunk.length && (chunk.length >= BATCH_MAX_LINES || size + add > BATCH_MAX_CHARS)) {
          break;
        }
        chunk.push(pendingLines.shift());
        size += add;
      }
      if (!chunk.length) break;
      await sendActivityMessage(chunk.join("\n"));
    }
  }).catch((error) => {
    logger.warn("Steam activity log flush failed", error.message);
  });
  await flushInFlight;
  return true;
}

async function sendActivityMessage(text) {
  const chatId = String(env.steamActivityLogChannelId || "").trim();
  if (!chatId || !telegramApi?.sendMessage) return false;
  const line = String(text || "").trim().slice(0, 3900);
  if (!line) return false;
  try {
    await telegramApi.sendMessage(chatId, line, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
      disable_notification: true,
    });
    return true;
  } catch (error) {
    logger.warn(
      "Steam activity log post failed",
      error?.response?.description || error.message
    );
    return false;
  }
}

/** @deprecated use queue; kept for callers/tests */
async function postActivityLine(text) {
  return queueActivityLine(text);
}

async function resolveWorkerLabel(ownerTelegramId) {
  const tg = String(ownerTelegramId || "").trim();
  if (!tg) return workerRef(null, "");
  try {
    const user = await getUserByTelegramId(tg);
    return workerRef(user, tg);
  } catch (_) {
    return workerRef(null, tg);
  }
}

/**
 * [18:04 24.08] [Новый лог - Воркер] : Тип: <code>#848283</code> · <b>На снятии</b>
 */
async function logNewSteamAccount({ sourceId, ownerTelegramId, accountStatus, account }) {
  const worker = await resolveWorkerLabel(ownerTelegramId);
  const status = bold(escapeHtml(statusLabel(accountStatus || account?.status)));
  const head = `Новый лог - ${worker}`;
  return queueActivityLine(buildLine(formatStamp(), head, withTypeId(sourceId, status)));
}

async function logSteamLogAction({ sourceId, kind, account, totalUsd, detail }) {
  const highlights = accountHighlights(account).map((part) => escapeHtml(part));
  const amount = bold(moneyUsd(totalUsd ?? account?.totalUsd));
  const parts = [];
  if (kind) parts.push(bold(escapeHtml(kind)));
  parts.push(...highlights);
  if (detail) parts.push(escapeHtml(detail));
  else parts.push(amount);
  const head = "Действие с логом";
  return queueActivityLine(buildLine(formatStamp(), head, withTypeId(sourceId, ...parts)));
}

async function logAutoSaleEvent({ sourceId, event, detail }) {
  const head = "Автопродажа";
  const eventHtml = bold(escapeHtml(event || ""));
  const detailHtml = linkifyDetail(stripRubAmounts(detail || ""));
  const parts = [eventHtml, detailHtml].filter(Boolean);
  return queueActivityLine(buildLine(formatStamp(), head, withTypeId(sourceId, ...parts)));
}

async function logWorkerLogAction({ sourceId, action, detail }) {
  const head = "Действие воркера";
  const parts = [bold(escapeHtml(action || "")), linkifyDetail(detail || "")].filter(Boolean);
  return queueActivityLine(buildLine(formatStamp(), head, withTypeId(sourceId, ...parts)));
}

async function logAccountStatusChange({ sourceId, fromStatus, toStatus }) {
  const fromLabel = statusLabel(fromStatus);
  const toLabel = statusLabel(toStatus);
  if (!toLabel || fromLabel === toLabel) return false;
  const head = "Статус лога";
  const statusPart =
    fromLabel && fromLabel !== "—"
      ? `${escapeHtml(fromLabel)} → ${bold(escapeHtml(toLabel))}`
      : bold(escapeHtml(toLabel));
  return queueActivityLine(buildLine(formatStamp(), head, withTypeId(sourceId, statusPart)));
}

async function logMafilePanelStatus({ sourceId, fromStatus, toStatus, amount }) {
  const from = MAFILE_PANEL_LABELS[String(fromStatus || "").toLowerCase()] || String(fromStatus || "");
  const to = MAFILE_PANEL_LABELS[String(toStatus || "").toLowerCase()] || String(toStatus || "");
  if (!to) return false;
  const parts = [];
  if (from && from !== to) {
    parts.push(`${escapeHtml(from)} → ${bold(escapeHtml(to))}`);
  } else {
    parts.push(bold(escapeHtml(to)));
  }
  const amt = Number(amount);
  if ((toStatus === "withdrawn" || toStatus === "sold") && Number.isFinite(amt) && amt > 0) {
    parts.push(bold(moneyUsd(amt)));
  }
  const head = "MaFile";
  return queueActivityLine(buildLine(formatStamp(), head, withTypeId(sourceId, ...parts)));
}

module.exports = {
  bindTelegram,
  formatStamp,
  statusLabel,
  workerRef,
  escapeHtml,
  formatTypeId,
  withTypeId,
  accountHighlights,
  buildLine,
  postActivityLine,
  queueActivityLine,
  flushActivityBatch,
  logNewSteamAccount,
  logSteamLogAction,
  logAutoSaleEvent,
  logWorkerLogAction,
  logAccountStatusChange,
  logMafilePanelStatus,
};
