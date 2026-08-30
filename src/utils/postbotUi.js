const { FALLBACK, E } = require("./emoji");
const {
  draftPreviewLabel,
  sanitizeEntities,
  shiftEntities,
} = require("../services/postService");
const { postbotSettingsKeyboard } = require("../keyboards/postbot");

async function deleteUiMessage(ctx) {
  const chatId = ctx.chat?.id;
  if (!chatId || !ctx.session) return;

  const ids = new Set();
  if (ctx.session.ui?.messageId) ids.add(ctx.session.ui.messageId);
  if (ctx.callbackQuery?.message?.message_id) {
    ids.add(ctx.callbackQuery.message.message_id);
  }

  for (const id of ids) {
    try {
      await ctx.telegram.deleteMessage(chatId, id);
    } catch (_) {
      /* ignore */
    }
  }
  ctx.session.ui = { ...(ctx.session.ui || {}), messageId: null };
}

async function sendUiMessage(ctx, text, extra = {}) {
  await deleteUiMessage(ctx);
  const sent = await ctx.reply(text, { parse_mode: "HTML", ...extra });
  ctx.session.ui = { ...(ctx.session.ui || {}), messageId: sent.message_id };
  return sent.message_id;
}

function pushCustomEmoji(parts, entities, key) {
  const fb = (FALLBACK && FALLBACK[key]) || "•";
  const id = E && E[key];
  if (id) {
    entities.push({
      type: "custom_emoji",
      offset: parts.join("").length,
      length: fb.length,
      custom_emoji_id: id,
    });
  }
  parts.push(fb);
}

function pushBold(parts, entities, text) {
  const offset = parts.join("").length;
  entities.push({ type: "bold", offset, length: text.length });
  parts.push(text);
}

/**
 * Заголовок настроек + превью пользователя с сохранением entities.
 */
function buildSettingsTextWithEntities(draft) {
  const btnCount = (draft.buttons || []).reduce((n, row) => n + row.length, 0);
  const previewOn = draft.linkPreview !== false;
  const parts = [];
  const entities = [];

  pushCustomEmoji(parts, entities, "settings");
  parts.push(" ");
  pushBold(parts, entities, "Настройка поста");
  parts.push("\n\nИспользуй меню ниже.\n\n");

  pushCustomEmoji(parts, entities, "link");
  parts.push(" Кнопок: ");
  pushBold(parts, entities, String(btnCount));
  parts.push("\n");

  pushCustomEmoji(parts, entities, previewOn ? "visible" : "hidden");
  parts.push(" Превью ссылок: ");
  pushBold(parts, entities, previewOn ? "вкл" : "выкл");
  parts.push("\n\n");

  pushCustomEmoji(parts, entities, "visible");
  parts.push(" ");
  pushBold(parts, entities, "Предпросмотр:");
  parts.push("\n");

  const header = parts.join("");
  const userText = draft.text || "";
  const emptyHint = "(пустой текст)";
  const body = userText || emptyHint;

  const allEntities = [...entities];
  if (userText && draft.entities?.length) {
    allEntities.push(...shiftEntities(draft.entities, header.length));
  } else if (!userText) {
    allEntities.push({
      type: "italic",
      offset: header.length,
      length: emptyHint.length,
    });
  }

  return {
    text: header + body,
    entities: allEntities,
  };
}

/**
 * Показывает настройки + превью контента одним сообщением (entities сохраняются).
 */
async function renderPostSettings(ctx, draft) {
  const previewOn = draft.linkPreview !== false;
  const keyboard = postbotSettingsKeyboard(draft).reply_markup;

  if (draft.contentType === "text") {
    const { text, entities } = buildSettingsTextWithEntities(draft);
    await deleteUiMessage(ctx);
    const sent = await ctx.reply(text, {
      entities: sanitizeEntities(entities),
      link_preview_options: { is_disabled: !previewOn },
      reply_markup: keyboard,
    });
    ctx.session.ui = { ...(ctx.session.ui || {}), messageId: sent.message_id };
    return;
  }

  // Медиа: оригинал caption + entities, статус в кнопках меню
  await deleteUiMessage(ctx);
  const caption = draft.text || undefined;
  const caption_entities = sanitizeEntities(draft.entities || []);
  const extra = {
    caption,
    caption_entities: caption_entities.length ? caption_entities : undefined,
    reply_markup: keyboard,
  };

  let sent;
  try {
    if (draft.contentType === "photo") {
      sent = await ctx.replyWithPhoto(draft.fileId, extra);
    } else if (draft.contentType === "video") {
      sent = await ctx.replyWithVideo(draft.fileId, extra);
    } else if (draft.contentType === "animation") {
      sent = await ctx.replyWithAnimation(draft.fileId, extra);
    } else if (draft.contentType === "audio") {
      sent = await ctx.replyWithAudio(draft.fileId, extra);
    } else if (draft.contentType === "document") {
      sent = await ctx.replyWithDocument(draft.fileId, extra);
    } else {
      sent = await ctx.reply(draftPreviewLabel(draft), { reply_markup: keyboard });
    }
  } catch (_) {
    const { text, entities } = buildSettingsTextWithEntities({
      ...draft,
      contentType: "text",
      text: draftPreviewLabel(draft),
      entities: [],
    });
    sent = await ctx.reply(text, {
      entities: sanitizeEntities(entities),
      reply_markup: keyboard,
    });
  }

  ctx.session.ui = { ...(ctx.session.ui || {}), messageId: sent.message_id };
}

module.exports = {
  deleteUiMessage,
  sendUiMessage,
  renderPostSettings,
};
