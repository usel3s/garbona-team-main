#!/usr/bin/env node
"use strict";

/**
 * Отправка тестовых пикч лога/MaFile в Telegram ЛС.
 * node scripts/send-test-log-images.js [chatId] [logId...]
 */

require("dotenv").config();
const { Telegraf, Input } = require("telegraf");
const { connectDatabase } = require("../src/config/db");
const { validateEnv } = require("../src/config/env");
const { getSteamAccounts, getSteamAccountById } = require("../src/services/steamApiService");
const { renderSteamLogImage } = require("../src/utils/steamLogImageRenderer");
const { buildAdminMaFilePhoto } = require("../src/services/steamLogAdminService");
const { classifyAccountLog } = require("../src/services/steamMonitorService");

function unwrapAccount(raw) {
  return raw?.data || raw?.account || raw || null;
}

async function loadAccount(id) {
  try {
    const detailed = unwrapAccount(await getSteamAccountById(null, String(id)));
    if (detailed?.id != null || detailed?.username || detailed?.steamInfo) return detailed;
  } catch (_) {
    /* list fallback below */
  }

  for (let offset = 0; offset < 500; offset += 100) {
    const payload = await getSteamAccounts(null, { offset, limit: 100 });
    const rows = payload?.rows || [];
    const account = rows.find((row) => String(row.id) === String(id));
    if (account) return account;
    if (rows.length < 100) break;
  }
  return null;
}

async function renderAccountImage(account) {
  const kind = classifyAccountLog(account);
  if (kind === "mafile") {
    return { kind, buffer: await buildAdminMaFilePhoto(account, { enrich: true }) };
  }
  return { kind, buffer: await renderSteamLogImage(account) };
}

async function main() {
  validateEnv();
  await connectDatabase();

  const chatId = String(process.argv[2] || "8647494349").trim();
  const ids = process.argv.slice(3).length ? process.argv.slice(3) : ["822308", "822246"];
  const bot = new Telegraf(process.env.BOT_TOKEN);

  for (const id of ids) {
    process.stdout.write(`#${id} ... `);
    const account = await loadAccount(id);
    if (!account) throw new Error(`Account #${id} not found`);
    const { kind, buffer } = await renderAccountImage(account);
    if (!buffer?.length) throw new Error(`Empty image for #${id}`);
    await bot.telegram.sendPhoto(
      chatId,
      Input.fromBuffer(buffer, `${kind}-${id}.png`),
      { caption: `${kind === "mafile" ? "MaFile" : "Log"} #${id}` }
    );
    console.log(`${kind}, ${buffer.length} bytes`);
  }

  console.log(`Sent ${ids.length} image(s) to ${chatId}`);
}

main().catch((error) => {
  console.error(error?.response?.description || error.message || error);
  process.exit(1);
});
