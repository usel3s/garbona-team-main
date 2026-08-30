"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  formatProfileOwnerLinkHtml,
  MIN_PROFILE_VIEW_PROFIT_USD,
} = require("../src/services/profileAccessService");

test("formatProfileOwnerLinkHtml builds deep-link for nick", () => {
  const html = formatProfileOwnerLinkHtml("mnyklz", "8640471725", "GarbonaBot");
  assert.match(html, /href="https:\/\/t\.me\/GarbonaBot\?start=u_8640471725"/);
  assert.match(html, />mnyklz</);
});

test("formatProfileOwnerLinkHtml escapes html in label", () => {
  const html = formatProfileOwnerLinkHtml("<script>", "1", "bot");
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("min profile view profit is 20", () => {
  assert.equal(MIN_PROFILE_VIEW_PROFIT_USD, 20);
});
