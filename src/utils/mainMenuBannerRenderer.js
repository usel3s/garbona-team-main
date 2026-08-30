const path = require("path");
const { createCanvas, GlobalFonts } = require("@napi-rs/canvas");
const { loadBrandLogoImage } = require("./brandLogoLoader");

/** Telegram banner — cropped wide format, larger type for mobile preview */
const WIDTH = 1280;
const HEIGHT = 512;
/** Discord embed banner — wide short strip (~4.5:1), like channel headers */
const DISCORD_WIDTH = 1100;
const DISCORD_HEIGHT = 240;
const FONT_PATH = path.join(__dirname, "../../assets/fonts/NotoSans-Bold.ttf");
const FONT_FAMILY = "MainMenuSans";

const BRAND = {
  bg: "#090909",
  surface: "#111111",
  line: "#242424",
  lineSoft: "#1a1a1a",
  text: "#f2f2f2",
  muted: "#8a8a8a",
  faint: "#5c5c5c",
  green: "#2ee59d",
  greenSoft: "rgba(46, 229, 157, 0.12)",
  greenGlow: "rgba(46, 229, 157, 0.22)",
  blueGlow: "rgba(59, 158, 255, 0.18)",
  frameOuter: "rgba(255, 255, 255, 0.06)",
  markGlow: "rgba(46, 229, 157, 0.32)",
  markBorder: "rgba(46, 229, 157, 0.14)",
  logoShadow: "rgba(0, 0, 0, 0.45)",
  vignette: "rgba(0, 0, 0, 0.5)",
  gridAlpha: 0.2,
  accentLine: "rgba(46, 229, 157, 0.8)",
};

/** Access denied — dark banner with red accent */
const BRAND_DENIED = {
  bg: "#0c0c0c",
  surface: "#161616",
  line: "#2a2a2a",
  lineSoft: "#1c1c1c",
  text: "#f2f2f2",
  muted: "#8a8a8a",
  faint: "#5c5c5c",
  green: "#ff5c5c",
  greenSoft: "rgba(255, 92, 92, 0.14)",
  greenGlow: "rgba(255, 92, 92, 0.2)",
  blueGlow: "rgba(255, 92, 92, 0.08)",
  frameOuter: "rgba(255, 255, 255, 0.06)",
  markGlow: "rgba(255, 92, 92, 0.28)",
  markBorder: "rgba(255, 92, 92, 0.22)",
  logoShadow: "rgba(0, 0, 0, 0.45)",
  vignette: "rgba(0, 0, 0, 0.55)",
  gridAlpha: 0.22,
  accentLine: "rgba(255, 92, 92, 0.85)",
};

/** Test light theme — aligned with panel/worker/css/tokens.css [data-theme="light"] */
const BRAND_LIGHT = {
  bg: "#f5f5f5",
  surface: "#ffffff",
  line: "#e4e4e4",
  lineSoft: "#eeeeee",
  text: "#111111",
  muted: "#666666",
  faint: "#999999",
  green: "#1a9f6c",
  greenSoft: "rgba(26, 159, 108, 0.14)",
  greenGlow: "rgba(26, 159, 108, 0.16)",
  blueGlow: "rgba(36, 112, 196, 0.12)",
  frameOuter: "rgba(0, 0, 0, 0.06)",
  markGlow: "rgba(26, 159, 108, 0.22)",
  markBorder: "rgba(26, 159, 108, 0.22)",
  logoShadow: "rgba(26, 159, 108, 0.18)",
  vignette: "rgba(255, 255, 255, 0.35)",
  gridAlpha: 0.45,
  accentLine: "rgba(26, 159, 108, 0.75)",
};

/** Section key → banner title & output filename */
const MENU_SECTIONS = {
  home: { title: "Главное меню", file: "main-menu-banner.png" },
  wallet: { title: "Кошелёк", file: "menu-wallet-banner.png" },
  profile: { title: "Профиль", file: "menu-profile-banner.png" },
  top_workers: { title: "Топ воркеров", file: "menu-top-workers-banner.png" },
  curators: { title: "Кураторы", file: "menu-curators-banner.png" },
  branches: { title: "Филиалы", file: "menu-branches-banner.png" },
  about: { title: "О проекте", file: "menu-about-banner.png" },
  rules: { title: "ПРАВИЛА", file: "discord-rules-banner.png" },
  memo: { title: "MEMO", file: "discord-memo-banner.png" },
  discord_profile: { title: "PROFILE", file: "discord-profile-banner.png" },
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

function fontCss(size, weight = "700") {
  ensureFont();
  if (fontReady) return `${weight} ${size}px "${FONT_FAMILY}"`;
  return `${weight} ${size}px Inter, "Segoe UI", system-ui, sans-serif`;
}

function titleFontSize(title) {
  const len = String(title || "").length;
  if (len > 14) return 52;
  if (len > 11) return 58;
  return 64;
}

function resolvePalette(theme = "dark") {
  if (theme === "light") return BRAND_LIGHT;
  if (theme === "denied") return BRAND_DENIED;
  return BRAND;
}

function drawBackground(ctx, palette) {
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const glowA = ctx.createRadialGradient(WIDTH * 0.5, HEIGHT * 0.05, 0, WIDTH * 0.5, HEIGHT * 0.05, WIDTH * 0.38);
  glowA.addColorStop(0, palette.greenGlow);
  glowA.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glowA;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const glowB = ctx.createRadialGradient(WIDTH * 0.92, HEIGHT * 0.95, 0, WIDTH * 0.92, HEIGHT * 0.95, WIDTH * 0.28);
  glowB.addColorStop(0, palette.blueGlow);
  glowB.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glowB;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.save();
  ctx.globalAlpha = palette.gridAlpha;
  ctx.strokeStyle = palette.lineSoft;
  ctx.lineWidth = 1;
  const gridStep = 48;
  for (let x = 0; x <= WIDTH; x += gridStep) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, HEIGHT);
    ctx.stroke();
  }
  for (let y = 0; y <= HEIGHT; y += gridStep) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(WIDTH, y);
    ctx.stroke();
  }
  ctx.restore();

  const vignette = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, 60, WIDTH / 2, HEIGHT / 2, 680);
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, palette.vignette);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

