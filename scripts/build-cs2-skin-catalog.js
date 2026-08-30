"use strict";

/**
 * Быстрая сборка каталога CS2 из Steam Market search (цена из sell_price).
 * node scripts/build-cs2-skin-catalog.js
 */

require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "../src/data/cs2SkinCatalog.json");
const headers = { "User-Agent": "Mozilla/5.0", Accept: "application/json, text/javascript, */*;q=0.01" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const QUERIES = [
  "★", "Knife", "Gloves", "Karambit", "Butterfly", "Bayonet", "M9 Bayonet", "Talon", "Skeleton", "Nomad", "Stiletto",
  "AWP", "AK-47", "M4A1-S", "M4A4", "Desert Eagle", "USP-S", "Glock-18", "P250", "Five-SeveN", "CZ75", "Dual Berettas",
  "MAC-10", "MP9", "UMP-45", "P90", "PP-Bizon", "Galil AR", "FAMAS", "SG 553", "AUG", "SSG 08", "SCAR-20", "G3SG1",
  "Nova", "XM1014", "MAG-7", "Sawed-Off", "Negev", "M249", "StatTrak", "Souvenir",
  "Asiimov", "Fade", "Doppler", "Tiger Tooth", "Marble Fade", "Redline", "Vulcan", "Printstream", "Neo-Noir",
  "Hyper Beast", "Dragon Lore", "Fire Serpent", "Case Hardened", "Crimson Web", "Lore", "Autotronic", "Gamma Doppler",
  "Slaughter", "Blue Steel", "Freehand", "Black Laminate", "Night", "Ultraviolet", "Rust Coat", "Safari Mesh",
];

function priceFromRow(row) {
  const cents = Number(row?.sell_price);
  if (Number.isFinite(cents) && cents > 0) return Number((cents / 100).toFixed(2));
  const text = String(row?.sell_price_text || row?.sale_price_text || "").replace(/[^0-9.]/g, "");
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed > 0 ? Number(parsed.toFixed(2)) : null;
}

async function fetchPage(query, start) {
  const data = (
    await axios.get("https://steamcommunity.com/market/search/render/", {
      params: { query, start, count: 100, norender: 1, appid: 730, currency: 1, language: "english" },
      headers,
      timeout: 25000,
      validateStatus: () => true,
    })
  ).data;
  if (data?.success === false) return [];
  return data?.results || [];
}

async function collectQuery(query, seen) {
  let added = 0;
  for (let start = 0; start < 1000; start += 10) {
    let rows = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        rows = await fetchPage(query, start);
        break;
      } catch (error) {
        if (attempt === 2) throw error;
        await sleep(2000 * (attempt + 1));
      }
    }
    if (!rows.length) break;
    for (const row of rows) {
      const name = row?.hash_name || row?.asset_description?.market_hash_name;
      const icon = row?.asset_description?.icon_url;
      const price = priceFromRow(row);
      if (!name || !icon || price == null || price < 0.5 || seen.has(name)) continue;
      seen.set(name, {
        name,
        icon: String(icon).replace(/\/\d+fx\d+f$/i, ""),
        price,
      });
      added += 1;
    }
    await sleep(600);
    if (rows.length < 10) break;
  }
  return added;
}

async function main() {
  const seen = new Map();
  for (const query of QUERIES) {
    process.stdout.write(`query "${query}" ... `);
    try {
      const added = await collectQuery(query, seen);
      console.log(`+${added} (total ${seen.size})`);
    } catch (error) {
      console.log(`err ${error.message}`);
      await sleep(2500);
    }
    await sleep(800);
  }

  const items = [...seen.values()].sort((a, b) => b.price - a.price);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(
    OUT,
    JSON.stringify({ updatedAt: new Date().toISOString(), count: items.length, items }, null, 2)
  );
  console.log("saved", OUT, "items:", items.length);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
