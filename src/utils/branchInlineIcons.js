const { createCanvas } = require("@napi-rs/canvas");
const axios = require("axios");
const { logger } = require("./logger");

const SIZE = 320;
const cache = new Map();

const PALETTE = {
  bg: "#0b0b0b",
  surface: "#141414",
  line: "#2a2a2a",
  green: "#2ee59d",
  greenSoft: "rgba(46, 229, 157, 0.16)",
  glow: "rgba(46, 229, 157, 0.35)",
  muted: "#8a8a8a",
};

function roundedTile(ctx) {
  ctx.fillStyle = PALETTE.bg;
  ctx.fillRect(0, 0, SIZE, SIZE);

  const glow = ctx.createRadialGradient(SIZE / 2, SIZE / 2, 12, SIZE / 2, SIZE / 2, 150);
  glow.addColorStop(0, PALETTE.glow);
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, SIZE, SIZE);

  const pad = 28;
  ctx.fillStyle = PALETTE.surface;
  ctx.beginPath();
  ctx.roundRect(pad, pad, SIZE - pad * 2, SIZE - pad * 2, 48);
  ctx.fill();
  ctx.strokeStyle = PALETTE.line;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function renderCreatePlusIcon() {
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");
  roundedTile(ctx);

  ctx.save();
  ctx.translate(SIZE / 2, SIZE / 2);
  ctx.strokeStyle = PALETTE.green;
  ctx.lineCap = "round";
  ctx.lineWidth = 28;
  ctx.shadowColor = PALETTE.glow;
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.moveTo(-52, 0);
  ctx.lineTo(52, 0);
  ctx.moveTo(0, -52);
  ctx.lineTo(0, 52);
  ctx.stroke();
  ctx.restore();

  return canvas.toBuffer("image/png");
}

function renderBranchMarkIcon() {
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");
  roundedTile(ctx);

  ctx.save();
  ctx.translate(SIZE / 2, SIZE / 2 + 8);
  ctx.fillStyle = PALETTE.green;
  ctx.shadowColor = PALETTE.glow;
  ctx.shadowBlur = 14;

  ctx.beginPath();
  ctx.arc(-28, -18, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(32, -10, 18, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(-28, 38, 40, 22, 0, Math.PI, 0);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(32, 40, 32, 18, 0, Math.PI, 0);
  ctx.fill();
  ctx.restore();

  return canvas.toBuffer("image/png");
}

async function uploadPublicPng(buffer, filename) {
  const form = new FormData();
  form.append("reqtype", "fileupload");
  form.append("fileToUpload", new Blob([buffer], { type: "image/png" }), filename);
  const res = await axios.post("https://catbox.moe/user/api.php", form, { timeout: 20000 });
  const url = String(res.data || "").trim();
  if (!/^https?:\/\//i.test(url)) return null;
  return url;
}

async function getBranchInlineThumb(kind) {
  const key = kind === "create" ? "create" : "branch";
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < 12 * 60 * 60 * 1000) {
    return cached;
  }

  const buffer = key === "create" ? renderCreatePlusIcon() : renderBranchMarkIcon();
  try {
    const url = await uploadPublicPng(buffer, `branch-${key}.png`);
    if (!url) return cached || null;
    const thumb = { url, width: SIZE, height: SIZE, at: Date.now() };
    cache.set(key, thumb);
    return thumb;
  } catch (error) {
    logger.warn("branch inline thumb upload failed", key, error.message);
    return cached || null;
  }
}

function applyInlineThumb(item, thumb) {
  if (!item || !thumb?.url) return item;
  item.thumbnail_url = thumb.url;
  item.thumbnail_width = thumb.width || SIZE;
  item.thumbnail_height = thumb.height || SIZE;
  return item;
}

module.exports = {
  renderCreatePlusIcon,
  renderBranchMarkIcon,
  getBranchInlineThumb,
  applyInlineThumb,
};
