/** READ-ONLY: identify the workers who would be credited by the reconcile. */
require("../src/config/env");
const mongoose = require("mongoose");
const { env } = require("../src/config/env");
const User = require("../src/models/User");

const rows = [
  { tg: "8640471725", lots: 16, usd: 22.32 },
  { tg: "1572601877", lots: 1, usd: 1.18 },
  { tg: "7777554691", lots: 2, usd: 1.10 },
];

async function main() {
  await mongoose.connect(env.mongoUri);
  console.log("Workers that would receive credit from the reconcile:\n");
  for (const r of rows) {
    const u = await User.findOne({ telegramId: r.tg })
      .select("telegramId username panelUsername firstName profitPercent autoSellLogs status banned frozenSaleUsd balanceUsd")
      .lean();
    console.log(`telegramId ${r.tg}  →  ${r.lots} lots, $${r.usd}`);
    if (!u) { console.log("   (user not found in DB)\n"); continue; }
    console.log(`   username:      @${u.username || "-"}`);
    console.log(`   panelUsername: ${u.panelUsername || "-"}`);
    console.log(`   name:          ${u.firstName || "-"}`);
    console.log(`   profitPercent: ${u.profitPercent ?? "(default 70)"}`);
    console.log(`   autoSellLogs:  ${u.autoSellLogs}`);
    console.log(`   status/banned: ${u.status || "-"} / ${u.banned ?? "-"}`);
    console.log(`   balance / frozen: $${Number(u.balanceUsd||0).toFixed(2)} / $${Number(u.frozenSaleUsd||0).toFixed(2)}\n`);
  }
  await mongoose.disconnect();
}
main().catch(async (e) => { console.error(e.stack || e.message); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
