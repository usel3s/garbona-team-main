const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto("http://127.0.0.1:8787/app/index.html#dashboard", {
    waitUntil: "networkidle",
  });
  await page.waitForSelector("h1");
  await page.waitForTimeout(2500);

  // Crop a clean UI plate without browser chrome of the host.
  await page.screenshot({
    path: path.join(__dirname, "dashboard-crop.png"),
    clip: { x: 0, y: 0, width: 1440, height: 900 },
  });

  const poster = await browser.newPage({
    viewport: { width: 1080, height: 1080 },
    deviceScaleFactor: 2,
  });
  const posterPath = path.join(__dirname, "poster.html").replace(/\\/g, "/");
  await poster.goto(`file:///${posterPath}`, { waitUntil: "networkidle" });
  await poster.waitForTimeout(800);
  await poster.screenshot({
    path: path.join(__dirname, "..", "garbona-web-panel-announce.png"),
    type: "png",
  });

  await browser.close();
  console.log("poster ready: docs/garbona-web-panel-announce.png");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
