const { pe } = require("./emoji");

const FAKE_STEAM_LOG_INSTRUCTION_HTML = [
  `${pe("package")} <b>Фейк-лог</b>`,
  "",
  "Отправьте поля <b>по одному на строку</b> (можно с подписями):",
  "",
  "<code>лимит: Нет",
  "баланс: 12.50",
  "инвентарь: 150.00",
  "уровень: 42",
  "актив: 2024-08-15",
  "игры: 8</code>",
  "",
  "Или без подписей — ровно 6 строк в том же порядке.",
  "Лимит: <code>Нет</code>, сумма (<code>$10</code>) или дата.",
  "Актив: дата (<code>YYYY-MM-DD</code> или как в панели).",
  "Игры: число (на карточке будет иконка CS2 / игры из лога).",
].join("\n");

function parseMoneyLoose(raw) {
  const cleaned = String(raw || "")
    .trim()
    .replace(/^\$/, "")
    .replace(/\s/g, "")
    .replace(",", ".");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function parseDateLoose(raw) {
  const text = String(raw || "").trim();
  if (!text || /^нет$/i.test(text) || text === "—") return null;
  const iso = Date.parse(text);
  if (!Number.isNaN(iso)) return new Date(iso).toISOString();
  const m = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    const d = new Date(Number(year), Number(m[2]) - 1, Number(m[1]));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return text;
}

function stripLabel(line) {
  const m = String(line || "").match(
    /^(лимит|баланс|инвентар(?:ь|я)?|уровень|lvl|актив|игры)\s*[:=]\s*(.+)$/i
  );
  return m ? { key: m[1].toLowerCase(), value: m[2].trim() } : null;
}

function mapKey(key) {
  if (/^лимит/.test(key)) return "limit";
  if (/^баланс/.test(key)) return "balance";
  if (/^инвентар/.test(key)) return "inventory";
  if (/^(уровень|lvl)/.test(key)) return "level";
  if (/^актив/.test(key)) return "lastActive";
  if (/^игры/.test(key)) return "games";
  return null;
}

/**
 * @returns {{ account: object } | { error: string }}
 */
function parseFakeSteamLogInput(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (!lines.length) {
    return { error: "Пустой ввод. Нужны 6 полей лога." };
  }

  const values = {
    limit: null,
    balance: null,
    inventory: null,
    level: null,
    lastActive: null,
    games: null,
  };

  const labeled = lines.map(stripLabel).filter(Boolean);
  if (labeled.length >= 4) {
    for (const item of labeled) {
      const field = mapKey(item.key);
      if (field) values[field] = item.value;
    }
  } else if (lines.length >= 6) {
    values.limit = lines[0];
    values.balance = lines[1];
    values.inventory = lines[2];
    values.level = lines[3];
    values.lastActive = lines[4];
    values.games = lines[5];
  } else {
    return {
      error: "Нужно 6 строк (лимит, баланс, инвентарь, уровень, актив, игры) или поля с подписями.",
    };
  }

  const limitRaw = String(values.limit ?? "Нет").trim() || "Нет";
  const balance = parseMoneyLoose(values.balance);
  const inventory = parseMoneyLoose(values.inventory);
  const levelNum = Number(String(values.level ?? "").replace(/[^\d.-]/g, ""));
  const gamesNum = Number(String(values.games ?? "").replace(/[^\d.-]/g, ""));
  const lastPlayed = parseDateLoose(values.lastActive);

  if (balance == null) return { error: "Некорректный баланс." };
  if (inventory == null) return { error: "Некорректная цена инвентаря." };
  if (!Number.isFinite(levelNum) || levelNum < 0) return { error: "Некорректный уровень Steam." };
  if (!Number.isFinite(gamesNum) || gamesNum < 0) return { error: "Некорректное число игр." };

  let locked = 0;
  let lockedDate = 0;
  if (!/^нет$/i.test(limitRaw) && limitRaw !== "—") {
    const money = parseMoneyLoose(limitRaw);
    if (money != null) {
      locked = money;
    } else {
      const dateIso = parseDateLoose(limitRaw);
      if (dateIso && !Number.isNaN(Date.parse(dateIso))) {
        lockedDate = Math.floor(Date.parse(dateIso) / 1000);
      } else {
        return { error: "Лимит: укажите «Нет», сумму или дату." };
      }
    }
  }

  return {
    account: {
      username: "fake_log",
      gameCount: gamesNum,
      gamesInfo:
        gamesNum > 0
          ? [{ appid: 730, name: "Counter-Strike 2", icon: "8dbc71957312bbd3baea65848b545be9eae2a355", playtime: 1 }]
          : [],
      steamInfo: {
        balanceUsd: balance,
        balance,
        balanceCurrency: "USD",
        level: levelNum,
        lastPlayed: lastPlayed || null,
        nickname: "Fake Log",
      },
      inventory: {
        price: {
          total: inventory,
          locked,
          lockedDate,
          tradable: inventory,
          marketable: inventory,
        },
      },
    },
  };
}

module.exports = {
  FAKE_STEAM_LOG_INSTRUCTION_HTML,
  parseFakeSteamLogInput,
};
