const axios = require("axios");
const mongoose = require("mongoose");
const { EmbedBuilder } = require("discord.js");
const { env } = require("../config/env");
const { logger } = require("../utils/logger");
const { ACCENT } = require("./components");
const { emojiMarkdown } = require("./emojis");
const AppSettings = require("../models/AppSettings");

const MESSAGE_KEY = "discord_status_message_id";
const CHANNEL_KEY = "discord_status_channel_id";
const DEFAULT_INTERVAL_MS = 60_000;

let timer = null;
let running = false;

function statusDot(kind) {
  if (kind === "online") return emojiMarkdown("status_online") || "🟢";
  if (kind === "idle") return emojiMarkdown("status_idle") || "⚪";
  return emojiMarkdown("status_offline") || "🔴";
}

function msLabel(ms) {
  if (ms == null || !Number.isFinite(ms)) return "—";
  return `${Math.max(0, Math.round(ms))}ms`;
}

function kindFromMs(ms, warnAt = 800, badAt = 2500) {
  if (ms == null || !Number.isFinite(ms)) return "offline";
  if (ms >= badAt) return "idle";
  if (ms >= warnAt) return "idle";
  return "online";
}

async function timed(fn) {
  const started = Date.now();
  try {
    await fn();
    return { ok: true, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, ms: Date.now() - started, error: error.message };
  }
}

async function probeHttp(url, timeoutMs = 4000) {
  return timed(async () => {
    await axios.get(url, {
      timeout: timeoutMs,
      validateStatus: (s) => s >= 200 && s < 500,
      maxRedirects: 3,
      headers: { Accept: "*/*" },
    });
  });
}

async function collectMetrics(client) {
  const port = Number(env.panelPort) || 3000;
  const localBase = `http://127.0.0.1:${port}`;

  const [panel, api, db, tg, cmds] = await Promise.all([
    probeHttp(`${localBase}/`),
    probeHttp(`${localBase}/healthz`),
    timed(async () => {
      if (mongoose.connection.readyState !== 1) throw new Error("mongo_disconnected");
      await mongoose.connection.db.admin().command({ ping: 1 });
    }),
    timed(async () => {
      const token = String(env.botToken || "").trim();
      if (!token) throw new Error("no_bot_token");
      const { data } = await axios.get(`https://api.telegram.org/bot${token}/getMe`, {
        timeout: 5000,
      });
      if (!data?.ok) throw new Error("telegram_bad_response");
    }),
    timed(async () => {
      await client.rest.get("/users/@me");
    }),
  ]);

  const discordPing = Number(client.ws?.ping);
  const discordOk = client.isReady() && Number.isFinite(discordPing) && discordPing >= 0;

  return {
    panel,
    api,
    db,
    telegram: tg,
    commands: cmds,
    discord: {
      ok: discordOk,
      ms: discordOk ? discordPing : null,
    },
    checkedAt: Date.now(),
  };
}

function serviceLine(label, probe, { usePing = false } = {}) {
  const ok = Boolean(probe?.ok);
  const kind = ok ? kindFromMs(probe.ms) : "offline";
  const dot = statusDot(ok ? (kind === "idle" ? "idle" : "online") : "offline");
  const state = ok ? (kind === "idle" ? "Замедлен" : "Online") : "Offline";
  const ping = usePing && ok ? ` · \`${msLabel(probe.ms)}\`` : "";
  return `${dot} **${label}** — ${state}${ping}`;
}

function buildStatusEmbed(metrics) {
  const allOk = [metrics.panel, metrics.api, metrics.db, metrics.telegram, metrics.discord].every(
    (x) => x?.ok
  );
  const anyBad = [metrics.panel, metrics.api, metrics.db, metrics.telegram, metrics.discord].some(
    (x) => !x?.ok
  );

  const color = anyBad ? 0xed4245 : allOk ? 0x57f287 : ACCENT.discord;
  const headerDot = statusDot(anyBad ? "offline" : "online");

  const services = [
    serviceLine("Панель", metrics.panel),
    serviceLine("API", metrics.api),
    serviceLine("Discord бот", metrics.discord, { usePing: true }),
    serviceLine("Telegram бот", metrics.telegram, { usePing: true }),
  ].join("\n");

  const metricsBlock = [
    `・Задержка: \`${msLabel(metrics.discord.ms)}\``,
    `・Обработка команд: \`${msLabel(metrics.commands.ms)}\``,
    `・База данных: \`${msLabel(metrics.db.ms)}\``,
  ].join("\n");

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`${headerDot} Статус Garbona`)
    .setDescription(
      [
        "Актуальное состояние сервисов команды.",
        "",
        "**Сервисы**",
        services,
        "",
        "**Метрики**",
        metricsBlock,
      ].join("\n")
    )
    .setFooter({ text: "Обновляется автоматически" })
    .setTimestamp(metrics.checkedAt);
}

async function getStoredMessageId() {
  const row = await AppSettings.findOne({ key: MESSAGE_KEY }).lean();
  const id = String(row?.valueString || "").trim();
  return id || null;
}

async function storeMessageId(messageId) {
  await AppSettings.findOneAndUpdate(
    { key: MESSAGE_KEY },
    { $set: { valueString: String(messageId), valueNumber: null } },
    { upsert: true }
  );
  await AppSettings.findOneAndUpdate(
    { key: CHANNEL_KEY },
    { $set: { valueString: String(env.discordStatusChannelId || ""), valueNumber: null } },
    { upsert: true }
  );
}

async function publishStatus(client) {
  const channelId = String(env.discordStatusChannelId || "").trim();
  if (!channelId || !client?.isReady?.()) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased?.()) {
    logger.warn("Discord status channel missing", channelId);
    return;
  }

  const metrics = await collectMetrics(client);
  const embed = buildStatusEmbed(metrics);
  const payload = { embeds: [embed] };

  const storedId = await getStoredMessageId();
  if (storedId) {
    try {
      const msg = await channel.messages.fetch(storedId);
      await msg.edit(payload);
      return;
    } catch (_) {
      /* recreate below */
    }
  }

  const sent = await channel.send(payload);
  await storeMessageId(sent.id);
}

async function refreshStatus(client) {
  if (running) return;
  running = true;
  try {
    await publishStatus(client);
  } catch (error) {
    logger.warn("Discord status board failed", error.message);
  } finally {
    running = false;
  }
}

function startStatusBoard(client) {
  const channelId = String(env.discordStatusChannelId || "").trim();
  if (!channelId) {
    logger.info("Discord status board skipped (DISCORD_STATUS_CHANNEL_ID empty)");
    return;
  }
  stopStatusBoard();
  const interval = Math.max(
    30_000,
    Number(env.discordStatusIntervalMs) || DEFAULT_INTERVAL_MS
  );
  void refreshStatus(client);
  timer = setInterval(() => {
    void refreshStatus(client);
  }, interval);
  if (typeof timer.unref === "function") timer.unref();
  logger.info(`Discord status board started channel=${channelId} interval=${interval}ms`);
}

function stopStatusBoard() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = {
  startStatusBoard,
  stopStatusBoard,
  refreshStatus,
  collectMetrics,
  buildStatusEmbed,
};
