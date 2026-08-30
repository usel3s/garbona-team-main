const path = require("path");
const axios = require("axios");
const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");
const { loadBrandLogoImage } = require("./brandLogoLoader");
const { loadLocalImage } = require("./safeImageLoader");

const WIDTH = 1600;
const HEIGHT = 900;
const ASSETS_DIR = path.join(__dirname, "../../assets/steam-log");
const FALLBACK_GAME_PATH = path.join(ASSETS_DIR, "game-cs2.png");
const FONT_PATH = path.join(__dirname, "../../assets/fonts/NotoSans-Bold.ttf");
const FONT_FAMILY = "GarbonaLogCard";
const IMAGE_HEADERS = {
  "User-Agent": "Mozilla/5.0",
  Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
};

let fontReady = false;

function ensureFont() {
  if (fontReady) return;
  try {
    fontReady = GlobalFonts.registerFromPath(FONT_PATH, FONT_FAMILY);
  } catch (_) {
    fontReady = false;
  }
}

function font(size, weight = 700) {
  ensureFont();
  return `${weight} ${size}px ${fontReady ? `"${FONT_FAMILY}"` : "sans-serif"}`;
}

function rounded(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fillRounded(ctx, x, y, w, h, r, color) {
  ctx.fillStyle = color;
  rounded(ctx, x, y, w, h, r);
  ctx.fill();
}

function fitText(ctx, value, maxWidth) {
  let text = String(value ?? "—").replace(/\s+/g, " ").trim() || "—";
  if (ctx.measureText(text).width <= maxWidth) return text;
  while (text.length > 1 && ctx.measureText(`${text}…`).width > maxWidth) {
    text = text.slice(0, -1).trimEnd();
  }
  return `${text}…`;
}

function formatMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return `$${Math.max(0, num).toFixed(2)}`;
}

function formatDateRu(value) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatLimit(account) {
  const locked = Number(account?.inventory?.price?.locked || 0);
  const lockedDate = Number(account?.inventory?.price?.lockedDate || 0);
  if (lockedDate > 0) {
    const ms = lockedDate > 1e12 ? lockedDate : lockedDate * 1000;
    return formatDateRu(ms);
  }
  if (locked > 0) return formatMoney(locked);
  return "Нет лимита";
}

function formatBalance(account) {
  const steam = account?.steamInfo || {};
  if (steam.balanceUsd != null && Number.isFinite(Number(steam.balanceUsd))) {
    return formatMoney(steam.balanceUsd);
  }
  if (steam.balance != null && Number.isFinite(Number(steam.balance))) {
    const value = formatMoney(steam.balance);
    const currency = String(steam.balanceCurrency || "USD").trim();
    return currency && currency !== "USD" ? `${value} ${currency}` : value;
  }
  return "$0.00";
}

function inventoryPrice(account) {
  const price = account?.inventory?.price || {};
  const raw =
    price.tradable != null
      ? price.tradable
      : price.marketable != null
        ? price.marketable
        : price.total != null
          ? price.total
          : 0;
  return Math.max(0, Number(raw) || 0);
}

function balancePrice(account) {
  const steam = account?.steamInfo || {};
  if (steam.balanceUsd != null && Number.isFinite(Number(steam.balanceUsd))) return Math.max(0, Number(steam.balanceUsd));
  if (steam.balance != null && Number.isFinite(Number(steam.balance))) return Math.max(0, Number(steam.balance));
  return 0;
}

function formatInventory(account) {
  return formatMoney(inventoryPrice(account));
}

function formatTotal(account) {
  return formatMoney(balancePrice(account) + inventoryPrice(account));
}

function formatLevel(account) {
  const level = account?.steamInfo?.level;
  return level == null || level === "" ? "—" : `${level} LVL`;
}

function formatLastActive(account) {
  const value = account?.steamInfo?.lastPlayed || account?.steamInfo?.lastActive;
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return formatDateRu(date);

  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${Math.max(1, mins)} мин назад`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days} дн назад`;
  return formatDateRu(date);
}

function listGamesForBanner(account) {
  const games = Array.isArray(account?.gamesInfo)
    ? account.gamesInfo.filter(Boolean)
    : Array.isArray(account?.games)
      ? account.games.filter(Boolean)
      : Array.isArray(account?.ownedGames)
        ? account.ownedGames.filter(Boolean)
        : [];
  if (!games.length) return [];
  return [...games].sort((a, b) => {
    const aCs = Number(a.appid || a.appId) === 730 || /counter.?strike/i.test(String(a.name || ""));
    const bCs = Number(b.appid || b.appId) === 730 || /counter.?strike/i.test(String(b.name || ""));
    if (aCs !== bCs) return Number(bCs) - Number(aCs);
    return Number(b.playtime || b.playtime_forever || 0) - Number(a.playtime || a.playtime_forever || 0);
  });
}

function pickPrimaryGame(account) {
  return listGamesForBanner(account)[0] || null;
}

