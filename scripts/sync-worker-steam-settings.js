const mongoose = require("mongoose");
const { validateEnv } = require("../src/config/env");
const { connectDatabase } = require("../src/config/db");
const { syncAllWorkerSteamSettings } = require("../src/services/workerSteamSettingsService");

async function main() {
  validateEnv();
  await connectDatabase();
  const result = await syncAllWorkerSteamSettings({ outdatedOnly: false, concurrency: 3 });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
