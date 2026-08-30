#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { renderSectionBanner, MENU_SECTIONS } = require("../src/utils/mainMenuBannerRenderer");

const OUT_DIR = path.join(__dirname, "../assets/brand");

async function main() {
  await fs.promises.mkdir(OUT_DIR, { recursive: true });

  for (const [key, cfg] of Object.entries(MENU_SECTIONS)) {
    for (const theme of ["dark", "light"]) {
      const buffer = await renderSectionBanner(cfg.title, { theme });
      const file =
        theme === "light"
          ? cfg.file.replace(/\.png$/i, "-light.png")
          : cfg.file;
      const outPath = path.join(OUT_DIR, file);
      await fs.promises.writeFile(outPath, buffer);
      console.log(`[${key}/${theme}] saved ${outPath} (${buffer.length} bytes)`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
