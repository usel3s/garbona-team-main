"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  pickGamesFromAccount,
  unwrapGamesPayload,
  resolveAccountGames,
  gamesFromPricedItems,
  normalizeGameRow,
} = require("../src/utils/steamAccountGames");

test("pickGamesFromAccount reads nested games lists", () => {
  const games = pickGamesFromAccount({
    steamInfo: {
      gamesInfo: [{ appid: 730, name: "Counter-Strike 2", playtime_forever: 1200 }],
    },
  });
  assert.equal(games.length, 1);
  assert.equal(games[0].appid, 730);
});

test("pickGamesFromAccount skips lists without appid and keeps looking", () => {
  const games = pickGamesFromAccount({
    gamesInfo: [{ name: "Broken row without appid" }],
    steamInfo: {
      games: [{ appId: 570, title: "Dota 2", playtime: 40 }],
    },
  });
  assert.equal(games.length, 1);
  assert.equal(games[0].appid, 570);
});

test("unwrapGamesPayload supports API wrappers including full account", () => {
  assert.equal(unwrapGamesPayload({ games: [{ appid: 570 }] }).length, 1);
  assert.equal(unwrapGamesPayload([{ appid: 252490 }]).length, 1);
  assert.equal(
    unwrapGamesPayload({
      id: "1",
      gamesInfo: [{ appid: 730, name: "CS2", playtime: 10 }],
      gamesCount: 1,
    }).length,
    1
  );
  assert.equal(unwrapGamesPayload({ response: { games: [{ appid: 440 }] } }).length, 1);
});

test("normalizeGameRow keeps icon and accepts id alias", () => {
  const row = normalizeGameRow({
    id: 730,
    title: "CS2",
    playtime: 5,
    icon: "abc",
  });
  assert.equal(row.appid, 730);
  assert.equal(row.icon, "abc");
  assert.equal(row.playtime_forever, 5);
});

test("resolveAccountGames falls back to fetchGames", async () => {
  const games = await resolveAccountGames({}, "822246", async () => ([
    { appId: 730, title: "CS2", playtime: 9000 },
    { appId: 570, title: "Dota 2", playtime: 100 },
  ]), { retries: 0 });
  assert.equal(games.length, 2);
  assert.equal(games[0].appid, 730);
});

test("resolveAccountGames retries empty fetch then uses priced items", async () => {
  let calls = 0;
  const games = await resolveAccountGames({}, "827348", async () => {
    calls += 1;
    return { gamesInfo: [], gamesCount: 0 };
  }, {
    retries: 1,
    retryDelayMs: 1,
    fallbackItems: [
      { appid: 730, priceHashName: "AWP | Redline", price: 12 },
      { appid: 753, itemHashName: "Steam item", price: 1 },
    ],
  });
  assert.equal(calls, 2);
  assert.equal(games.length, 1);
  assert.equal(games[0].appid, 730);
  assert.match(games[0].name, /Counter-Strike/i);
});

test("resolveAccountGames recovers after transient empty then populated", async () => {
  let calls = 0;
  const games = await resolveAccountGames({}, "827380", async () => {
    calls += 1;
    if (calls === 1) return { gamesInfo: [] };
    return {
      gamesInfo: [{ appid: 730, name: "Counter-Strike 2", playtime: 900, icon: "x" }],
    };
  }, { retries: 2, retryDelayMs: 1 });
  assert.equal(calls, 2);
  assert.equal(games.length, 1);
  assert.equal(games[0].icon, "x");
});

test("gamesFromPricedItems dedupes and skips Steam app 753", () => {
  const games = gamesFromPricedItems([
    { appid: 730, price: 1 },
    { appid: 730, price: 2 },
    { appid: 753, price: 9 },
    { appId: 570, price: 3 },
  ]);
  assert.deepEqual(games.map((g) => g.appid).sort((a, b) => a - b), [570, 730]);
});

test("gamesFromPricedItems infers CS2 from skin market name without appid", () => {
  const games = gamesFromPricedItems([
    { itemHashName: "FAMAS | Rapid Eye Movement (Field-Tested)", price: 8.6 },
    { itemHashName: "USP-S | Cortex (Field-Tested)", price: 4.5 },
  ]);
  assert.equal(games.length, 1);
  assert.equal(games[0].appid, 730);
});

test("gamesFromInventoryGroups reads appid from UProject inventory groups", () => {
  const { gamesFromInventoryGroups } = require("../src/utils/steamAccountGames");
  const games = gamesFromInventoryGroups({
    inventories: [
      { appid: 730, items: [{ itemHashName: "AWP | Redline", price: 10 }] },
      { appid: 753, items: [{ itemHashName: "Gem", price: 1 }] },
      { appid: 440, items: [] },
    ],
  });
  assert.equal(games.length, 1);
  assert.equal(games[0].appid, 730);
});

test("resolveAccountGames uses inventory groups when items lack appid", async () => {
  const games = await resolveAccountGames({}, "827525", async () => ({ gamesInfo: [] }), {
    retries: 0,
    fallbackItems: [{ itemHashName: "AK-47 | Redline (Field-Tested)", price: 12 }],
  });
  assert.equal(games.length, 1);
  assert.equal(games[0].appid, 730);
});