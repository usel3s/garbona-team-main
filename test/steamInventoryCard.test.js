const test = require("node:test");
const assert = require("node:assert/strict");
const { topItems } = require("../src/services/steamLogAdminService");
const { getSteamInventorySoft } = require("../src/services/steamApiService");

test("topItems reads CS2 inventories payload used by UProject inventory API", () => {
  const inventory = {
    price: { total: 12.89, tradable: 12.89, marketable: 12.89 },
    inventories: [
      { appid: 570, items: [] },
      {
        appid: 730,
        items: [
          { itemHashName: "Desert Eagle | Light Rail (Minimal Wear)", price: 3.614, icon: "abc" },
          { itemHashName: "Kilowatt Case", price: 0.25, amount: 2, icon: "def" },
          { itemHashName: "Premiere Medal", price: 0, isMedal: true, icon: "ghi" },
        ],
      },
    ],
  };

  const items = topItems(inventory);
  assert.equal(items[0].itemHashName, "Desert Eagle | Light Rail (Minimal Wear)");
  assert.equal(items[0].price, 3.614);
  assert.equal(items.length, 2);
});

test("soft inventory rejects non-SteamID values without calling UProject", async () => {
  assert.equal(await getSteamInventorySoft("1196321"), null);
  assert.equal(await getSteamInventorySoft("padmin:admin"), null);
  assert.equal(await getSteamInventorySoft(""), null);
  assert.equal(await getSteamInventorySoft("7656119"), null);
});
