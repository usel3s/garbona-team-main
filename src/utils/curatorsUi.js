const { Markup } = require("telegraf");
const { pe, switchInlineBtn, btn } = require("./emoji");

function curatorsIntroHtml() {
  return [
    `${pe("users")} <b>Кураторы</b>`,
    "",
    "Если ты новичок — не стоит разбираться во всём самому.",
    "Куратор поможет быстро и без лишних сложностей.",
    "",
    `${pe("info")} Нажми кнопку ниже, чтобы открыть список кураторов.`,
  ].join("\n");
}

function curatorsIntroKeyboard() {
  return Markup.inlineKeyboard([
    [switchInlineBtn("Смотреть кураторов", "curators", "users")],
    [btn("В главное меню", "menu:home", "home")],
  ]);
}

module.exports = {
  curatorsIntroHtml,
  curatorsIntroKeyboard,
};
