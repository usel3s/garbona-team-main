const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto("http://127.0.0.1:8787/app/login.html", {

    waitUntil: "networkidle",
  });
  await page.waitForTimeout(2000);

  if (page.url().includes("login")) {
    await page.goto("http://127.0.0.1:8787/app/index.html#dashboard", {
      waitUntil: "networkidle",
    });
  }

  await page.waitForSelector("h1", { timeout: 20000 });
  await page.waitForTimeout(2500);
  console.log("URL:", page.url());
  console.log("H1:", await page.locator("h1").first().textContent());

  await page.screenshot({
    path: "docs/panel-shots/dashboard-full.png",
    fullPage: false,
  });

  await page.click('button[data-view="analytics"]');
  await page.waitForTimeout(2200);
  await page.screenshot({
    path: "docs/panel-shots/analytics.png",
    fullPage: false,
  });

  await page.click('button[data-view="sites"]');
  await page.waitForTimeout(2200);
  await page.screenshot({
    path: "docs/panel-shots/sites.png",
    fullPage: false,
  });

  await page.click('button[data-view="wallet"]');
  await page.waitForTimeout(2200);
  await page.screenshot({
    path: "docs/panel-shots/wallet.png",
    fullPage: false,
  });

  await browser.close();
  console.log("done");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
