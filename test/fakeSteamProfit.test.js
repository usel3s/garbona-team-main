"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  parseFakeSteamProfitMeta,
  buildFakeProfitGames,
  tryParseLegacySkinLine,
} = require("../src/utils/fakeSteamProfitInput");
const { pickSkinsForInventoryTarget } = require("../src/utils/fakeProfitSkinPicker");
const { renderSteamProfitImage } = require("../src/utils/steamImageRenderer");

const MOCK_CATALOG = [
  { name: "AWP | Dragon Lore (Factory New)", icon: "awp1", price: 4200 },
  { name: "AK-47 | Fire Serpent (Minimal Wear)", icon: "ak1", price: 850 },
  { name: "M4A1-S | Printstream (Field-Tested)", icon: "m4a1", price: 180 },
  { name: "USP-S | Kill Confirmed (Minimal Wear)", icon: "usp1", price: 95 },
  { name: "Glock-18 | Fade (Factory New)", icon: "glock1", price: 420 },
  { name: "Desert Eagle | Blaze (Factory New)", icon: "deagle1", price: 520 },
  { name: "MP9 | Starlight Protector (Factory New)", icon: "mp9", price: 45 },
  { name: "P250 | See Ya Later (Factory New)", icon: "p250", price: 12 },
  { name: "Nova | Hyper Beast (Minimal Wear)", icon: "nova1", price: 18 },
  { name: "SSG 08 | Dragonfire (Field-Tested)", icon: "ssg1", price: 28 },
];

test("parseFakeSteamProfitMeta auto mode from sum and balance", () => {
  const parsed = parseFakeSteamProfitMeta("сумма: 850\nбаланс: 300\nmafile: 39\nигры: 3");
  assert.equal(parsed.mode, "auto");
  assert.equal(parsed.inventoryUsd, 550);
  assert.equal(parsed.balanceUsd, 300);
  assert.equal(parsed.mafileTime, "39");
  assert.equal(parsed.gamesCount, 3);
});

test("parseFakeSteamProfitMeta auto mode from plain number", () => {
  const parsed = parseFakeSteamProfitMeta("500");
  assert.equal(parsed.mode, "auto");
  assert.equal(parsed.totalUsd, 500);
  assert.equal(parsed.inventoryUsd, 500);
});

test("parseFakeSteamProfitMeta splits meta and manual skin lines", () => {
  const parsed = parseFakeSteamProfitMeta([
    "баланс: 300",
    "mafile: 39",
    "игры: 3",
    "AK-47 | Redline (Field-Tested)",
    "AWP | Asiimov (Field-Tested)",
    "M4A1-S | Hot Rod (Factory New)",
    "USP-S | Kill Confirmed (Minimal Wear)",
    "Glock-18 | Fade (Factory New)",
  ].join("\n"));

  assert.equal(parsed.mode, "manual");
  assert.equal(parsed.balanceUsd, 300);
  assert.equal(parsed.skinLines.length, 5);
});

test("parseFakeSteamProfitMeta rejects invalid input", () => {
  const parsed = parseFakeSteamProfitMeta("AK-47 | Redline (Field-Tested)");
  assert.match(parsed.error, /сумму MaFile|5–7/);
});

test("pickSkinsForInventoryTarget returns 5 scaled items", () => {
  const picked = pickSkinsForInventoryTarget(550, { catalog: MOCK_CATALOG });
  assert.equal(picked.items.length, 5);
  assert.equal(picked.inventoryUsd, 550);
  const names = new Set(picked.items.map((item) => item.itemHashName));
  assert.equal(names.size, 5);
});

test("buildFakeProfitGames returns capped popular games", () => {
  assert.equal(buildFakeProfitGames(2).length, 2);
  assert.equal(buildFakeProfitGames(2)[0].appid, 730);
  assert.equal(buildFakeProfitGames(9).length, 4);
});

test("legacy skin line parser still works", () => {
  const item = tryParseLegacySkinLine("abc123;12.5;AK-47 | Redline (Field-Tested)");
  assert.equal(item.price, 12.5);
  assert.match(item.itemHashName, /Redline/);
});

test("resolveFakeSteamProfitInput accepts panel totalUsd without text", async () => {
  const { resolveFakeSteamProfitInput } = require("../src/services/steamMarketLookup");
  const resolved = await resolveFakeSteamProfitInput("", {
    totalUsd: 43.64,
    balanceUsd: 0.78,
    mafileTime: "42",
    gamesCount: 4,
  });
  assert.equal(resolved.error, undefined);
  assert.equal(resolved.items.length, 5);
  assert.equal(resolved.total, 43.64);
  assert.equal(resolved.balanceUsd, 0.78);
  assert.equal(resolved.inventoryUsd, 42.86);
});

test("workerShareForMafileImage includes credited withdrawn and sold statuses", () => {
  const { workerShareForMafileImage } = require("../src/services/mafileStatusService");
  assert.deepEqual(workerShareForMafileImage({ mafileStatus: "pending", totalProfit: 100 }), {
    workerShare: null,
    workerPercent: null,
  });
  assert.deepEqual(
    workerShareForMafileImage({
      mafileStatus: "withdrawn",
      mafileWithdrawnAmount: 42.84,
      mafileWorkerShare: 34.27,
      mafileWorkerPercent: 80,
    }),
    { workerShare: 34.27, workerPercent: 80 }
  );
  assert.deepEqual(
    workerShareForMafileImage({
      mafileStatus: "sold",
      mafileWithdrawnAmount: 42.84,
      mafileWorkerShare: 34.27,
      mafileWorkerPercent: 80,
    }),
    { workerShare: 34.27, workerPercent: 80 }
  );
});

test("renderSteamProfitImage hides worker share by default", async () => {
  const buffer = await renderSteamProfitImage({
    items: [
      { itemHashName: "AWP | Asiimov (Field-Tested)", price: 120.5 },
      { itemHashName: "AK-47 | Redline (Field-Tested)", price: 45.2 },
    ],
    games: buildFakeProfitGames(2),
    total: 365.7,
    balanceUsd: 200,
    inventoryUsd: 165.7,
    mafileTime: "39",
  });

  assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.ok(buffer.length > 5000);
});

test("renderSteamProfitImage shows worker share when sold", async () => {
  const buffer = await renderSteamProfitImage({
    items: [
      { itemHashName: "AWP | Asiimov (Field-Tested)", price: 120.5 },
      { itemHashName: "AK-47 | Redline (Field-Tested)", price: 45.2 },
    ],
    games: buildFakeProfitGames(2),
    total: 365.7,
    balanceUsd: 200,
    inventoryUsd: 165.7,
    mafileTime: "39",
    workerShare: 292.56,
    workerPercent: 80,
  });

  assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.ok(buffer.length > 5000);
});
