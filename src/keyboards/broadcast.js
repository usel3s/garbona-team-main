const { Markup } = require("telegraf");
const { btn } = require("../utils/emoji");

function broadcastCancelKeyboard() {
  return Markup.inlineKeyboard([[btn("Отменить", "broadcast:cancel", "error")]]);
}

function broadcastSkipMediaKeyboard() {
  return Markup.inlineKeyboard([
    [btn("Пропустить", "broadcast:skip_media", "time")],
    [btn("Отменить", "broadcast:cancel", "error")],
  ]);
}

function broadcastButtonChoiceKeyboard() {
  return Markup.inlineKeyboard([
    [
      btn("Добавить кнопку", "broadcast:add_button", "link"),
      btn("Без кнопки", "broadcast:skip_button", "success"),
    ],
    [btn("Отменить", "broadcast:cancel", "error")],
  ]);
}

function broadcastConfirmKeyboard() {
  return Markup.inlineKeyboard([
    [
      btn("Отправить", "broadcast:send", "broadcast"),
      btn("Отмена", "broadcast:cancel", "error"),
    ],
  ]);
}

function broadcastDoneKeyboard() {
  return Markup.inlineKeyboard([[btn("В админ-панель", "admin:panel", "code")]]);
}

module.exports = {
  broadcastCancelKeyboard,
  broadcastSkipMediaKeyboard,
  broadcastButtonChoiceKeyboard,
  broadcastConfirmKeyboard,
  broadcastDoneKeyboard,
};
