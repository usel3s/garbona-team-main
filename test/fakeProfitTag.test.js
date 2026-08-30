"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  normalizeFakeProfitTag,
  resolveFakeProfitTag,
  formatFakeProfitTagLabel,
} = require("../src/utils/fakeProfitTag");
const { buildMafileChannelCaption } = require("../src/services/mafileStatusService");

test("normalizeFakeProfitTag strips hash and limits length", () => {
  assert.equal(normalizeFakeProfitTag("#Aelita"), "aelita");
  assert.equal(normalizeFakeProfitTag("abc-123_xyz"), "abc123");
  assert.equal(normalizeFakeProfitTag("verylongtagname"), "verylo");
});

test("resolveFakeProfitTag falls back to random tag", () => {
  const tag = resolveFakeProfitTag("");
  assert.match(tag, /^[a-z0-9]{4,6}$/);
  assert.equal(resolveFakeProfitTag("neo"), "neo");
});

test("buildMafileChannelCaption uses fake tag instead of Аноним", () => {
  const caption = buildMafileChannelCaption({
    total: 42.84,
    balanceUsd: 2.32,
    inventoryUsd: 40.52,
    status: "pending",
    fakeTag: "aelita",
  });
  assert.match(caption, /MaFile у #aelita/);
  assert.match(caption, /\[ID: Аноним\]/);
  assert.doesNotMatch(caption, /MaFile у Аноним/);
});

test("buildMafileChannelCaption uses user fakeProfitTag when anonymous", () => {
  const caption = buildMafileChannelCaption({
    ownerTelegramId: "123456",
    user: { isAnonymous: true, fakeProfitTag: "neo42" },
    total: 10,
    status: "pending",
  });
  assert.match(caption, /MaFile у #neo42/);
  assert.match(caption, /\[ID: Аноним\]/);
});

test("formatFakeProfitTagLabel adds hash", () => {
  assert.equal(formatFakeProfitTagLabel("aelita"), "#aelita");
});

test("log channel caption hides real identity when worker is anonymous", () => {
  const { formatSteamChannelOwnerLine } = require("../src/services/mafileStatusService");
  const line = formatSteamChannelOwnerLine("Лог", {
    ownerTelegramId: "8640471725",
    user: { isAnonymous: true, username: "mnyklz", fakeProfitTag: "bratva" },
  });
  assert.match(line, /Лог у #bratva/);
  assert.match(line, /\[ID: Аноним\]/);
  assert.doesNotMatch(line, /mnyklz/);
  assert.doesNotMatch(line, /8640471725/);
});
