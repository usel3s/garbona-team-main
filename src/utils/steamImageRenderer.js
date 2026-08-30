const path = require("path");
const axios = require("axios");
const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");
const { loadBrandLogoImage } = require("./brandLogoLoader");

const WIDTH = 1600;
const HEIGHT = 900;
const FONT_PATH = path.join(__dirname, "../../assets/fonts/NotoSans-Bold.ttf");
const FONT_FAMILY = "GarbonaCard";
const IMAGE_HEADERS = { "User-Agent": "Mozilla/5.0", Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8" };
const STEAM_ICON_HOSTS = ["https://community.cloudflare.steamstatic.com/economy/image/", "https://community.steamstatic.com/economy/image/"];
let fontReady = false;

function ensureFont() { if (!fontReady) try { fontReady = GlobalFonts.registerFromPath(FONT_PATH, FONT_FAMILY); } catch (_) { fontReady = false; } }
function font(size, weight = 700) { ensureFont(); return `${weight} ${size}px ${fontReady ? `"${FONT_FAMILY}"` : "sans-serif"}`; }
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
function money(value) { return `$${Math.max(0, parseUsdNumber(value)).toFixed(2)}`; }
function itemPriceValue(item) {
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
function gamePlaytimeValue(game) {
  const raw =
    game?.playtime_forever ??
    game?.playtimeForever ??
    game?.playtime ??
    game?.totalPlaytime ??
    game?.total_playtime ??
    game?.hours ??
    0;
  return Math.max(0, Number(raw) || 0);
}
function sortedMafileItems(items) {
  return (Array.isArray(items) ? items : [])
    .filter(Boolean)
    .map((item) => ({ ...item, price: itemPriceValue(item) }))
    .filter((item) => item.price > 0)
    .sort((a, b) => b.price - a.price);
}
function sortedMafileGames(games) {
  return (Array.isArray(games) ? games : [])
    .filter(Boolean)
    .sort((a, b) => gamePlaytimeValue(b) - gamePlaytimeValue(a));
}
function shorten(value, max) {
  const text = String(value || "Неизвестный предмет").replace(/^★\s*/, "").replace(/[™®]/g, "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
function skinName(value) {
  const clean = String(value || "Скин")
    .replace(/^★\s*/, "")
    .replace(/[™®]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const parts = clean.split("|").map((part) => part.trim()).filter(Boolean);
  return (parts.length > 1 ? parts[parts.length - 1] : clean)
    .replace(/\s*\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/i, "")
    .trim();
}
function fitText(ctx, value, maxWidth) {
  const text = String(value || "");
  if (ctx.measureText(text).width <= maxWidth) return text;
  let fitted = text;
  while (fitted.length > 1 && ctx.measureText(`${fitted}…`).width > maxWidth) fitted = fitted.slice(0, -1).trimEnd();
  return `${fitted}…`;
}
function formatMaFileTime(value, now = Date.now()) {
  if (value == null || value === "") return "";
  const direct = Number(value);
  if (Number.isFinite(direct) && direct > 0 && direct < 10000) return `${Math.ceil(direct)} ч`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const hours = Math.ceil((date.getTime() - now) / 3600000);
  return hours > 0 ? `${hours} ч` : "";
}
function rounded(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function fillRounded(ctx, x, y, w, h, r, color) { ctx.fillStyle = color; rounded(ctx, x, y, w, h, r); ctx.fill(); }
function normalizeHash(raw) { const value = String(raw || "").trim(); return value.match(/economy\/image\/([^/?#]+)/i)?.[1] || value.replace(/\/\d+fx\d+f$/i, ""); }
function iconUrls(item) {
  const raw =
    item?.icon ||
    item?.icon_url ||
    item?.iconUrl ||
    item?.image ||
    item?.imageUrl ||
    item?.asset_description?.icon_url ||
    item?.assetDescription?.icon_url ||
    item?.description?.icon_url ||
    "";
  const hash = normalizeHash(raw);
  const urls = /^https?:\/\//i.test(raw) ? [raw] : [];
  if (hash && !/^https?:/i.test(hash)) for (const host of STEAM_ICON_HOSTS) urls.push(`${host}${hash}/360fx360f`);
  return [...new Set(urls)];
}
async function loadRemote(url) {
  const response = await axios.get(url, { responseType: "arraybuffer", timeout: 8000, headers: IMAGE_HEADERS });
  return loadImage(Buffer.from(response.data));
}
async function imageForItem(item) { for (const url of iconUrls(item)) try { return await loadRemote(url); } catch (_) { /* try next image */ } return null; }
async function loadBrandLogo() {
  return loadBrandLogoImage();
}
function drawBrand(ctx, logo) {
  if (logo) {
    const aspect = logo.width / Math.max(1, logo.height);
    if (aspect > 1.15) ctx.drawImage(logo, 54, 46, 124, 82);
    else ctx.drawImage(logo, 54, 46, 82, 82);
  }
  ctx.fillStyle = "#17243A"; ctx.font = font(31); ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText("GARBONA", 192, 77);
  ctx.fillStyle = "#74839B"; ctx.font = font(19); ctx.fillText("TEAM", 194, 108);
}
function skinAccent(item) {
  const name = String(item?.itemHashName || item?.market_hash_name || item?.hash_name || item?.name || "").toLowerCase();
  if (/agent|officer|operator|soldier|slingshot/.test(name)) return "#3D7CFF";
  if (/ak-47|m4a1|m4a4|point disarray|neon/.test(name)) return "#D935EF";
  return "#EF5350";
}
function drawItem(ctx, item, image, x, y, w, h) {
  const accent = skinAccent(item);
  ctx.save(); ctx.shadowColor = "rgba(32,55,88,.14)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 10; fillRounded(ctx, x, y, w, h, 20, "#FFFFFF"); ctx.restore();
  ctx.save(); rounded(ctx, x, y, w, h, 16); ctx.clip();
  const bg = ctx.createLinearGradient(x, y, x + w, y + h); bg.addColorStop(0, "#F7FAFE"); bg.addColorStop(1, "#F1F5FA"); ctx.fillStyle = bg; ctx.fillRect(x, y, w, h * .75);
  const glow = ctx.createRadialGradient(x + w / 2, y + h * .34, 10, x + w / 2, y + h * .34, w * .72); glow.addColorStop(0, `${accent}24`); glow.addColorStop(1, "rgba(255,255,255,0)"); ctx.fillStyle = glow; ctx.fillRect(x, y, w, h * .75);
  if (image) { const side = Math.min(w * .92, h * .6); const scale = Math.min(side / image.width, side / image.height); ctx.drawImage(image, x + (w - image.width * scale) / 2, y + 18 + (h * .57 - image.height * scale) / 2, image.width * scale, image.height * scale); }
  ctx.restore();
  ctx.fillStyle = "#17243A"; ctx.font = font(32); ctx.textAlign = "left"; ctx.fillText(money(item?.price), x + 20, y + h - 61);
  ctx.fillStyle = "#65738A"; ctx.font = font(20); ctx.fillText(fitText(ctx, skinName(item?.itemHashName || item?.market_hash_name || item?.hash_name || item?.name), w - 40), x + 20, y + h - 25);
  ctx.fillStyle = accent; ctx.fillRect(x, y + h - 8, w, 8);
}
function gameImageUrls(game) {
  const appid = Number(game?.appid || game?.appId || 0);
  const icon = String(game?.icon || game?.img_icon_url || game?.imgIconUrl || "").trim();
  const image = String(game?.imageUrl || game?.image_url || game?.header_image || game?.capsule_image || "").trim();
  const urls = [];
  if (/^https?:\/\//i.test(image)) urls.push(image);
  if (Number.isFinite(appid) && appid > 0) {
    urls.push(
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/capsule_231x87.jpg`,
      `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appid}/capsule_231x87.jpg`,
      `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/capsule_231x87.jpg`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`,
      `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`
    );
    if (icon && !/^https?:\/\//i.test(icon)) {
      urls.push(`https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/${appid}/${icon}.jpg`);
    } else if (/^https?:\/\//i.test(icon)) {
      urls.push(icon);
    }
  }
  return [...new Set(urls)];
}
async function imageForGame(game) { for (const url of gameImageUrls(game)) try { return await loadRemote(url); } catch (_) { /* try next image */ } return null; }
function drawGame(ctx, image, game, x, y, w, h) {
  ctx.save(); ctx.shadowColor = "rgba(32,55,88,.12)"; ctx.shadowBlur = 14; ctx.shadowOffsetY = 5; fillRounded(ctx, x, y, w, h, 12, "#E9EEF5"); ctx.restore();
  if (image) {
    ctx.save(); rounded(ctx, x, y, w, h, 12); ctx.clip(); const scale = Math.max(w / image.width, h / image.height); ctx.drawImage(image, x + (w - image.width * scale) / 2, y + (h - image.height * scale) / 2, image.width * scale, image.height * scale); ctx.restore();
    return;
  }
  const label = fitText(ctx, String(game?.name || game?.title || `App ${game?.appid || ""}`).trim() || "Game", w - 24);
  ctx.fillStyle = "#5B6B82";
  ctx.font = font(18);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + w / 2, y + h / 2);
}
function drawMafileTitle(ctx) {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#17243A";
  ctx.font = font(52);
  ctx.fillText("Найден", WIDTH / 2, 128);
  const titleGradient = ctx.createLinearGradient(WIDTH / 2 - 250, 0, WIDTH / 2 + 250, 0);
  titleGradient.addColorStop(0, "#55C86A");
  titleGradient.addColorStop(.5, "#20BEEB");
  titleGradient.addColorStop(1, "#745FD1");
  ctx.fillStyle = titleGradient;
  ctx.font = font(66);
  ctx.fillText("новый MaFile", WIDTH / 2, 210);
  ctx.restore();
}

/** Светлая премиальная карточка MaFile в палитре Garbona. */
async function renderSteamProfitImage({
  items = [],
  games = [],
  total = 0,
  balanceUsd = 0,
  inventoryUsd = null,
  mafileTime = "",
  workerShare = null,
  workerPercent = null,
} = {}) {
  const balance = Math.max(0, Number(balanceUsd) || 0);
  const inventory = inventoryUsd == null
    ? Math.max(0, Number(total) || 0)
    : Math.max(0, Number(inventoryUsd) || 0);
  const grandTotal = Math.max(0, Number(total) || balance + inventory);
  const share = workerShare == null ? null : Math.max(0, Number(workerShare) || 0);
  const sharePct = Math.max(1, Math.min(100, Number(workerPercent) || 70));
  const showBreakdown = balance > 0 || Math.abs(grandTotal - inventory) > 0.005;
  const totalBoxH = share > 0 ? 156 : 132;

  const canvas = createCanvas(WIDTH, HEIGHT); const ctx = canvas.getContext("2d");
  const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT); bg.addColorStop(0, "#FFFFFF"); bg.addColorStop(.55, "#F6F9FD"); bg.addColorStop(1, "#F2F8F7"); ctx.fillStyle = bg; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = "rgba(82,184,255,.10)"; ctx.beginPath(); ctx.arc(1525, 38, 315, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "rgba(103,220,112,.09)"; ctx.beginPath(); ctx.arc(30, 875, 285, 0, Math.PI * 2); ctx.fill();
  drawBrand(ctx, await loadBrandLogo());
  const mafileSuffix = formatMaFileTime(mafileTime); const mafileLabel = mafileSuffix ? `MaFile  ${mafileSuffix}` : "MaFile";
  fillRounded(ctx, 1260, 55, 264, 56, 28, "#EEEAFE"); ctx.fillStyle = "#745FD1"; ctx.font = font(22); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(mafileLabel, 1392, 83);
  drawMafileTitle(ctx);
  const visible = sortedMafileItems(items).slice(0, 5); const gap = 24; const cardW = 280; const cardH = 356; const startX = (WIDTH - (visible.length * cardW + Math.max(0, visible.length - 1) * gap)) / 2; const loaded = await Promise.all(visible.map(imageForItem));
  if (visible.length) visible.forEach((item, i) => drawItem(ctx, item, loaded[i], startX + i * (cardW + gap), 292, cardW, cardH)); else { fillRounded(ctx, 270, 298, 1060, 258, 24, "#FFFFFF"); ctx.fillStyle = "#8B98AA"; ctx.font = font(28); ctx.textAlign = "center"; ctx.fillText("Нет данных о предметах", WIDTH / 2, 432); }
  const shownGames = sortedMafileGames(games).slice(0, 4);
  if (shownGames.length) {
    const gameImages = await Promise.all(shownGames.map(imageForGame));
    ctx.fillStyle = "#708097";
    ctx.font = font(20);
    ctx.textAlign = "left";
    ctx.fillText("ИГРЫ АККАУНТА", 98, 714);
    shownGames.forEach((game, i) => drawGame(ctx, gameImages[i], game, 98 + i * 210, 735, 190, 74));
  }
  ctx.save(); ctx.shadowColor = "rgba(32,55,88,.14)"; ctx.shadowBlur = 22; ctx.shadowOffsetY = 7; fillRounded(ctx, 1070, 670, 360, totalBoxH, 24, "#FFFFFF"); ctx.restore();
  ctx.fillStyle = "#74839A"; ctx.font = font(18); ctx.textAlign = "center"; ctx.fillText("ОБЩАЯ СУММА", 1250, 704); ctx.fillStyle = "#17243A"; ctx.font = font(41); ctx.fillText(money(grandTotal), 1250, 748);
  if (showBreakdown) {
    ctx.fillStyle = "#728198"; ctx.font = font(14); ctx.fillText(`Баланс ${money(balance)}  ·  Инвентарь ${money(inventory)}`, 1250, 786);
  }
  if (share > 0) {
    ctx.fillStyle = "#5B8DEF"; ctx.font = font(15); ctx.fillText(`Доля воркера ${money(share)} (${Math.round(sharePct)}%)`, 1250, showBreakdown ? 818 : 786);
  }
  ctx.fillStyle = "#75849A"; ctx.font = font(17); ctx.fillText("GARBONA • MaFile", WIDTH / 2, 858);
  return canvas.toBuffer("image/png");
}

module.exports = { renderSteamProfitImage, money, iconUrls, skinName, formatMaFileTime, sortedMafileItems, sortedMafileGames };
