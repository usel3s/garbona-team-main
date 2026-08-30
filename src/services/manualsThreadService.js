const { Markup } = require("telegraf");
const { env } = require("../config/env");
const { pe, urlBtn } = require("../utils/emoji");
const { logger } = require("../utils/logger");
const { docsSiteUrl } = require("../utils/panelLinks");

function manualsChatId() {
  return env.aboutManualsChatId || "-1003731342806";
}

function manualsDocsUrl() {
  return docsSiteUrl();
}

function chatDeepLink(chatId, threadId) {
  const raw = String(chatId).replace("-100", "");
  return `https://t.me/c/${raw}/${threadId}`;
}

function buildWelcomeHtml(_threadLink, docsUrl) {
  return [
    `${pe("file")} <b>Документация Garbona</b>`,
    "",
    "Этот служебный тред сохранён для совместимости с прежней инфраструктурой.",
    "Руководства не публикуются в Telegram.",
    "",
    `${pe("link")} <b>Единственный источник руководств</b>`,
    `<a href="${docsUrl}">${String(docsUrl).replace(/^https?:\/\//, "")}</a>`,
    "",
    `${pe("info")} Вопросы можно направить администратору, но ответы в переписке не заменяют актуальную редакцию на сайте.`,
  ].join("\n");
}

async function seedManualsThread(telegram, options = {}) {
  const chatId = options.chatId || manualsChatId();
  const docsUrl = docsSiteUrl(options.docsUrl || manualsDocsUrl());
  const topicName = options.topicName || "Документация Garbona";

  const topic = await telegram.createForumTopic(chatId, topicName, {
    icon_color: 0x6fb9f0,
  });
  const threadId = topic.message_thread_id;
  const threadLink = chatDeepLink(chatId, threadId);
  const text = buildWelcomeHtml(threadLink, docsUrl);

  const keyboard = Markup.inlineKeyboard([
    [urlBtn("Открыть документацию", docsUrl, "file")],
  ]);

  const sent = await telegram.sendMessage(chatId, text, {
    message_thread_id: threadId,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: keyboard.reply_markup,
  });

  let pinned = false;
  try {
    await telegram.pinChatMessage(chatId, sent.message_id, {
      disable_notification: true,
    });
    pinned = true;
  } catch (e) {
    logger.warn("manuals thread pin skipped", e?.response?.description || e.message);
  }

  return {
    chatId,
    threadId,
    threadLink,
    docsUrl,
    messageId: sent.message_id,
    pinned,
  };
}

module.exports = {
  manualsChatId,
  manualsDocsUrl,
  seedManualsThread,
  buildWelcomeHtml,
  chatDeepLink,
};
