/**
 * Диагностика иконок предметов на карточке MaFile.
 * Usage: node scripts/diag-mafile-icons.js [sourceId]
 */
const axios = require("axios");
const mongoose = require("mongoose");

const { env } = require("../src/config/env");
const SteamLog = require("../src/models/SteamLog");
const { iconUrls } = require("../src/utils/steamImageRenderer");

function preview(value, max = 60) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max)}..(len ${text.length})` : text;
}

async function probe(url) {
  try {
    const res = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 10000,
      headers: { "User-Agent": "Mozilla/5.0", Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8" },
    });
    return `HTTP ${res.status} ${res.data?.length || 0}b ct=${res.headers["content-type"]}`;
  } catch (error) {
    return `ERR http=${error?.response?.status || "-"} ${error?.message || error}`;
  }
}

async function main() {
  const wanted = String(process.argv[2] || "").trim();
  await mongoose.connect(env.mongoUri);
  try {
    const query = wanted ? { sourceId: wanted } : { logKind: "mafile" };
    const logs = await SteamLog.find(query).sort({ createdAt: -1 }).lean();
    console.log(`TOTAL mafile logs: ${logs.length}`);

    let noItems = 0;
    let allIcons = 0;
    let someMissing = 0;
    const broken = [];
    for (const log of logs) {
      const items = Array.isArray(log?.mafileSnapshot?.items) ? log.mafileSnapshot.items : [];
      const paid = items.filter((item) => Number(item?.price || 0) > 0);
      if (!paid.length) { noItems += 1; continue; }
      const missing = paid.filter((item) => !iconUrls(item).length);
      if (!missing.length) { allIcons += 1; continue; }
      someMissing += 1;
      broken.push({ sourceId: log.sourceId, steamId: log.steamId, paid: paid.length, missing: missing.length, createdAt: log.createdAt });
    }
    console.log(`no priced items: ${noItems}`);
    console.log(`every priced item has icon: ${allIcons}`);
    console.log(`some priced items missing icon: ${someMissing}`);
    for (const row of broken.slice(0, 25)) console.log(`  BROKEN ${JSON.stringify(row)}`);

    console.log("\n=== URL reachability sample (newest 6 logs, first priced item each)");
    for (const log of logs.slice(0, 6)) {
      const items = (Array.isArray(log?.mafileSnapshot?.items) ? log.mafileSnapshot.items : [])
        .filter((item) => Number(item?.price || 0) > 0);
      const item = items[0];
      if (!item) { console.log(`  ${log.sourceId}: no priced items`); continue; }
      const urls = iconUrls(item);
      console.log(`  ${log.sourceId}: name=${preview(item.itemHashName, 40)} iconLen=${String(item.icon || "").length} urls=${urls.length}`);
      for (const url of urls) console.log(`    ${preview(url, 90)} -> ${await probe(url)}`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