function drawAccentFrame(ctx, palette) {
  const pad = 22;
  ctx.strokeStyle = palette.frameOuter;
  ctx.lineWidth = 1;
  ctx.strokeRect(pad, pad, WIDTH - pad * 2, HEIGHT - pad * 2);
  ctx.strokeStyle = palette.greenSoft;
  ctx.strokeRect(pad + 6, pad + 6, WIDTH - (pad + 6) * 2, HEIGHT - (pad + 6) * 2);
}

function drawLogoMark(ctx, logo, cx, cy, boxSize, palette, radius = 24) {
  const x = cx - boxSize / 2;
  const y = cy - boxSize / 2;

  ctx.save();
  ctx.shadowColor = palette.logoShadow;
  ctx.shadowBlur = Math.max(12, boxSize * 0.2);
  ctx.shadowOffsetY = Math.max(4, boxSize * 0.07);

  ctx.fillStyle = palette.surface;
  ctx.beginPath();
  ctx.roundRect(x, y, boxSize, boxSize, radius);
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.strokeStyle = palette.markBorder;
  ctx.stroke();

  const innerPad = boxSize * 0.2;
  const innerSize = boxSize - innerPad * 2;
  const aspect = logo.width / Math.max(1, logo.height);
  let drawW = innerSize;
  let drawH = innerSize;
  if (aspect > 1.15) {
    drawW = innerSize;
    drawH = innerSize / aspect;
  } else if (aspect < 0.85) {
    drawH = innerSize;
    drawW = innerSize * aspect;
  }
  ctx.shadowColor = palette.markGlow;
  ctx.shadowBlur = 28;
  ctx.drawImage(logo, cx - drawW / 2, cy - drawH / 2, drawW, drawH);
  ctx.restore();
}

function drawTitle(ctx, text, x, y, size, palette) {
  ctx.font = fontCss(size);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = palette.text;
  ctx.fillText(text, x, y);
}

function drawKicker(ctx, text, x, y, size, palette, color) {
  ctx.font = fontCss(size, "600");
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color || palette.muted;
  ctx.fillText(text, x, y);
}

function drawAccentLine(ctx, x, y, width, palette) {
  const grad = ctx.createLinearGradient(x - width / 2, y, x + width / 2, y);
  grad.addColorStop(0, "rgba(0, 0, 0, 0)");
  grad.addColorStop(0.5, palette.accentLine);
  grad.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - width / 2, y);
  ctx.lineTo(x + width / 2, y);
  ctx.stroke();
}

