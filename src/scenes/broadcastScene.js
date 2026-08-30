const { Scenes } = require("telegraf");
const { pe } = require("../utils/emoji");
const { isAdminTelegramId } = require("../services/userService");
const {
  getGlobalWorkerPercent,
  getDisplayCurrency,
  getUsdRubRate,
} = require("../services/settingsService");
const {
  extractTextDraft,
  extractMediaFromMessage,
  normalizeButtonUrl,
  sendBroadcastPayload,
  runBroadcast,
} = require("../services/broadcastService");
const {
  broadcastCancelKeyboard,
  broadcastSkipMediaKeyboard,
  broadcastButtonChoiceKeyboard,
  broadcastConfirmKeyboard,
  broadcastDoneKeyboard,
} = require("../keyboards/broadcast");
const { adminPanelKeyboard } = require("../keyboards/admin");
const { upsertBotMessage } = require("../utils/message");
const { logger } = require("../utils/logger");
const { isBotCommandText } = require("../utils/session");

function emptyDraft() {
  return {
    text: "",
    entities: [],
    mediaType: null,
    fileId: "",
    button: null,
  };
}

function getDraft(ctx) {
  if (!ctx.scene.session.draft) {
    ctx.scene.session.draft = emptyDraft();
  }
  return ctx.scene.session.draft;
}

function setStep(ctx, step) {
  ctx.scene.session.step = step;
}

function getStep(ctx) {
  return ctx.scene.session.step || "await_text";
}

async function tryDeleteUserMessage(ctx) {
  try {
    if (ctx.message?.message_id) {
      await ctx.deleteMessage(ctx.message.message_id);
    }
  } catch (_) {
    /* ignore */
  }
}

async function deleteTracked(ctx, key) {
  const id = ctx.scene.session?.[key];
  if (!id || !ctx.chat?.id) return;
  try {
    await ctx.telegram.deleteMessage(ctx.chat.id, id);
  } catch (_) {
    /* ignore */
  }
  ctx.scene.session[key] = null;
}

async function deleteUiAndPreview(ctx) {
  await deleteTracked(ctx, "uiMessageId");
  await deleteTracked(ctx, "previewMessageId");
  if (ctx.callbackQuery?.message?.message_id) {
    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, ctx.callbackQuery.message.message_id);
    } catch (_) {
      /* ignore */
    }
  }
  if (ctx.session?.ui) {
    ctx.session.ui.messageId = null;
  }
}

async function sendUi(ctx, text, extra = {}) {
  await deleteTracked(ctx, "uiMessageId");
  if (ctx.callbackQuery?.message?.message_id) {
    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, ctx.callbackQuery.message.message_id);
    } catch (_) {
      /* ignore */
    }
  }
  const sent = await ctx.reply(text, { parse_mode: "HTML", ...extra });
  ctx.scene.session.uiMessageId = sent.message_id;
  if (ctx.session) {
    ctx.session.ui = { ...(ctx.session.ui || {}), messageId: sent.message_id };
  }
  return sent.message_id;
}

async function leaveToAdmin(ctx) {
  ctx.scene.session.draft = null;
  ctx.scene.session.step = null;
  ctx.scene.session.uiMessageId = null;
  ctx.scene.session.previewMessageId = null;
  try {
    await ctx.scene.leave();
  } catch (_) {
    /* ignore */
  }
}

async function showTextStep(ctx) {
  setStep(ctx, "await_text");
  ctx.scene.session.draft = emptyDraft();
  await sendUi(
    ctx,
    [
      `${pe("broadcast")} <b>Рассылка</b>`,
      "",
      "Шаг 1/3. Отправь <b>текст</b> сообщения.",
      "Форматирование (жирный, ссылки, спойлеры, эмодзи) сохранится.",
    ].join("\n"),
    { reply_markup: broadcastCancelKeyboard().reply_markup }
  );
}

async function showMediaStep(ctx) {
  setStep(ctx, "await_media");
  await sendUi(
    ctx,
    [
      `${pe("attachment")} <b>Медиа</b>`,
      "",
      "Шаг 2/3. Пришли фото, видео или GIF.",
      "Или нажми «Пропустить».",
    ].join("\n"),
    { reply_markup: broadcastSkipMediaKeyboard().reply_markup }
  );
}

async function showButtonChoice(ctx) {
  setStep(ctx, "await_button_choice");
  await sendUi(
    ctx,
    [
      `${pe("link")} <b>Кнопка</b>`,
      "",
      "Шаг 3/3. Добавить Inline-кнопку со ссылкой?",
    ].join("\n"),
    { reply_markup: broadcastButtonChoiceKeyboard().reply_markup }
  );
}