function gameImageUrls(game) {
  const appid = Number(game?.appid || game?.appId || 0);
  const icon = String(game?.icon || "").trim();
  const image = String(game?.imageUrl || game?.image_url || game?.header_image || game?.capsule_image || "").trim();
  const urls = [];
  if (/^https?:\/\//i.test(image)) urls.push(image);
  if (Number.isFinite(appid) && appid > 0) {
    urls.push(
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/capsule_231x87.jpg`,
      `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appid}/capsule_231x87.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`
    );
    if (icon) urls.push(`https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/${appid}/${icon}.jpg`);
  }
  return [...new Set(urls)];
}

async function loadRemoteImage(url) {
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 8000,
    headers: IMAGE_HEADERS,
    validateStatus: (s) => s >= 200 && s < 300,
  });
  return loadImage(Buffer.from(response.data));
}

async function loadSingleGameImage(game) {
  if (!game) return null;
  for (const url of gameImageUrls(game)) {
    try {
      return await loadRemoteImage(url);
    } catch (_) {
      // try next image host
    }
  }
  return null;
}

async function loadFallbackGameImage(game) {
  const image = await loadLocalImage(FALLBACK_GAME_PATH);
  return image ? [{ image, game: game || null }] : [];
}

async function loadGameImages(account) {
  const games = listGamesForBanner(account).slice(0, 5);
  if (!games.length) return loadFallbackGameImage(null);

  const loaded = await Promise.all(games.map(async (game) => ({ game, image: await loadSingleGameImage(game) })));
  const ok = loaded.filter((item) => item.image);
  if (ok.length) return ok;

  return loadFallbackGameImage(games[0]);
}

async function loadBrandLogo() {
  return loadBrandLogoImage();
}

function drawBrand(ctx, logo) {
  if (logo) {
    const aspect = logo.width / Math.max(1, logo.height);
    if (aspect > 1.15) ctx.drawImage(logo, 54, 46, 124, 82);
    else ctx.drawImage(logo, 54, 46, 82, 82);
  }
  ctx.fillStyle = "#17243A";
  ctx.font = font(31);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("GARBONA", 192, 77);
  ctx.fillStyle = "#74839B";
  ctx.font = font(19);
  ctx.fillText("TEAM", 194, 108);
}

function drawIcon(ctx, type, cx, cy, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (type === "limit") {
    rounded(ctx, cx - 16, cy - 19, 32, 38, 8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 7, cy - 25);
    ctx.arcTo(cx, cy - 33, cx + 7, cy - 25, 8);
    ctx.stroke();
  } else if (type === "wallet") {
    rounded(ctx, cx - 23, cy - 15, 46, 30, 8);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + 12, cy, 3, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === "bag") {
    rounded(ctx, cx - 18, cy - 13, 36, 31, 8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 9, cy - 13);
    ctx.arcTo(cx, cy - 30, cx + 9, cy - 13, 10);
    ctx.stroke();
  } else if (type === "level") {
    ctx.beginPath();
    ctx.arc(cx, cy, 21, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = font(22);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("L", cx, cy + 1);
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, 20, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - 10);
    ctx.lineTo(cx, cy + 1);
    ctx.lineTo(cx + 10, cy + 8);
    ctx.stroke();
  }
  ctx.restore();
}

function drawStatCard(ctx, stat, x, y, w, h) {
  ctx.save();
  ctx.shadowColor = "rgba(32,55,88,.12)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 10;
  fillRounded(ctx, x, y, w, h, 20, "#FFFFFF");
  ctx.restore();

  ctx.save();
  rounded(ctx, x, y, w, h, 20);
  ctx.clip();
  const bg = ctx.createLinearGradient(x, y, x + w, y + h);
  bg.addColorStop(0, "#FFFFFF");
  bg.addColorStop(1, "#F4F8FD");
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  const glow = ctx.createRadialGradient(x + w - 35, y + 20, 5, x + w - 35, y + 20, w * .7);
  glow.addColorStop(0, `${stat.color}20`);
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(x, y, w, h);
  ctx.restore();

  fillRounded(ctx, x + 22, y + 22, 58, 58, 18, `${stat.color}14`);
  drawIcon(ctx, stat.icon, x + 51, y + 51, stat.color);

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#7A8799";
  ctx.font = font(18);
  ctx.fillText(stat.label, x + 22, y + 104);
  ctx.fillStyle = "#17243A";
  ctx.font = font(stat.valueSize || 31);
  ctx.fillText(fitText(ctx, stat.value, w - 44), x + 22, y + 135, w - 44);
  ctx.fillStyle = stat.color;
  ctx.fillRect(x, y + h - 8, w, 8);
}

function drawGame(ctx, image, x, y, w, h) {
  ctx.save();
  ctx.shadowColor = "rgba(32,55,88,.12)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 5;
  fillRounded(ctx, x, y, w, h, 13, "#E9EEF5");
  ctx.restore();

  if (!image) return;
  ctx.save();
  rounded(ctx, x, y, w, h, 13);
  ctx.clip();
  const scale = Math.max(w / image.width, h / image.height);
  const dw = image.width * scale;
  const dh = image.height * scale;
  ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

function drawGamesOverflow(ctx, x, y, h, extra) {
  if (extra <= 0) return;
  fillRounded(ctx, x, y, 82, h, 13, "#EDF2F8");
  ctx.fillStyle = "#74839B";
  ctx.font = font(24);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`+${extra}`, x + 41, y + h / 2);
}

function accountCountry(account) {
  return String(account?.steamInfo?.country || account?.country || "").trim();
}

function accountName(account) {
  return String(account?.username || account?.steamInfo?.nickname || account?.steamInfo?.steamid || account?.id || "Steam аккаунт").trim();
}

function accountChip(account) {
  const parts = [];
  const country = accountCountry(account);
  if (country) parts.push(country);
  const level = formatLevel(account);
  if (level !== "—") parts.push(level);
  const name = accountName(account);
  return parts.length ? `${name}  ·  ${parts.join(" · ")}` : name;
}

/** Светлая premium-карточка для валидного Steam-лога в стиле новой MaFile-пикчи. */
async function renderSteamLogImage(account = {}) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  bg.addColorStop(0, "#FFFFFF");
  bg.addColorStop(.55, "#F6F9FD");
  bg.addColorStop(1, "#F2F8F7");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = "rgba(82,184,255,.10)";
  ctx.beginPath();
  ctx.arc(1525, 38, 315, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(103,220,112,.09)";
  ctx.beginPath();
  ctx.arc(30, 875, 285, 0, Math.PI * 2);
  ctx.fill();

  drawBrand(ctx, await loadBrandLogo());

  fillRounded(ctx, 1260, 55, 264, 56, 28, "#EAF7F0");
  ctx.fillStyle = "#2EBA76";
  ctx.font = font(22);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("NEW LOG", 1392, 83);

  ctx.fillStyle = "#17243A";
  ctx.font = font(64);
  ctx.textAlign = "center";
  ctx.fillText("Получен новый лог", WIDTH / 2, 160);

  ctx.font = font(23);
  const chipText = fitText(ctx, accountChip(account), 640);
  const chipW = Math.min(710, Math.max(310, ctx.measureText(chipText).width + 56));
  fillRounded(ctx, WIDTH / 2 - chipW / 2, 195, chipW, 52, 26, "#FFFFFF");
  ctx.fillStyle = "#74839B";
  ctx.fillText(chipText, WIDTH / 2, 221);

  const stats = [
    { label: "ЛИМИТ", value: formatLimit(account), icon: "limit", color: "#55C86A" },
    { label: "БАЛАНС STEAM", value: formatBalance(account), icon: "wallet", color: "#2BB8F0" },
    { label: "ИНВЕНТАРЬ", value: formatInventory(account), icon: "bag", color: "#55C86A" },
    { label: "УРОВЕНЬ", value: formatLevel(account), icon: "level", color: "#745FD1" },
    { label: "АКТИВНОСТЬ", value: formatLastActive(account), icon: "clock", color: "#EF9B3E", valueSize: 27 },
  ];

  const cardW = 265;
  const cardH = 206;
  const gap = 22;
  const startX = (WIDTH - (stats.length * cardW + (stats.length - 1) * gap)) / 2;
  stats.forEach((stat, i) => drawStatCard(ctx, stat, startX + i * (cardW + gap), 300, cardW, cardH));

  const gameImages = await loadGameImages(account);
  const allGames = listGamesForBanner(account);
  const shownGames = gameImages.slice(0, 5);
  const knownTotal = Math.max(Number(account?.gamesCount || account?.gameCount || 0) || 0, allGames.length);
  if (shownGames.length || knownTotal > 0) {
    ctx.fillStyle = "#708097";
    ctx.font = font(20);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("ИГРЫ АККАУНТА", 98, 612);
    shownGames.forEach((item, i) => drawGame(ctx, item.image, 98 + i * 184, 642, 164, 72));

    const extra = Math.max(0, knownTotal - shownGames.length);
    const overflowX = 98 + shownGames.length * 184;
    if (extra > 0 && overflowX + 82 <= 1018) drawGamesOverflow(ctx, overflowX, 642, 72, extra);
  }

  ctx.save();
  ctx.shadowColor = "rgba(32,55,88,.14)";
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 7;
  fillRounded(ctx, 1070, 586, 360, 150, 24, "#FFFFFF");
  ctx.restore();
  ctx.fillStyle = "#74839A";
  ctx.font = font(18);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("ОБЩАЯ СУММА ЛОГА", 1250, 624);
  ctx.fillStyle = "#17243A";
  ctx.font = font(48);
  ctx.fillText(formatTotal(account), 1250, 668);

  ctx.fillStyle = "#75849A";
  ctx.font = font(17);
  ctx.fillText("GARBONA • TEAM", WIDTH / 2, 858);

  return canvas.toBuffer("image/png");
}

module.exports = {
  renderSteamLogImage,
  formatLimit,
  formatBalance,
  formatInventory,
  formatLevel,
  formatLastActive,
  pickPrimaryGame,
  listGamesForBanner,
};
