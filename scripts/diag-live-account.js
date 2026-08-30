/** READ-ONLY: what UProject returns live for accounts, vs DB. node scripts/diag-live-account.js 837047 836148 836764 */
require("../src/config/env");
const mongoose = require("mongoose");
const { env } = require("../src/config/env");
const SteamLog = require("../src/models/SteamLog");
const User = require("../src/models/User");
const { authCredentials } = require("../src/services/apiService");
const { getSteamAccountById } = require("../src/services/steamApiService");
const { decryptSecret } = require("../src/utils/secretBox");

function unwrap(p) {
  if (!p || typeof p !== "object") return null;
  if (p.id != null) return p;
  if (p.data?.id != null) return p.data;
  if (p.account?.id != null) return p.account;
  return null;
}

const tokenCache = new Map();
async function tokenFor(user) {
  const k = user.panelUsername;
  if (tokenCache.has(k)) return tokenCache.get(k);
  let pw = user.panelPassword || "";
  try { const d = decryptSecret(pw); if (d) pw = d; } catch (_) {}
  const auth = await authCredentials(user.panelUsername, pw);
  tokenCache.set(k, auth.token);
  return auth.token;
}

async function one(id) {
  const log = await SteamLog.findOne({ sourceId: id }).lean();
  const user = await User.findOne({ telegramId: String(log?.ownerTelegramId || "") }).lean();
  let live = "no-user";
  if (user) {
    try {
      const token = await tokenFor(user);
      const acc = unwrap(await getSteamAccountById(token, id));
      live = acc ? { status: acc.status, invalidDate: acc.invalidDate || acc.invalid_date || null } : "not-returned";
    } catch (e) { live = "err:" + (e.message || e); }
  }
  console.log(`#${id}  DB.autoSale=${log?.autoSaleStatus || "none"} DB.acct=${log?.accountStatus || "-"}  LIVE=${JSON.stringify(live)}`);
}

async function main() {
  await mongoose.connect(env.mongoUri);
  for (const id of process.argv.slice(2)) await one(id);
  await mongoose.disconnect();
}
main().catch(async (e) => { console.error(e.stack || e.message); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
