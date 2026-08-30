#!/usr/bin/env node
"use strict";

/**
 * Демо сообщений об одобренной выплате в Telegram ЛС.
 * node scripts/demo-payout-messages.js [chatId]
 */

require("dotenv").config();
const { Telegraf } = require("telegraf");
const { validateEnv } = require("../src/config/env");
const {
  buildUserPayoutApprovedMessage,
  payoutApprovedUserKeyboard,
} = require("../src/services/withdrawalService");

const chatId = process.argv[2] || "8647494349";

const demos = [
  {
    title: "CryptoBot",
    method: "cryptobot",
    amountUsd: 50,
    networkFee: 0,
    url: "https://t.me/CryptoBot?start=check_demo_cryptobot",
  },
  {
    title: "xRocket",
    method: "xRocketr",
    amountUsd: 75,
    networkFee: 0,
    url: "https://t.me/xRocket?start=check_demo_xrocket",
  },
  {
    title: "USDT TRC20",
    method: "usdt_trc20",
    amountUsd: 100,
    networkFee: 1,
    url: "https://tronscan.org/#/transaction/demo-trc20-tx",
  },
];

async function main() {
  validateEnv();
  const bot = new Telegraf(process.env.BOT_TOKEN);

  for (const demo of demos) {
    const payoutAmount = Number((demo.amountUsd - demo.networkFee).toFixed(2));
    const request = {
      method: demo.method,
      amountUsd: demo.amountUsd,
    };
    const text = [
      `🧪 <b>Демо: ${demo.title}</b>`,
      "",
      buildUserPayoutApprovedMessage(request),
    ].join("\n");

    await bot.telegram.sendMessage(chatId, text, {
      parse_mode: "HTML",
      reply_markup: payoutApprovedUserKeyboard(demo.url, demo.method).reply_markup,
    });
    console.log(`Sent ${demo.title} → ${chatId} (payout $${payoutAmount})`);
    await new Promise((r) => setTimeout(r, 800));
  }

  console.log("Done.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
