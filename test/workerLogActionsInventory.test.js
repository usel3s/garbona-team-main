const test = require("node:test");
const assert = require("node:assert/strict");
const {
  inventoryByAppid,
  topInventoryItems,
  serializeGames,
  serializeInventoryItem,
  buildDetail,
} = require("../src/services/workerLogActionsService");

const sampleInventory = {
  price: { total: 6.26, tradable: 6.26, marketable: 6.26 },
  inventories: [
    {
      appid: 730,
      items: [
        { itemHashName: "Ticket to Hell", price: 1.35, icon: "a", amount: 1 },
        { itemHashName: "Cheap Case", price: 0.25, icon: "b", amount: 2 },
        { itemHashName: "Yeti Camo", price: 0.34, icon: "c" },
      ],
    },
    {
      appid: 252490,
      name: "Rust",
      items: [{ itemHashName: "Wood", price: 0.02, icon: "d", amount: 5 }],
    },
  ],
};

test("serializeInventoryItem reads nested Steam economy fields", () => {
  const item = serializeInventoryItem({
    appid: 753,
    amount: 2,
    asset_description: {
      market_hash_name: "440 Level Up",
      icon_url: "nestedhash/330x192",
      name_color: "D2D2D2",
    },
  });
  assert.equal(item.name, "440 Level Up");
  assert.equal(item.amount, 2);
  assert.equal(item.appid, 753);
  assert.match(item.iconUrl, /nestedhash/);
  assert.equal(item.nameColor, "D2D2D2");
});

test("inventoryByAppid keeps cheap items and computes totals", () => {
  const map = inventoryByAppid(sampleInventory);
  assert.ok(map["730"]);
  assert.equal(map["730"].items.length, 3);
  assert.equal(map["730"].itemCount, 4);
  assert.equal(map["730"].totalUsd, 2.19);
  assert.equal(map["730"].name, "CS2");
  assert.ok(map["252490"]);
  assert.equal(map["252490"].items[0].priceUsd, 0.02);
  assert.equal(map["252490"].itemCount, 5);
});

test("topInventoryItems sorts by price without $1 filter", () => {
  const top = topInventoryItems(sampleInventory, 10);
  assert.equal(top.length, 4);
  assert.equal(top[0].name, "Ticket to Hell");
  assert.ok(top.some((item) => item.priceUsd === 0.25));
});

test("serializeGames creates tabs from inventory appids when account games empty", () => {
  const map = inventoryByAppid(sampleInventory);
  const games = serializeGames(null, null, { inventoryMap: map });
  assert.ok(games.length >= 2);
  assert.equal(games[0].appid, 730);
  assert.equal(games[0].itemCount, 4);
  assert.equal(games[0].inventoryUsd, 2.19);
});

test("buildDetail prefers mafileSnapshot over live inventory without icons", async () => {
  const detail = await buildDetail({
    id: "822246",
    account: {
      inventory: {
        price: { total: 9.99 },
        inventories: [
          {
            appid: 730,
            items: [{ itemHashName: "Snapshot Skin", price: 1.1, amount: 1 }],
          },
        ],
      },
    },
    steamLog: {
      logKind: "mafile",
      balanceUsd: 0,
      inventoryUsd: 6.26,
      totalProfit: 6.26,
      steamId: "76561199752902431",
      accountUsername: "rapaxcz_8",
      mafileSnapshot: {
        items: [
          { itemHashName: "Snapshot Skin", price: 1.1, icon: "abc123hash" },
          { itemHashName: "Cheap", price: 0.4, icon: "def456hash" },
        ],
        games: [{ appid: 730, name: "Counter-Strike 2", playtime_forever: 120 }],
      },
    },
    inventory: {
      price: { total: 9.99 },
      inventories: [
        {
          appid: 730,
          items: [{ itemHashName: "Snapshot Skin", price: 1.1 }],
        },
      ],
    },
  });

  const group = Object.values(detail.inventoryByAppid)[0];
  assert.equal(detail.eventType, "mafile");
  assert.equal(detail.username, "rapaxcz_8");
  assert.ok(group);
  assert.equal(group.items.length, 2);
  assert.ok(group.items.some((item) => item.priceUsd === 0.4));
  assert.match(group.items[0].iconUrl, /abc123hash/);
  assert.ok(detail.games.some((game) => Number(game.appid) === 730));
});
