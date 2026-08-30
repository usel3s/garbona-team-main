const User = require("../models/User");
const { sanitizeEntities } = require("./postService");
const { logger } = require("../utils/logger");
const { isIgnorableTelegramError, getTelegramErrorText } = require("../utils/telegramSafe");

const SEND_DELAY_MS = 55;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildBroadcastReplyMarkup(draft) {
  if (!draft?.button?.text || !draft?.button?.url) return undefined;
  return {
    inline_keyboard: [[{ text: draft.button.text, url: draft.button.url }]],
  };
}

function normalizeButtonUrl(raw) {
  let value = String(raw || "").trim();
  if (!value) return null;
  if (value.startsWith("@")) {
    return `https://t.me/${value.slice(1)}`;
  }
  if (/^t\.me\//i.test(value)) {
    return `https://${value}`;
  }
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  return null;
}

/**
 * Получатели рассылки: участники команды, не в бане.
 */
async function getBroadcastRecipients() {
  return User.find({
    isTeamMember: true,
    isBanned: { $ne: true },
  })
    .select("telegramId")
    .lean();
}

function usesHtmlParseMode(draft) {
  const mode = String(draft?.parseMode || draft?.parse_mode || "").toUpperCase();
  return mode === "HTML" || draft?.html === true;
}

/**
 * Отправка одного сообщения по черновику рассылки.
 * HTML: draft.parseMode = "HTML" (как в админ-панели «Коммуникация»).
 * Иначе — Telegram entities из draft.entities (сцена бота).
 */
async function sendBroadcastPayload(telegram, chatId, draft) {
  const reply_markup = buildBroadcastReplyMarkup(draft);
  const text = draft.text || "";
  const html = usesHtmlParseMode(draft);
  const entities = html ? [] : sanitizeEntities(draft.entities || []);
  const mediaOpts = {
    caption: text || undefined,
    reply_markup,
  };
  if (html) {
    mediaOpts.parse_mode = "HTML";
  } else if (entities.length) {
    mediaOpts.caption_entities = entities;
  }

  if (draft.mediaType === "photo" && draft.fileId) {
    return telegram.sendPhoto(chatId, draft.fileId, mediaOpts);
  }
  if (draft.mediaType === "video" && draft.fileId) {
    return telegram.sendVideo(chatId, draft.fileId, mediaOpts);
  }
  if (draft.mediaType === "animation" && draft.fileId) {
    return telegram.sendAnimation(chatId, draft.fileId, mediaOpts);
  }

  const messageOpts = {
    reply_markup,
    link_preview_options: { is_disabled: Boolean(draft.disablePreview) },
  };
  if (html) {
    messageOpts.parse_mode = "HTML";
  } else if (entities.length) {
    messageOpts.entities = entities;
  }

  return telegram.sendMessage(chatId, text || " ", messageOpts);
}

/**
 * Рассылка всем получателям с паузой и подсчётом статистики.
 */
async function runBroadcast(telegram, draft, { onProgress } = {}) {
  const recipients = await getBroadcastRecipients();
  let success = 0;
  let failed = 0;

  for (let i = 0; i < recipients.length; i += 1) {
    const telegramId = recipients[i].telegramId;
    try {
      // eslint-disable-next-line no-await-in-loop
      await sendBroadcastPayload(telegram, telegramId, draft);
      success += 1;
    } catch (error) {
      failed += 1;
      if (!isIgnorableTelegramError(error)) {
        logger.warn(
          "Broadcast send failed",
          telegramId,
          getTelegramErrorText(error)
        );
      }
    }

    if (typeof onProgress === "function" && (i + 1) % 25 === 0) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await onProgress({ success, failed, total: recipients.length, done: i + 1 });
      } catch (_) {
        /* ignore */
      }
    }

    // eslint-disable-next-line no-await-in-loop
    await sleep(SEND_DELAY_MS);
  }

  return {
    total: recipients.length,
    success,
    failed,
  };
}

function extractMediaFromMessage(message) {
  if (!message) return null;
  if (message.photo?.length) {
    const best = message.photo[message.photo.length - 1];
    return { mediaType: "photo", fileId: best.file_id };
  }
  if (message.video) {
    return { mediaType: "video", fileId: message.video.file_id };
  }
  if (message.animation) {
    return { mediaType: "animation", fileId: message.animation.file_id };
  }
  // Некоторые клиенты присылают GIF как document
  const doc = message.document;
  if (doc?.file_id) {
    const mime = String(doc.mime_type || "").toLowerCase();
    if (mime === "image/gif" || mime === "video/mp4") {
      return { mediaType: "animation", fileId: doc.file_id };
    }
  }
  return null;
}

function extractTextDraft(message) {
  if (!message) return null;
  if (message.text != null) {
    return {
      text: message.text,
      entities: sanitizeEntities(message.entities || []),
    };
  }
  if (message.caption != null) {
    return {
      text: message.caption,
      entities: sanitizeEntities(message.caption_entities || []),
    };
  }
  return null;
}

module.exports = {
  SEND_DELAY_MS,
  getBroadcastRecipients,
  buildBroadcastReplyMarkup,
  normalizeButtonUrl,
  sendBroadcastPayload,
  runBroadcast,
  extractMediaFromMessage,
  extractTextDraft,
};
