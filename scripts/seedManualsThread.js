/**
 * Создаёт forum-thread в чате мануалов и шлёт приветственное сообщение со ссылкой.
 *
 * Запуск: node scripts/seedManualsThread.js
 *
 * Бот должен быть админом форума -1003731342806 с правом manage topics + post.
 */
require("dotenv").config();
const { Telegraf } = require("telegraf");
const { env, validateEnv } = require("../src/config/env");
const { seedManualsThread, manualsChatId } = require("../src/services/manualsThreadService");

validateEnv();

async function main() {
  const bot = new Telegraf(env.botToken);
  const chatId = manualsChatId();

  console.log("Bot seeding manuals thread in", chatId);
  try {
    const chat = await bot.telegram.getChat(chatId);
    console.log("Chat ok:", chat.title, "forum=", Boolean(chat.is_forum));
  } catch (e) {
    console.error("Бот не видит чат:", e?.response?.description || e.message);
    console.error("Добавь бота админом в форум", chatId, "и запусти снова.");
    process.exit(1);
  }

  const result = await seedManualsThread(bot.telegram);
  console.log("Done:", JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err?.response?.description || err.message || err);
  process.exit(1);
});
