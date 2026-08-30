const path = require("path");
const { createCanvas } = require("@napi-rs/canvas");
const { loadLocalImage } = require("./safeImageLoader");

const LOGO_CANDIDATES = [
  path.join(__dirname, "../../assets/brand/gb-mark.png"),
  path.join(__dirname, "../../panel/assets/logo-mark.png"),
  path.join(__dirname, "../../assets/brand/gb-icon.png"),
];

let cachedLogo = null;

/**
 * Vector fallback used when no brand file can be decoded, so card rendering keeps
 * working even if the assets are missing on a deployment target.
 */
function createProceduralGbMark(width = 262, height = 175) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#54C86A");
  gradient.addColorStop(1, "#31A8F0");

  ctx.fillStyle = gradient;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${Math.round(height * 0.82)}px sans-serif`;
  ctx.fillText("GB", width / 2, height * 0.54);

  return canvas;
}

async function loadBrandLogoImage({ force = false } = {}) {
  if (cachedLogo && !force) return cachedLogo;

  for (const candidate of LOGO_CANDIDATES) {
    const image = await loadLocalImage(candidate);
    if (image) {
      cachedLogo = image;
      return cachedLogo;
    }
  }

  cachedLogo = createProceduralGbMark();
  return cachedLogo;
}

function resetBrandLogoCache() {
  cachedLogo = null;
}

module.exports = {
  loadBrandLogoImage,
  createProceduralGbMark,
  resetBrandLogoCache,
};
