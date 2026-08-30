const { Markup } = require("telegraf");
const { pe, switchInlineBtn, btn } = require("./emoji");

function callersIntroHtml() {
  return [
    `${pe("broadcast")} <b>Прозвонщицы</b>`,
    "",
    "Нужен прозвон — не ищи контакты наугад.",
    "Выбери прозвонщицу и напиши ей в личные сообщения.",
    "",
    `${pe("info")} Нажми кнопку ниже, чтобы открыть список.`,
  ].join("\n");
}

function callersIntroKeyboard() {
  return Markup.inlineKeyboard([
    [switchInlineBtn("Смотреть прозвонщиц", "callers", "broadcast")],
    [btn("В главное меню", "menu:home", "home")],
  ]);
}

module.exports = {
  callersIntroHtml,
  callersIntroKeyboard,
};