async function showButtonTextStep(ctx) {
  setStep(ctx, "await_button_text");
  await sendUi(
    ctx,
    `${pe("edit")} Отправь <b>текст кнопки</b> (до 64 символов).`,
    { reply_markup: broadcastCancelKeyboard().reply_markup }
  );
}

async function showButtonUrlStep(ctx) {
  setStep(ctx, "await_button_url");
  await sendUi(
    ctx,
    [
      `${pe("link")} Отправь <b>URL</b> для кнопки.`,
      "Пример: <code>https://t.me/channel</code> или <code>@username</code>",
    ].join("\n"),
    { reply_markup: broadcastCancelKeyboard().reply_markup }
  );
}

async function showPreview(ctx) {
  setStep(ctx, "preview");
  const draft = getDraft(ctx);

  await deleteTracked(ctx, "uiMessageId");
  await deleteTracked(ctx, "previewMessageId");

  try {
    const preview = await sendBroadcastPayload(ctx.telegram, ctx.chat.id, draft);
    ctx.scene.session.previewMessageId = preview.message_id;
  } catch (error) {
    logger.error("Broadcast preview failed", error);
    await sendUi(
      ctx,
      `${pe("error")} Не удалось показать предпросмотр: ${error.message}`,
      { reply_markup: broadcastCancelKeyboard().reply_markup }
    );
    return;
  }

  const control = await ctx.reply(
    [
      `${pe("visible")} <b>Предпросмотр выше</b>`,
      "",
      "Так сообщение увидят получатели.",
      "Отправить рассылку?",
    ].join("\n"),
    {
      parse_mode: "HTML",
      reply_markup: broadcastConfirmKeyboard().reply_markup,
    }
  );
  ctx.scene.session.uiMessageId = control.message_id;
  if (ctx.session) {
    ctx.session.ui = { ...(ctx.session.ui || {}), messageId: control.message_id };
  }
}

const scene = new Scenes.BaseScene("broadcastScene");

scene.enter(async (ctx) => {
  if (!isAdminTelegramId(ctx.from.id)) {
    await ctx.reply(`${pe("error")} Недостаточно прав.`);
    return ctx.scene.leave();
  }
  await showTextStep(ctx);
});

scene.action("broadcast:cancel", async (ctx) => {
  if (getStep(ctx) === "sending") {
    await ctx.answerCbQuery("Рассылка уже идёт", { show_alert: true });
    return;
  }
  await ctx.answerCbQuery("Отменено");
  await deleteUiAndPreview(ctx);
  await leaveToAdmin(ctx);

  const [globalPercent, currency, rate] = await Promise.all([
    getGlobalWorkerPercent(),
    getDisplayCurrency("USD"),
    getUsdRubRate(90),
  ]);
  const currencyLabel = currency === "RUB" ? "₽ RUB" : "$ USD";
  await upsertBotMessage(
    ctx,
    [
      `${pe("code")} <b>Админ-панель</b>`,
      "",
      `<i>${currencyLabel} · курс ${rate} · ${globalPercent}%</i>`,
    ].join("\n"),
    { reply_markup: adminPanelKeyboard().reply_markup }
  );
});

scene.action("broadcast:skip_media", async (ctx) => {
  await ctx.answerCbQuery();
  const draft = getDraft(ctx);
  draft.mediaType = null;
  draft.fileId = "";
  await showButtonChoice(ctx);
});

scene.action("broadcast:add_button", async (ctx) => {
  await ctx.answerCbQuery();
  await showButtonTextStep(ctx);
});

scene.action("broadcast:skip_button", async (ctx) => {
  await ctx.answerCbQuery();
  const draft = getDraft(ctx);
  draft.button = null;
  await showPreview(ctx);
});

