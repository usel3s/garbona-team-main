const { Markup } = require("telegraf");
const { btn } = require("../utils/emoji");

function postbotHomeKeyboard() {
  return Markup.inlineKeyboard([
    [btn("Создать пост", "postbot:create", "edit")],
    [btn("Сохранённые посты", "postbot:saved", "file")],
    [btn("Назад", "admin:comms", "home")],
  ]);
}

function postbotAwaitContentKeyboard() {
  return Markup.inlineKeyboard([[btn("Отмена", "postbot:home", "error")]]);
}

function postbotSettingsKeyboard(draft) {
  const previewOn = draft?.linkPreview !== false;
  const btnCount = (draft?.buttons || []).reduce((n, row) => n + row.length, 0);
  return Markup.inlineKeyboard([
    [
      btn("Изменить текст", "postbot:edit_text", "edit"),
      btn(
        btnCount ? `Кнопки (${btnCount})` : "Добавить кнопки",
        "postbot:add_buttons",
        "link"
      ),
    ],
    [
      btn(
        previewOn ? "Превью: вкл" : "Превью: выкл",
        "postbot:toggle_preview",
        previewOn ? "visible" : "hidden"
      ),
    ],
    [
      btn("Готово", "postbot:done", "success"),
      btn("Отмена", "postbot:home", "error"),
    ],
  ]);
}

function postbotButtonsHelpKeyboard() {
  return Markup.inlineKeyboard([
    [btn("Очистить кнопки", "postbot:clear_buttons", "delete")],
    [btn("Назад к настройкам", "postbot:settings", "settings")],
  ]);
}

function postbotNameKeyboard() {
  return Markup.inlineKeyboard([
    [btn("Пропустить", "postbot:skip_name", "time")],
    [btn("Отмена", "postbot:home", "error")],
  ]);
}

function postbotReadyKeyboard(postId) {
  return Markup.inlineKeyboard([
    [btn("Отправить", `postbot:send:${postId}`, "broadcast")],
    [btn("Сохранённые посты", "postbot:saved", "file")],
    [btn("Создать ещё", "postbot:create", "edit")],
    [btn("В админ-панель", "admin:panel", "code")],
  ]);
}

function postbotSavedListKeyboard(posts, page, hasPrev, hasNext) {
  const rows = (posts || []).map((p) => [
    btn((p.name || p.code).slice(0, 40), `postbot:view:${p._id}`, "file"),
  ]);
  const nav = [];
  if (hasPrev) nav.push(btn("Назад", `postbot:saved:${page - 1}`, "time"));
  if (hasNext) nav.push(btn("Далее", `postbot:saved:${page + 1}`, "time"));
  if (nav.length) rows.push(nav);
  rows.push([btn("К Postbot", "postbot:home", "bot")]);
  return Markup.inlineKeyboard(rows);
}

function postbotViewKeyboard(postId) {
  return Markup.inlineKeyboard([
    [btn("Отправить", `postbot:send:${postId}`, "broadcast")],
    [btn("Удалить", `postbot:delete:${postId}`, "delete")],
    [btn("К списку", "postbot:saved", "file")],
  ]);
}

function postbotSendCancelKeyboard(postId) {
  return Markup.inlineKeyboard([
    [btn("Отмена", `postbot:view:${postId}`, "error")],
  ]);
}

module.exports = {
  postbotHomeKeyboard,
  postbotAwaitContentKeyboard,
  postbotSettingsKeyboard,
  postbotButtonsHelpKeyboard,
  postbotNameKeyboard,
  postbotReadyKeyboard,
  postbotSavedListKeyboard,
  postbotViewKeyboard,
  postbotSendCancelKeyboard,
};
