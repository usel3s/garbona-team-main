const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const bases = [
    "http://127.0.0.1:8787",
    "http://127.0.0.1:3000",
  ];
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let ok = false;
  for (const base of bases) {
    try {
      await page.goto(`${base}/app/index.html#dashboard`, {
        waitUntil: "networkidle",
        timeout: 8000,
      });
      await page.waitForSelector("h1", { timeout: 8000 });
      ok = true;
      console.log("using", base);
      break;
    } catch (e) {
      console.log("fail", base, e.message);
    }
  }
  if (!ok) throw new Error("panel unreachable");
  await page.waitForTimeout(2500);
  await page.screenshot({
    path: path.join(__dirname, "dashboard-crop.png"),
    clip: { x: 0, y: 0, width: 1440, height: 900 },
  });
  await browser.close();
  console.log("shot ok");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