scene.action("broadcast:send", async (ctx) => {
  if (!isAdminTelegramId(ctx.from.id)) {
    await ctx.answerCbQuery("Недостаточно прав", { show_alert: true });
    return;
  }
  await ctx.answerCbQuery();

  const draft = getDraft(ctx);
  setStep(ctx, "sending");

  await deleteTracked(ctx, "previewMessageId");

  const statusText = `${pe("loading")} <b>Рассылка началась…</b>\nОтправляю сообщения получателям.`;
  try {
    await ctx.editMessageText(statusText, { parse_mode: "HTML" });
    if (ctx.callbackQuery?.message?.message_id) {
      ctx.scene.session.uiMessageId = ctx.callbackQuery.message.message_id;
    }
  } catch (_) {
    await sendUi(ctx, statusText);
  }

  // Снимок черновика — сессия может измениться во время долгой отправки
  const payload = {
    text: draft.text || "",
    entities: Array.isArray(draft.entities) ? [...draft.entities] : [],
    mediaType: draft.mediaType || null,
    fileId: draft.fileId || "",
    button: draft.button
      ? { text: draft.button.text, url: draft.button.url }
      : null,
  };

  let stats;
  try {
    stats = await runBroadcast(ctx.telegram, payload);
  } catch (error) {
    logger.error("Broadcast failed", error);
    await sendUi(
      ctx,
      `${pe("error")} Рассылка прервалась: ${error.message}`,
      { reply_markup: broadcastDoneKeyboard().reply_markup }
    );
    await leaveToAdmin(ctx);
    return;
  }

  const summary = [
    `${pe("celebrate")} <b>Рассылка завершена</b>`,
    "",
    `${pe("success")} Успешно: <b>${stats.success}</b>`,
    `${pe("error")} Ошибок: <b>${stats.failed}</b>`,
    `${pe("users")} Всего получателей: <b>${stats.total}</b>`,
  ].join("\n");

  try {
    await ctx.telegram.editMessageText(ctx.chat.id, ctx.scene.session.uiMessageId, undefined, summary, {
      parse_mode: "HTML",
      reply_markup: broadcastDoneKeyboard().reply_markup,
    });
  } catch (_) {
    await sendUi(ctx, summary, {
      reply_markup: broadcastDoneKeyboard().reply_markup,
    });
  }

  ctx.scene.session.draft = null;
  try {
    await ctx.scene.leave();
  } catch (_) {
    /* ignore */
  }
});

scene.on("message", async (ctx, next) => {
  if (ctx.message?.text && isBotCommandText(ctx.message.text)) {
    ctx.scene.session.draft = null;
    ctx.scene.session.step = null;
    ctx.scene.session.uiMessageId = null;
    ctx.scene.session.previewMessageId = null;
    try {
      await ctx.scene.leave();
    } catch (_) {
      /* ignore */
    }
    return next();
  }

  if (!isAdminTelegramId(ctx.from.id)) return;

  const step = getStep(ctx);
  if (step === "preview" || step === "sending" || step === "await_button_choice") {
    await tryDeleteUserMessage(ctx);
    return;
  }

  if (step === "await_text") {
    const textDraft = extractTextDraft(ctx.message);
    await tryDeleteUserMessage(ctx);
    if (!textDraft || !String(textDraft.text || "").trim()) {
      await sendUi(
        ctx,
        `${pe("error")} Нужен текстовый контент. Отправь сообщение с текстом.`,
        { reply_markup: broadcastCancelKeyboard().reply_markup }
      );
      return;
    }

    // If admin sent media+caption as first step, accept both
    const media = extractMediaFromMessage(ctx.message);
    const draft = getDraft(ctx);
    draft.text = textDraft.text;
    draft.entities = textDraft.entities;
    if (media) {
      draft.mediaType = media.mediaType;
      draft.fileId = media.fileId;
      await showButtonChoice(ctx);
      return;
    }
    await showMediaStep(ctx);
    return;
  }

  if (step === "await_media") {
    const media = extractMediaFromMessage(ctx.message);
    await tryDeleteUserMessage(ctx);
    if (!media) {
      await sendUi(
        ctx,
        `${pe("error")} Пришли фото, видео или GIF — либо нажми «Пропустить».`,
        { reply_markup: broadcastSkipMediaKeyboard().reply_markup }
      );
      return;
    }
    const draft = getDraft(ctx);
    draft.mediaType = media.mediaType;
    draft.fileId = media.fileId;
    // If caption provided with media at this step, keep existing text (already set)
    await showButtonChoice(ctx);
    return;
  }

  if (step === "await_button_text") {
    const raw = (ctx.message.text || "").trim();
    await tryDeleteUserMessage(ctx);
    if (!raw || raw.length > 64) {
      await sendUi(
        ctx,
        `${pe("error")} Текст кнопки: 1–64 символа.`,
        { reply_markup: broadcastCancelKeyboard().reply_markup }
      );
      return;
    }
    const draft = getDraft(ctx);
    draft.button = { text: raw, url: "" };
    await showButtonUrlStep(ctx);
    return;
  }

  if (step === "await_button_url") {
    const raw = (ctx.message.text || "").trim();
    await tryDeleteUserMessage(ctx);
    const url = normalizeButtonUrl(raw);
    if (!url) {
      await sendUi(
        ctx,
        `${pe("error")} Некорректный URL. Пример: <code>https://t.me/example</code>`,
        { reply_markup: broadcastCancelKeyboard().reply_markup }
      );
      return;
    }
    const draft = getDraft(ctx);
    if (!draft.button) draft.button = { text: "Открыть", url };
    else draft.button.url = url;
    await showPreview(ctx);
  }
});

module.exports = { broadcastScene: scene };
