/**
 * Рендерит карточку так же, как это делает отправка в Telegram, и сохраняет PNG в
 * assets/brand/mafile-preview. Нужен, чтобы проверять реальный путь сборки на сервере.
 *
 * Использование: node scripts/preview-card.js <sourceId>
 */
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const { env } = require("../src/config/env");
const SteamLog = require("../src/models/SteamLog");
const { buildLocalTelegramImage } = require("../src/services/adminTelegramLogService");
const { accountFromSteamLog } = require("../src/panel/serializers");

async function main() {
  const sourceId = String(process.argv[2] || "").trim();
  if (!sourceId) throw new Error("Usage: node scripts/preview-mafile-card.js <sourceId>");

  await mongoose.connect(env.mongoUri);
  try {
    const localLog = await SteamLog.findOne({ sourceId }).lean();
    if (!localLog) throw new Error(`SteamLog ${sourceId} not found`);

    const { imageBuffer, account } = await buildLocalTelegramImage(accountFromSteamLog(localLog), localLog);

    const outDir = path.join(__dirname, "../assets/brand/mafile-preview");
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `card-${sourceId}.png`);
    fs.writeFileSync(outFile, imageBuffer);

    // Перечитываем лог: обогащение сохраняет найденные предметы и суммы обратно в базу.
    const saved = await SteamLog.findOne({ sourceId }).lean();
    console.log(JSON.stringify({
      sourceId,
      logKind: saved.logKind,
      outFile,
      cardBytes: imageBuffer.length,
      steamId: saved.steamId || account?.steamInfo?.steamid || "",
      balanceUsd: saved.balanceUsd,
      inventoryUsd: saved.inventoryUsd,
      totalProfit: saved.totalProfit,
      items: (saved.mafileSnapshot?.items || []).length,
      games: (saved.mafileSnapshot?.games || []).length,
    }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
