const crypto = require("crypto");
const SavedPost = require("../models/SavedPost");

function generatePostCode() {
  return crypto.randomBytes(8).toString("hex");
}

const COLOR_MAP = {
  зелёный: "success",
  зеленый: "success",
  green: "success",
  success: "success",
  синий: "primary",
  blue: "primary",
  primary: "primary",
  красный: "danger",
  red: "danger",
  danger: "danger",
};

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
  if (/^[a-zA-Z0-9_]{4,}$/.test(value)) {
    return `https://t.me/${value}`;
  }
  return null;
}

/**
 * Парсит текст кнопок:
 * новая строка = ряд, | = кнопки в ряд,
 * формат: Текст — url — цвет
 */
function parseButtonsInput(raw) {
  const lines = String(raw || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (!lines.length) {
    return { error: "Отправьте хотя бы одну кнопку." };
  }

  const rows = [];
  for (const line of lines) {
    const parts = line.split("|").map((p) => p.trim()).filter(Boolean);
    const row = [];
    for (const part of parts) {
      const chunks = part
        .split(/\s*[—–−-]\s*/)
        .map((c) => c.trim())
        .filter(Boolean);
      if (chunks.length < 2) {
        return {
          error: `Не удалось разобрать кнопку: <code>${escapeHtml(part)}</code>\nФормат: Текст — ссылка — цвет`,
        };
      }

      let style = "";
      const maybeColor = chunks[chunks.length - 1].toLowerCase();
      if (COLOR_MAP[maybeColor]) {
        style = COLOR_MAP[maybeColor];
        chunks.pop();
      }
      if (chunks.length < 2) {
        return {
          error: `Укажите текст и ссылку: <code>${escapeHtml(part)}</code>`,
        };
      }

      const urlRaw = chunks.pop();
      const text = chunks.join(" — ").trim();
      const url = normalizeButtonUrl(urlRaw);
      if (!text || !url) {
        return {
          error: `Некорректная кнопка: <code>${escapeHtml(part)}</code>`,
        };
      }
      if (text.length > 64) {
        return { error: "Текст кнопки — максимум 64 символа." };
      }
      row.push({ text, url, style });
    }
    if (row.length) rows.push(row);
  }

  if (!rows.length) {
    return { error: "Не удалось распознать кнопки." };
  }
  return { rows };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Нормализует MessageEntity для API / Mongo (без лишних полей). */
function sanitizeEntities(entities = []) {
  if (!Array.isArray(entities) || !entities.length) return [];
  return entities
    .map((e) => {
      if (!e || typeof e.offset !== "number" || typeof e.length !== "number" || !e.type) {
        return null;
      }
      const out = {
        type: e.type,
        offset: e.offset,
        length: e.length,
      };
      if (e.url) out.url = e.url;
      if (e.language) out.language = e.language;
      if (e.custom_emoji_id) out.custom_emoji_id = String(e.custom_emoji_id);
      if (e.user?.id) out.user = { id: e.user.id };
      return out;
    })
    .filter(Boolean);
}

function shiftEntities(entities, delta) {
  if (!delta) return sanitizeEntities(entities);
  return sanitizeEntities(entities).map((e) => ({
    ...e,
    offset: e.offset + delta,
  }));
}

function buttonsToTelegramMarkup(buttonRows = []) {
  return {
    inline_keyboard: (buttonRows || []).map((row) =>
      row.map((b) => {
        const btn = { text: b.text, url: b.url };
        if (b.style) btn.style = b.style;
        return btn;
      })
    ),
  };
}

function extractContentFromMessage(message) {
  if (!message) return null;

  if (message.photo?.length) {
    const best = message.photo[message.photo.length - 1];
    return {
      contentType: "photo",
      fileId: best.file_id,
      text: message.caption || "",
      entities: sanitizeEntities(message.caption_entities || []),
    };
  }
  if (message.video) {
    return {
      contentType: "video",
      fileId: message.video.file_id,
      text: message.caption || "",
      entities: sanitizeEntities(message.caption_entities || []),
    };
  }
  if (message.animation) {
    return {
      contentType: "animation",
      fileId: message.animation.file_id,
      text: message.caption || "",
      entities: sanitizeEntities(message.caption_entities || []),
    };
  }
  if (message.audio) {
    return {
      contentType: "audio",
      fileId: message.audio.file_id,
      text: message.caption || "",
      entities: sanitizeEntities(message.caption_entities || []),
    };
  }
  if (message.document) {
    return {
      contentType: "document",
      fileId: message.document.file_id,
      text: message.caption || "",
      entities: sanitizeEntities(message.caption_entities || []),
    };
  }
  if (message.text != null) {
    return {
      contentType: "text",
      fileId: "",
      text: message.text,
      entities: sanitizeEntities(message.entities || []),
    };
  }
  return null;
}

function draftPreviewLabel(draft) {
  if (!draft) return "пусто";
  if (draft.contentType === "text") {
    const t = (draft.text || "").replace(/\s+/g, " ").trim();
    return t ? t.slice(0, 120) : "(пустой текст)";
  }
  const map = {
    photo: "фото",
    video: "видео",
    animation: "GIF",
    audio: "аудио",
    document: "документ",
  };
  const cap = (draft.text || "").replace(/\s+/g, " ").trim();
  return `${map[draft.contentType] || draft.contentType}${cap ? `: ${cap.slice(0, 80)}` : ""}`;
}

async function savePostFromDraft(draft, { name, createdByTelegramId }) {
  let code = generatePostCode();
  for (let i = 0; i < 5; i += 1) {
    const exists = await SavedPost.exists({ code });
    if (!exists) break;
    code = generatePostCode();
  }

  const safeName = String(name || "").trim().slice(0, 50);
  return SavedPost.create({
    code,
    name: safeName || `Пост ${new Date().toLocaleString("ru-RU")}`,
    contentType: draft.contentType,
    text: draft.text || "",
    entities: sanitizeEntities(draft.entities || []),
    fileId: draft.fileId || "",
    buttons: draft.buttons || [],
    linkPreview: draft.linkPreview !== false,
    createdByTelegramId: String(createdByTelegramId),
  });
}

async function listSavedPosts(limit = 20, skip = 0) {
  return SavedPost.find()
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
}

async function countSavedPosts() {
  return SavedPost.countDocuments();
}

async function getPostByCode(code) {
  return SavedPost.findOne({ code: String(code) }).lean();
}

async function getPostById(id) {
  return SavedPost.findById(id).lean();
}

async function deletePostById(id) {
  return SavedPost.findByIdAndDelete(id);
}

function buildInlineResult(post) {
  const id = String(post.code);
  const title = post.name || `Пост ${post.code}`;
  const reply_markup =
    post.buttons?.length > 0 ? buttonsToTelegramMarkup(post.buttons) : undefined;
  const entities = sanitizeEntities(post.entities || []);

  const base = { id, title, reply_markup };

  if (post.contentType === "text") {
    return {
      type: "article",
      ...base,
      description: (post.text || "").slice(0, 100) || "Текстовый пост",
      input_message_content: {
        message_text: post.text || " ",
        entities: entities.length ? entities : undefined,
        link_preview_options: { is_disabled: !post.linkPreview },
      },
    };
  }

  const caption = post.text || undefined;
  const caption_entities = entities.length ? entities : undefined;

  if (post.contentType === "photo") {
    return {
      type: "photo",
      ...base,
      photo_file_id: post.fileId,
      caption,
      caption_entities,
    };
  }
  if (post.contentType === "video") {
    return {
      type: "video",
      ...base,
      video_file_id: post.fileId,
      caption,
      caption_entities,
    };
  }
  if (post.contentType === "animation") {
    return {
      type: "mpeg4_gif",
      ...base,
      mpeg4_file_id: post.fileId,
      caption,
      caption_entities,
    };
  }
  if (post.contentType === "audio") {
    return {
      type: "audio",
      ...base,
      audio_file_id: post.fileId,
      caption,
      caption_entities,
    };
  }
  if (post.contentType === "document") {
    return {
      type: "document",
      ...base,
      document_file_id: post.fileId,
      caption,
      caption_entities,
      description: title,
    };
  }
  return null;
}

/**
 * Отправка сохранённого поста от имени бота в указанный чат.
 */
async function sendSavedPost(telegram, chatId, post) {
  const reply_markup =
    post.buttons?.length > 0 ? buttonsToTelegramMarkup(post.buttons) : undefined;
  const entities = sanitizeEntities(post.entities || []);
  const text = post.text || "";
  const caption = text || undefined;
  const caption_entities = entities.length ? entities : undefined;

  if (post.contentType === "photo" && post.fileId) {
    return telegram.sendPhoto(chatId, post.fileId, {
      caption,
      caption_entities,
      reply_markup,
    });
  }
  if (post.contentType === "video" && post.fileId) {
    return telegram.sendVideo(chatId, post.fileId, {
      caption,
      caption_entities,
      reply_markup,
    });
  }
  if (post.contentType === "animation" && post.fileId) {
    return telegram.sendAnimation(chatId, post.fileId, {
      caption,
      caption_entities,
      reply_markup,
    });
  }
  if (post.contentType === "audio" && post.fileId) {
    return telegram.sendAudio(chatId, post.fileId, {
      caption,
      caption_entities,
      reply_markup,
    });
  }
  if (post.contentType === "document" && post.fileId) {
    return telegram.sendDocument(chatId, post.fileId, {
      caption,
      caption_entities,
      reply_markup,
    });
  }

  return telegram.sendMessage(chatId, text || " ", {
    entities: entities.length ? entities : undefined,
    reply_markup,
    link_preview_options: { is_disabled: post.linkPreview === false },
  });
}

/**
 * Извлекает chat_id из пересланного сообщения или прямого chat id / @username.
 */
function resolveTargetChatId(message) {
  if (!message) return null;

  // Telegram Bot API 7+: forward_origin
  const origin = message.forward_origin;
  if (origin) {
    if (origin.type === "channel" && origin.chat?.id) return origin.chat.id;
    if (origin.type === "chat" && origin.sender_chat?.id) return origin.sender_chat.id;
  }

  if (message.forward_from_chat?.id) return message.forward_from_chat.id;
  if (message.sender_chat?.id && message.sender_chat.id !== message.chat?.id) {
    return message.sender_chat.id;
  }

  const raw = String(message.text || "").trim();
  if (/^-?\d+$/.test(raw)) return raw;
  if (raw.startsWith("@") && raw.length > 1) return raw;

  return null;
}

module.exports = {
  generatePostCode,
  parseButtonsInput,
  buttonsToTelegramMarkup,
  extractContentFromMessage,
  draftPreviewLabel,
  savePostFromDraft,
  listSavedPosts,
  countSavedPosts,
  getPostByCode,
  getPostById,
  deletePostById,
  buildInlineResult,
  sendSavedPost,
  resolveTargetChatId,
  escapeHtml,
  sanitizeEntities,
  shiftEntities,
};
