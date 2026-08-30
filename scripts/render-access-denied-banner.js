#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { renderAccessDeniedBanner } = require("../src/utils/mainMenuBannerRenderer");

async function main() {
  const outDir = path.join(__dirname, "../assets/brand");
  await fs.promises.mkdir(outDir, { recursive: true });
  const buffer = await renderAccessDeniedBanner();
  const outPath = path.join(outDir, "access-denied-banner.png");
  await fs.promises.writeFile(outPath, buffer);
  console.log(`saved ${outPath} (${buffer.length} bytes)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
