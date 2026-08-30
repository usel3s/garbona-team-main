#!/usr/bin/env node
/**
 * Прогрев локального кэша превью шаблонов uProject.
 * CDN часто обрывает загрузку — скрипт докачивает кусками (Range).
 *
 * Usage: node scripts/sync-template-previews.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../src/models/User");
const { authCredentials, getAllTemplates } = require("../src/services/apiService");
const { ensureLocalPreview, hasLocalPreview } = require("../src/services/templatePreviewService");

async function main() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  const user = await User.findOne({
    panelUsername: { $exists: true, $ne: "" },
    panelPassword: { $exists: true, $ne: "" },
  });
  if (!user?.panelUsername) throw new Error("No panel user in DB");

  const auth = await authCredentials(user.panelUsername, user.panelPassword);
  const catalog = await getAllTemplates(auth.token);
  const rows = catalog?.rows || [];
  console.log(`templates: ${rows.length}`);

  let ok = 0;
  let skip = 0;
  let fail = 0;
  for (const row of rows) {
    const id = Number(row.id);
    const preview = String(row.preview || "").trim();
    if (!preview) {
      console.log(`skip ${id} (no remote preview)`);
      skip += 1;
      continue;
    }
    if (hasLocalPreview(id)) {
      skip += 1;
      continue;
    }
    const url = await ensureLocalPreview(id, preview);
    if (url) {
      ok += 1;
      console.log(`ok ${id}`);
    } else {
      fail += 1;
      console.log(`fail ${id}`);
    }
  }

  console.log({ ok, skip, fail });
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
