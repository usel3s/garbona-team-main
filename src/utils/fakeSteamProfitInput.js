"use strict";

const { normalizeFakeProfitTag } = require("./fakeProfitTag");

function normalizeSteamIconHash(input) {
  const value = String(input || "").trim();
  return value.match(/economy\/image\/([^/?#]+)/i)?.[1] || value;
}

function tryParseLegacySkinLine(line) {
  const parts = String(line || "").trim().split(";");
  if (parts.length < 3 || !/^\d+([.,]\d+)?$/.test(parts[1].trim())) return null;
  const icon = normalizeSteamIconHash(parts[0]);
  const price = Number(parts[1].replace(",", "."));
  if (!icon || !Number.isFinite(price) || price < 0) return null;
  return { icon, price, itemHashName: parts.slice(2).join(";").trim() || "Unknown item" };
}

function parseMoneyLoose(raw) {
  const cleaned = String(raw || "")
    .trim()
    .replace(/^\$/, "")
    .replace(/\s/g, "")
    .replace(",", ".");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

const POPULAR_GAMES = Object.freeze([
  { appid: 730, name: "Counter-Strike 2", playtime_forever: 9000 },
  { appid: 252490, name: "Rust", playtime_forever: 4200 },
  { appid: 359550, name: "Rainbow Six Siege", playtime_forever: 1800 },
  { appid: 570, name: "Dota 2", playtime_forever: 600 },
]);

function buildFakeProfitGames(count = 4) {
  const safe = Math.max(0, Math.min(4, Math.trunc(Number(count) || 0)));
  return POPULAR_GAMES.slice(0, safe);
}

function resolveInventoryTarget(meta, skinLines) {
  if (meta.inventoryUsd != null) return meta.inventoryUsd;
  if (meta.totalUsd != null) {
    const inventory = Number((meta.totalUsd - meta.balanceUsd).toFixed(2));
    if (inventory < 5) {
      return { error: "После вычета баланса сумма инвентаря меньше $5. Уменьшите баланс или увеличьте сумму." };
    }
    return inventory;
  }
  if (skinLines.length === 1) {
    const only = parseMoneyLoose(skinLines[0]);
    if (only != null && only >= 5) return only;
  }
  return null;
}

function parseFakeSteamProfitMeta(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^[-—]{3,}$/.test(line));

  const meta = {
    balanceUsd: 0,
    mafileTime: "",
    gamesCount: 4,
    inventoryUsd: null,
    totalUsd: null,
    fakeTag: "",
  };
  const skinLines = [];

  for (const line of lines) {
    const labeled = line.match(/^(баланс|balance|mafile|игры|games|сумма|total|инвентарь|inventory|тег|tag)\s*[:=]\s*(.+)$/i);
    if (labeled) {
      const key = labeled[1].toLowerCase();
      const value = labeled[2].trim();
      if (/^(баланс|balance)$/.test(key)) {
        const parsed = parseMoneyLoose(value);
        if (parsed == null) return { error: "Некорректный баланс Steam." };
        meta.balanceUsd = Math.max(0, parsed);
      } else if (/^mafile$/.test(key)) {
        meta.mafileTime = value;
      } else if (/^(игры|games)$/.test(key)) {
        const count = Number(String(value).replace(/[^\d.-]/g, ""));
        if (!Number.isFinite(count) || count < 0 || count > 4) {
          return { error: "Игры: укажите число от 0 до 4." };
        }
        meta.gamesCount = Math.trunc(count);
      } else if (/^(инвентарь|inventory)$/.test(key)) {
        const parsed = parseMoneyLoose(value);
        if (parsed == null || parsed < 5) return { error: "Инвентарь: укажите сумму от $5." };
        meta.inventoryUsd = parsed;
      } else if (/^(сумма|total)$/.test(key)) {
        const parsed = parseMoneyLoose(value);
        if (parsed == null || parsed < 5) return { error: "Сумма MaFile: укажите значение от $5." };
        meta.totalUsd = parsed;
      } else if (/^(тег|tag)$/.test(key)) {
        meta.fakeTag = normalizeFakeProfitTag(value);
      }
      continue;
    }

    if (!skinLines.length && lines.length === 1) {
      const plain = parseMoneyLoose(line);
      if (plain != null && plain >= 5) {
        meta.totalUsd = plain;
        continue;
      }
    }

    skinLines.push(line);
  }

  if (skinLines.length === 0) {
    const inventoryTarget = resolveInventoryTarget(meta, skinLines);
    if (inventoryTarget?.error) return inventoryTarget;
    if (inventoryTarget == null) {
      return { error: "Укажите сумму MaFile (число или сумма: 500) или 5–7 строк со скинами." };
    }
    return { ...meta, mode: "auto", inventoryUsd: inventoryTarget, skinLines: [] };
  }

  if (skinLines.length >= 5 && skinLines.length <= 7) {
    return { ...meta, mode: "manual", skinLines };
  }

  return {
    error: `Нужно указать сумму MaFile или 5–7 строк со скинами. Сейчас строк скинов: ${skinLines.length}.`,
  };
}

const FAKE_STEAM_PROFIT_SKINS_INSTRUCTION_HTML = [
  "<b>Фейк-профит</b>",
  "",
  "Отправьте <b>сумму найденного MaFile</b> — одной строкой или с метой:",
  "<code>сумма: 850.00",
  "тег: aelita",
  "баланс: 300.00",
  "mafile: 39",
  "игры: 4</code>",
  "",
  "Для FAKE-TAG укажите <code>тег:</code> (до 6 символов) или оставьте пустым — выпадет случайный.",
  "Бот сам подберёт <b>5 скинов</b> из базы под сумму инвентаря.",
  "Опционально: ручной режим — 5–7 строк со скинами Steam Market.",
].join("\n");

module.exports = {
  normalizeSteamIconHash,
  tryParseLegacySkinLine,
  parseFakeSteamProfitMeta,
  buildFakeProfitGames,
  FAKE_STEAM_PROFIT_SKINS_INSTRUCTION_HTML,
};
