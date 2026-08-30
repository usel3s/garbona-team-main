"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { acceptedStartKeyboard } = require("../src/keyboards/common");

function flattenButtons(keyboard) {
  return (keyboard?.reply_markup?.inline_keyboard || []).flat();
}

test("accepted welcome keyboard offers a personal chat invite", () => {
  const buttons = flattenButtons(
    acceptedStartKeyboard({ chatInviteUrl: "https://t.me/+invite" })
  );
  const chat = buttons.find((b) => b.text === "Вступить в чат");
  assert.equal(chat?.url, "https://t.me/+invite");
  assert.ok(buttons.some((b) => b.text === "В главное меню"));
});

test("accepted welcome keyboard falls back to generating an invite on tap", () => {
  const buttons = flattenButtons(
    acceptedStartKeyboard({ showChatCallback: true })
  );
  const chat = buttons.find((b) => b.text === "Вступить в чат");
  assert.equal(chat?.callback_data, "welcome:workers_chat");
});
