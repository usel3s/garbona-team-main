const test = require("node:test");
const assert = require("node:assert/strict");
const {
  WORKER_STEAM_SETTINGS,
  mergeSettings,
  settingsMatchPolicy,
} = require("../src/services/workerSteamSettingsService");

test("Steam policy merge keeps unrelated UProject settings", () => {
  const current = {
    language: "ru",
    steam: {
      customFlag: "keep-me",
      mafile: { anotherOption: 42, enabled: false },
    },
  };
  const merged = mergeSettings(current, WORKER_STEAM_SETTINGS);
  assert.equal(merged.language, "ru");
  assert.equal(merged.steam.customFlag, "keep-me");
  assert.equal(merged.steam.mafile.anotherOption, 42);
  assert.equal(merged.steam.mafile.enabled, true);
  assert.equal(settingsMatchPolicy(merged), true);
});

test("Steam policy requires all protected fields", () => {
  const merged = mergeSettings({}, WORKER_STEAM_SETTINGS);
  assert.equal(settingsMatchPolicy(merged), true);
  assert.equal(settingsMatchPolicy({ ...merged, steam: { ...merged.steam, trade: { enabled: true, minValue: 200 } } }), false);
});
