#!/usr/bin/env node
/**
 * Renders preview cards for MaFile arrival, valid log, and MaFile after status change.
 * Output: assets/brand/mafile-preview/preview-*.png
 */
const fs = require("fs");
const path = require("path");
const catalog = require("../src/data/cs2SkinCatalog.json");
const { renderSteamProfitImage } = require("../src/utils/steamImageRenderer");
const { renderSteamLogImage } = require("../src/utils/steamLogImageRenderer");

const OUT_DIR = path.join(__dirname, "../assets/brand/mafile-preview");

function pickByName(fragment) {
  return catalog.items.find((item) =>
    String(item.name || "").toLowerCase().includes(fragment.toLowerCase())
  );
}

function toRenderItem(entry, price) {
  return {
    itemHashName: entry.name,
    icon: entry.icon,
    price,
  };
}

const mafileItems = [
  toRenderItem(pickByName("Five-SeveN | Nightshade"), 3.61),
  toRenderItem(pickByName("Glock-18 | Night (Field-Tested)"), 1.25),
  toRenderItem(pickByName("Dreams & Nightmares Case"), 0.84),
  toRenderItem(pickByName("P250 | Forest Night"), 0.64),
  toRenderItem(pickByName("MAC-10 | Ultraviolet (Battle-Scarred)"), 0.62),
];

const games = [{ appid: 730, name: "Counter-Strike 2", playtime_forever: 4200 }];
const total = 13;
const balanceUsd = 0.11;
const inventoryUsd = 12.89;

async function writePreview(name, buffer) {
  const filePath = path.join(OUT_DIR, name);
  await fs.promises.writeFile(filePath, buffer);
  console.log(`saved ${filePath} (${buffer.length} bytes)`);
}

async function main() {
  await fs.promises.mkdir(OUT_DIR, { recursive: true });

  const mafileArrival = await renderSteamProfitImage({
    items: mafileItems,
    games,
    total,
    balanceUsd,
    inventoryUsd,
    mafileTime: 32,
  });
  await writePreview("preview-mafile-arrival.png", mafileArrival);

  const mafileWithdrawn = await renderSteamProfitImage({
    items: mafileItems,
    games,
    total,
    balanceUsd,
    inventoryUsd,
    mafileTime: 32,
    workerShare: 5.89,
    workerPercent: 100,
  });
  await writePreview("preview-mafile-withdrawn.png", mafileWithdrawn);

  const validLog = await renderSteamLogImage({
    username: "rapaxcz_8",
    steamInfo: {
      country: "CZ",
      level: 12,
      balanceUsd: 0.11,
      nickname: "rapaxcz_8",
    },
    inventory: {
      price: { tradable: inventoryUsd, marketable: inventoryUsd, total: inventoryUsd },
      inventories: [
        {
          appid: 730,
          name: "Counter-Strike 2",
          items: mafileItems.map((item) => ({
            itemHashName: item.itemHashName,
            icon: item.icon,
            price: item.price,
          })),
        },
      ],
    },
    gamesInfo: [{ appid: 730, name: "Counter-Strike 2", icon: "", playtime: 4200 }],
  });
  await writePreview("preview-valid-log.png", validLog);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
