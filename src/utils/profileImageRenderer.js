const path = require("path");
const { createCanvas, GlobalFonts } = require("@napi-rs/canvas");
const { loadLocalImage } = require("./safeImageLoader");

const WIDTH = 1672;
const HEIGHT = 941;
const ASSETS_DIR = path.join(__dirname, "../../assets/profile");
const FONT_PATH = path.join(__dirname, "../../assets/fonts/NotoSans-Bold.ttf");
const FONT_FAMILY = "ProfileSans";

/** Макс. ширина колонки значений (не залезать на лейблы). */
const VALUE_MAX_WIDTH = 460;
const VALUE_CENTER = 1080;
const FONT_SIZE = 52;
const FONT_SIZE_MIN = 24;
const NICK_LINE_GAP = 34;

const SLOTS = {
  days: { y: 348 },
  nickname: { y: 460 },
  count: { y: 572 },
  total: { y: 684 },
  max: { y: 796 },
};

let fontReady = false;

function ensureFont() {
  if (fontReady) return;
  try {
    GlobalFonts.registerFromPath(FONT_PATH, FONT_FAMILY);
    fontReady = true;
  } catch (_) {
    fontReady = false;
  }
}

function fontCss(size = FONT_SIZE, weight = "700") {
  ensureFont();
  if (fontReady) return `${weight} ${size}px "${FONT_FAMILY}"`;
  return `${weight} ${size}px Arial, "Segoe UI", sans-serif`;
}

function formatMoney(value) {
  return Number(value || 0).toFixed(2);
}

function ellipsize(ctx, text, maxWidth) {
  const raw = String(text || "");
  if (ctx.measureText(raw).width <= maxWidth) return raw;
  const ellipsis = "…";
  let low = 0;
  let high = raw.length;
  let best = ellipsis;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = `${raw.slice(0, mid)}${ellipsis}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

function wrapTwoLines(ctx, text, maxWidth, allowEllipsis = false) {
  const raw = String(text || "").trim() || "—";
  const words = raw.split(/\s+/).filter(Boolean);

  if (words.length >= 2) {
    let best = null;
    for (let i = 1; i < words.length; i += 1) {
      const line1 = words.slice(0, i).join(" ");
      let line2 = words.slice(i).join(" ");
      if (ctx.measureText(line1).width > maxWidth) continue;
      if (ctx.measureText(line2).width > maxWidth) {
        if (!allowEllipsis) continue;
        line2 = ellipsize(ctx, line2, maxWidth);
      }
      const score = Math.abs(
        ctx.measureText(line1).width - ctx.measureText(line2).width
      );
      if (!best || score < best.score) best = { lines: [line1, line2], score };
    }
    if (best) return best.lines;
  }

  if (!allowEllipsis) return null;

  const spaceCut = raw.lastIndexOf(" ", Math.ceil(raw.length * 0.65));
  const cut =
    spaceCut > Math.floor(raw.length * 0.3)
      ? spaceCut
      : Math.ceil(raw.length / 2);
  return [
    ellipsize(ctx, raw.slice(0, cut).trimEnd(), maxWidth),
    ellipsize(ctx, raw.slice(cut).trimStart(), maxWidth),
  ];
}

/**
 * Подгонка ника: уменьшение кегля → 2 строки → обрезка с «…».
 * @returns {{ lines: string[], size: number }}
 */
function fitNickname(ctx, text, maxWidth, maxSize = FONT_SIZE, minSize = FONT_SIZE_MIN) {
  const raw = String(text || "—").trim() || "—";

  for (let size = maxSize; size >= minSize; size -= 2) {
    ctx.font = fontCss(size);
    if (ctx.measureText(raw).width <= maxWidth) {
      return { lines: [raw], size };
    }
  }

  for (let size = maxSize; size >= minSize; size -= 2) {
    ctx.font = fontCss(size);
    const lines = wrapTwoLines(ctx, raw, maxWidth, false);
    if (lines) return { lines, size };
  }

  ctx.font = fontCss(minSize);
  return {
    lines: wrapTwoLines(ctx, raw, maxWidth, true) || [
      ellipsize(ctx, raw, maxWidth),
    ],
    size: minSize,
  };
}

function drawShadowed(ctx, text, x, y, fillStyle, size = FONT_SIZE) {
  ctx.font = fontCss(size);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillText(String(text), x + 2, y + 2);
  ctx.fillStyle = fillStyle;
  ctx.fillText(String(text), x, y);
}

function drawPlain(ctx, text, y, size = FONT_SIZE) {
  drawShadowed(ctx, text, VALUE_CENTER, y, "#FFFFFF", size);
}

function drawNickname(ctx, lines, size, centerY) {
  if (lines.length === 1) {
    drawPlain(ctx, lines[0], centerY, size);
    return;
  }
  const top = centerY - Math.round(NICK_LINE_GAP / 2);
  const bottom = centerY + Math.round(NICK_LINE_GAP / 2);
  drawPlain(ctx, lines[0], top, size);
  drawPlain(ctx, lines[1], bottom, size);
}

function drawMoney(ctx, amount, y) {
  const amountText = formatMoney(amount);
  ctx.font = fontCss(FONT_SIZE);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  const amountWidth = ctx.measureText(amountText).width;
  const dollarWidth = ctx.measureText("$").width;
  const totalWidth = dollarWidth + amountWidth;
  const left = VALUE_CENTER - totalWidth / 2;

  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillText("$", left + 2, y + 2);
  ctx.fillText(amountText, left + dollarWidth + 2, y + 2);

  const gradient = ctx.createLinearGradient(left, y - 40, left + 36, y + 8);
  gradient.addColorStop(0, "#59CD53");
  gradient.addColorStop(1, "#28AD82");
  ctx.fillStyle = gradient;
  ctx.fillText("$", left, y);

  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(amountText, left + dollarWidth, y);
}

/**
 * Карточка профиля по макету Figma (1672×941).
 * @param {{ days: number, nickname: string, count: number, totalShare: number, maxShare: number }} data
 */
async function renderProfileImage(data) {
  ensureFont();
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  const bg = await loadLocalImage(path.join(ASSETS_DIR, "bg.png"));
  if (bg) {
    ctx.drawImage(bg, 0, 0, WIDTH, HEIGHT);
  } else {
    ctx.fillStyle = "#05070c";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  const days = Math.max(0, Number(data?.days) || 0);
  const count = Math.max(0, Number(data?.count) || 0);
  const totalShare = Number(data?.totalShare) || 0;
  const maxShare = Number(data?.maxShare) || 0;
  const nick = fitNickname(ctx, data?.nickname || "—", VALUE_MAX_WIDTH);

  drawPlain(ctx, String(days), SLOTS.days.y);
  drawNickname(ctx, nick.lines, nick.size, SLOTS.nickname.y);
  drawPlain(ctx, String(count), SLOTS.count.y);
  drawMoney(ctx, totalShare, SLOTS.total.y);
  drawMoney(ctx, maxShare, SLOTS.max.y);

  return canvas.toBuffer("image/png");
}

module.exports = { renderProfileImage, formatMoney, fitNickname };
