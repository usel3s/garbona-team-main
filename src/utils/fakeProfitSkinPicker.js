"use strict";

const fs = require("fs");
const path = require("path");

const CATALOG_PATH = path.join(__dirname, "../data/cs2SkinCatalog.json");
const SLOT_WEIGHTS = [0.34, 0.26, 0.18, 0.13, 0.09];
const SKIN_COUNT = 5;

let catalogCache = null;

function loadSkinCatalog() {
  if (catalogCache) return catalogCache;
  if (!fs.existsSync(CATALOG_PATH)) {
    throw new Error("Каталог скинов не найден. Запустите: node scripts/build-cs2-skin-catalog.js");
  }
  const raw = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
  catalogCache = (raw.items || [])
    .filter((item) => item?.name && item?.icon && Number(item.price) > 0)
    .map((item) => ({
      name: String(item.name),
      icon: String(item.icon),
      price: Number(item.price),
    }));
  if (catalogCache.length < SKIN_COUNT) {
    throw new Error(`Каталог скинов слишком мал (${catalogCache.length}). Пересоберите каталог.`);
  }
  return catalogCache;
}

function clearSkinCatalogCache() {
  catalogCache = null;
}

function pickFromTop(candidates, slotTarget) {
  if (!candidates.length) return null;
  const sorted = [...candidates].sort(
    (a, b) => Math.abs(a.price - slotTarget) - Math.abs(b.price - slotTarget)
  );
  const top = sorted.slice(0, Math.min(12, sorted.length));
  return top[Math.floor(Math.random() * top.length)];
}

function scaleItemsToTarget(items, targetUsd) {
  const rawSum = items.reduce((sum, item) => sum + item.price, 0);
  if (rawSum <= 0) return null;
  const factor = targetUsd / rawSum;
  const scaled = items.map((item) => ({
    ...item,
    price: Number((item.price * factor).toFixed(2)),
  }));
  const diff = Number((targetUsd - scaled.reduce((sum, item) => sum + item.price, 0)).toFixed(2));
  scaled[scaled.length - 1].price = Number((scaled[scaled.length - 1].price + diff).toFixed(2));
  if (scaled.some((item) => item.price <= 0)) return null;
  return scaled;
}

function pickSkinsForInventoryTarget(targetUsd, options = {}) {
  const count = SKIN_COUNT;
  const target = Number(targetUsd);
  if (!Number.isFinite(target) || target < 5) {
    return { error: "Сумма инвентаря должна быть не меньше $5." };
  }

  const catalog = options.catalog || loadSkinCatalog();
  const minPrice = Math.max(0.5, target / count / 5);
  const maxPrice = Math.max(minPrice * 2, target * 0.65);
  let pool = catalog.filter((item) => item.price >= minPrice && item.price <= maxPrice);
  if (pool.length < count * 3) pool = catalog.filter((item) => item.price >= 0.5 && item.price <= target);

  const used = new Set();
  const picked = [];

  for (let slot = 0; slot < count; slot += 1) {
    const slotTarget = target * SLOT_WEIGHTS[slot];
    const candidates = pool.filter((item) => !used.has(item.name));
    const choice = pickFromTop(candidates, slotTarget) || pickFromTop(catalog.filter((item) => !used.has(item.name)), slotTarget);
    if (!choice) return { error: "Не удалось подобрать скины из каталога." };
    picked.push({ ...choice });
    used.add(choice.name);
  }

  const scaled = scaleItemsToTarget(picked, target);
  if (!scaled) return { error: "Не удалось масштабировать цены скинов." };

  return {
    items: scaled.map((item) => ({
      icon: item.icon,
      price: item.price,
      itemHashName: item.name,
    })),
    inventoryUsd: Number(scaled.reduce((sum, item) => sum + item.price, 0).toFixed(2)),
  };
}

module.exports = {
  loadSkinCatalog,
  clearSkinCatalogCache,
  pickSkinsForInventoryTarget,
  SKIN_COUNT,
};
