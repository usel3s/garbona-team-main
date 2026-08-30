#!/usr/bin/env node
/** Test light-theme banner previews — not used in bot by default */
const fs = require("fs");
const path = require("path");
const { renderSectionBanner, MENU_SECTIONS } = require("../src/utils/mainMenuBannerRenderer");

const OUT_DIR = path.join(__dirname, "../assets/brand/preview-light");

async function main() {
  await fs.promises.mkdir(OUT_DIR, { recursive: true });

  for (const [key, cfg] of Object.entries(MENU_SECTIONS)) {
    const buffer = await renderSectionBanner(cfg.title, { theme: "light" });
    const base = cfg.file.replace(/\.png$/i, "");
    const outPath = path.join(OUT_DIR, `${base}-light.png`);
    await fs.promises.writeFile(outPath, buffer);
    console.log(`[${key}] saved ${outPath} (${buffer.length} bytes)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