async function renderDiscordCompactBanner(title, { theme = "dark", width = DISCORD_WIDTH, height = DISCORD_HEIGHT } = {}) {
  const palette = resolvePalette(theme);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const sectionTitle = String(title || "Garbona").trim();

  // Logo neon colors (GB mark)
  const neonGreen = "#54D67D";
  const neonCyan = "#62C4FF";

  ctx.fillStyle = "#070707";
  ctx.fillRect(0, 0, width, height);

  // Soft corner orbs — green top-left, cyan bottom-right
  const orbL = ctx.createRadialGradient(width * 0.12, height * 0.15, 0, width * 0.12, height * 0.15, height * 0.95);
  orbL.addColorStop(0, "rgba(84, 214, 125, 0.28)");
  orbL.addColorStop(0.55, "rgba(84, 214, 125, 0.06)");
  orbL.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = orbL;
  ctx.fillRect(0, 0, width, height);

  const orbR = ctx.createRadialGradient(width * 0.88, height * 0.9, 0, width * 0.88, height * 0.9, height * 1.05);
  orbR.addColorStop(0, "rgba(98, 196, 255, 0.26)");
  orbR.addColorStop(0.55, "rgba(53, 156, 240, 0.07)");
  orbR.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = orbR;
  ctx.fillRect(0, 0, width, height);

  const vignette = ctx.createRadialGradient(width / 2, height / 2, height * 0.2, width / 2, height / 2, width * 0.55);
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.55)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  const logo = await loadBrandLogoImage();
  const markBox = Math.round(height * 0.62);
  const markX = Math.round(width * 0.16);
  const markY = height / 2;

  // Dual neon halo behind logo (green left / cyan right)
  const logoHalo = ctx.createRadialGradient(markX - markBox * 0.12, markY, 0, markX, markY, markBox * 0.85);
  logoHalo.addColorStop(0, "rgba(84, 214, 125, 0.45)");
  logoHalo.addColorStop(0.45, "rgba(98, 196, 255, 0.22)");
  logoHalo.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = logoHalo;
  ctx.beginPath();
  ctx.arc(markX, markY, markBox * 0.85, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.shadowColor = neonGreen;
  ctx.shadowBlur = 28;
  drawLogoMark(ctx, logo, markX, markY, markBox, palette, Math.max(10, Math.round(markBox * 0.14)));
  ctx.restore();

  // Title block on the right with cyan neon glow
  const textX = width * 0.58;
  const titleSize = sectionTitle.length > 10 ? 40 : 48;
  ctx.font = fontCss(titleSize);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  // Neon passes (outer cyan → inner white)
  const neonPasses = [
    { color: "rgba(53, 156, 240, 0.55)", blur: 36 },
    { color: "rgba(98, 196, 255, 0.85)", blur: 18 },
    { color: "rgba(164, 230, 95, 0.35)", blur: 10 },
  ];
  for (const pass of neonPasses) {
    ctx.save();
    ctx.shadowColor = pass.color;
    ctx.shadowBlur = pass.blur;
    ctx.fillStyle = "#f4fbff";
    ctx.fillText(sectionTitle, textX, height * 0.42);
    ctx.restore();
  }
  ctx.fillStyle = "#ffffff";
  ctx.shadowBlur = 0;
  ctx.fillText(sectionTitle, textX, height * 0.42);

  // Accent line under title — green → cyan like logo
  const lineW = Math.min(Math.round(width * 0.28), 280);
  const lineY = height * 0.58;
  const lineGrad = ctx.createLinearGradient(textX, lineY, textX + lineW, lineY);
  lineGrad.addColorStop(0, neonGreen);
  lineGrad.addColorStop(0.5, neonCyan);
  lineGrad.addColorStop(1, "rgba(53, 156, 240, 0)");
  ctx.save();
  ctx.shadowColor = neonCyan;
  ctx.shadowBlur = 12;
  ctx.strokeStyle = lineGrad;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(textX, lineY);
  ctx.lineTo(textX + lineW, lineY);
  ctx.stroke();
  ctx.restore();

  ctx.font = fontCss(15, "600");
  ctx.fillStyle = palette.muted;
  ctx.shadowBlur = 0;
  ctx.fillText("GARBONA", textX, height * 0.74);

  return canvas.toBuffer("image/png");
}

async function renderSectionBanner(title, { theme = "dark" } = {}) {
  const palette = resolvePalette(theme);
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");
  const sectionTitle = String(title || "Garbona").trim();

  drawBackground(ctx, palette);
  drawAccentFrame(ctx, palette);

  const logo = await loadBrandLogoImage();
  const centerX = WIDTH / 2;
  const markBox = 136;
  const markY = HEIGHT * 0.34;
  drawLogoMark(ctx, logo, centerX, markY, markBox, palette);

  const fontSize = titleFontSize(sectionTitle);
  const titleY = markY + markBox / 2 + 58;
  drawTitle(ctx, sectionTitle, centerX, titleY, fontSize, palette);

  drawAccentLine(ctx, centerX, titleY + 38, 220, palette);

  drawKicker(ctx, "GARBONA", centerX, titleY + 72, 26, palette, palette.green);

  return canvas.toBuffer("image/png");
}

async function renderAccessDeniedBanner() {
  return renderSectionBanner("Доступ запрещен", { theme: "denied" });
}

async function renderMainMenuBanner() {
  return renderSectionBanner(MENU_SECTIONS.home.title);
}

async function renderRulesBanner() {
  return renderDiscordCompactBanner(MENU_SECTIONS.rules.title, { theme: "dark" });
}

async function renderMemoBanner() {
  return renderDiscordCompactBanner(MENU_SECTIONS.memo.title, { theme: "dark" });
}

async function renderDiscordProfileBanner() {
  return renderDiscordCompactBanner(MENU_SECTIONS.discord_profile.title, { theme: "dark" });
}

module.exports = {
  renderSectionBanner,
  renderDiscordCompactBanner,
  renderMainMenuBanner,
  renderRulesBanner,
  renderMemoBanner,
  renderDiscordProfileBanner,
  renderAccessDeniedBanner,
  MENU_SECTIONS,
  WIDTH,
  HEIGHT,
  DISCORD_WIDTH,
  DISCORD_HEIGHT,
  BRAND,
  BRAND_LIGHT,
  BRAND_DENIED,
  resolvePalette,
};
