const path = require("path");
const fs = require("fs");
const { env } = require("../config/env");
const { upsertBotPhoto, upsertBotMessage } = require("./message");
const { MENU_SECTIONS } = require("./mainMenuBannerRenderer");

const BRAND_DIR = path.join(__dirname, "../../assets/brand");
const cache = new Map();

function getMenuBannerTheme() {
  return env.menuBannerTheme === "dark" ? "dark" : "light";
}

function resolveBannerFilename(file, theme = getMenuBannerTheme()) {
  if (theme === "light") {
    return String(file || "").replace(/\.png$/i, "-light.png");
  }
  return file;
}

function getMenuBannerSource(key) {
  const cfg = MENU_SECTIONS[key];
  if (!cfg) return null;

  const theme = getMenuBannerTheme();
  const cacheKey = `${key}:${theme}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const filePath = path.join(BRAND_DIR, resolveBannerFilename(cfg.file, theme));
  if (!fs.existsSync(filePath)) return null;

  const source = { source: filePath };
  cache.set(cacheKey, source);
  return source;
}

/** Photo with section banner, or text fallback if PNG missing */
async function upsertMenuSection(ctx, key, extra = {}) {
  const banner = getMenuBannerSource(key);
  if (banner) {
    return upsertBotPhoto(ctx, banner, extra);
  }
  const cfg = MENU_SECTIONS[key];
  const fallbackCaption = extra.caption || (cfg ? `<b>${cfg.title}</b>` : "");
  return upsertBotMessage(ctx, fallbackCaption, extra);
}

module.exports = {
  getMenuBannerTheme,
  resolveBannerFilename,
  getMenuBannerSource,
  upsertMenuSection,
  MENU_SECTIONS,
};
