const assert = require("node:assert/strict");
const test = require("node:test");

const {
  skinName,
  formatMaFileTime,
  iconUrls,
  sortedMafileItems,
  sortedMafileGames,
} = require("../src/utils/steamImageRenderer");
const { renderSteamLogImage } = require("../src/utils/steamLogImageRenderer");

test("skinName removes weapon, StatTrak mark and wear", () => {
  assert.equal(skinName("StatTrak™ AWP | Chrome Cannon (Factory New)"), "Chrome Cannon");
  assert.equal(skinName("★ Bowie Knife | Lore (Well-Worn)"), "Lore");
  assert.equal(skinName("B Squadron Officer | SAS"), "SAS");
});

test("formatMaFileTime rounds remaining UProject session hours up", () => {
  const now = Date.parse("2026-08-21T15:50:52.916Z");
  assert.equal(formatMaFileTime("2026-08-23T16:50:52.916Z", now), "49 ч");
  assert.equal(formatMaFileTime("2026-08-21T14:50:52.916Z", now), "");
});

test("iconUrls accepts nested Steam market item descriptions", () => {
  const urls = iconUrls({ asset_description: { icon_url: "abc123/360fx360f" } });
  assert.equal(urls[0], "https://community.cloudflare.steamstatic.com/economy/image/abc123/360fx360f");
});

test("MaFile image data is sorted by price and playtime", () => {
  const items = sortedMafileItems([
    { itemHashName: "cheap", price: 1 },
    { itemHashName: "expensive", price: "$352.03" },
    { itemHashName: "knife", price: 119.78, amount: 1 },
    { itemHashName: "middle", priceUsd: 41.5 },
  ]);
  const games = sortedMafileGames([
    { appid: 10, playtime: 12 },
    { appid: 20, playtime_forever: 9000 },
    { appid: 30, playtimeForever: 120 },
  ]);

  assert.deepEqual(items.map((item) => item.itemHashName), ["expensive", "knife", "middle", "cheap"]);
  assert.deepEqual(games.map((game) => game.appid), [20, 30, 10]);
});

test("renderSteamLogImage returns a PNG card for a valid log", async () => {
  const buffer = await renderSteamLogImage({
    username: "jacob18723",
    steamInfo: { country: "GB", level: 19, balanceUsd: 0 },
    inventory: { price: { tradable: 352.03 } },
    gamesInfo: [],
  });

  assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.ok(buffer.length > 5000);
});
