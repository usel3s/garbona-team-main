const User = require("../models/User");
const {
  authCredentials,
  getUserSettings,
  saveUserSettings,
  formatPanelError,
} = require("./apiService");
const { logger } = require("../utils/logger");

const WORKER_STEAM_SETTINGS_VERSION = 1;
const WORKER_STEAM_SETTINGS = Object.freeze({
  steam: {
    useLogInSameLocation: true,
    rememberSuccessLogin: true,
    mafile: {
      enabled: true,
      private: true,
      minValue: 15,
    },
    logs: {
      twofactorLogExperimental: true,
    },
    trade: {
      enabled: false,
      minValue: 200,
    },
  },
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeSettings(base, patch) {
  const result = isPlainObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch || {})) {
    result[key] = isPlainObject(value)
      ? mergeSettings(isPlainObject(result[key]) ? result[key] : {}, value)
      : value;
  }
  return result;
}

function settingsMatchPolicy(settings) {
  const steam = settings?.steam || {};
  return (
    steam.useLogInSameLocation === true &&
    steam.rememberSuccessLogin === true &&
    steam.mafile?.enabled === true &&
    steam.mafile?.private === true &&
    Number(steam.mafile?.minValue) === 15 &&
    steam.logs?.twofactorLogExperimental === true &&
    steam.trade?.enabled === false &&
    Number(steam.trade?.minValue) === 200
  );
}

async function updateSyncState(user, { ok, error = "" }) {
  const update = ok
    ? {
        panelSteamSettingsVersion: WORKER_STEAM_SETTINGS_VERSION,
        panelSteamSettingsConfiguredAt: new Date(),
        panelSteamSettingsError: "",
      }
    : {
        panelSteamSettingsError: String(error || "settings_sync_failed").slice(0, 300),
      };
  const saved = await User.findOneAndUpdate(
    { telegramId: String(user.telegramId) },
    { $set: update },
    { new: true }
  );
  if (saved && user) {
    user.panelSteamSettingsVersion = saved.panelSteamSettingsVersion;
    user.panelSteamSettingsConfiguredAt = saved.panelSteamSettingsConfiguredAt;
    user.panelSteamSettingsError = saved.panelSteamSettingsError;
  }
  return saved || user;
}

async function configureWorkerSteamSettings(user, { token = "" } = {}) {
  if (!user?.panelUsername || !user?.panelPassword) {
    throw new Error("У воркера нет аккаунта UProject");
  }
  try {
    let accessToken = String(token || "");
    if (!accessToken) {
      const auth = await authCredentials(user.panelUsername, user.panelPassword);
      accessToken = String(auth?.token || "");
    }
    if (!accessToken) throw new Error("Не удалось авторизовать аккаунт UProject");

    const current = await getUserSettings(accessToken);
    const settings = mergeSettings(current, WORKER_STEAM_SETTINGS);
    if (!settingsMatchPolicy(current)) await saveUserSettings(accessToken, settings);
    await updateSyncState(user, { ok: true });
    return { ok: true, changed: !settingsMatchPolicy(current), settings };
  } catch (error) {
    const message = formatPanelError(error) || error.message || "settings_sync_failed";
    await updateSyncState(user, { ok: false, error: message }).catch(() => {});
    throw new Error(message);
  }
}

async function syncWorkerSteamSettings(user, { throwOnError = false } = {}) {
  try {
    return await configureWorkerSteamSettings(user);
  } catch (error) {
    logger.warn("Worker Steam settings sync failed", user?.telegramId, error.message);
    if (throwOnError) throw error;
    return { ok: false, changed: false, error: error.message };
  }
}

async function syncAllWorkerSteamSettings({ outdatedOnly = false, concurrency = 3 } = {}) {
  const filter = {
    isTeamMember: true,
    panelUsername: { $exists: true, $ne: "" },
    panelPassword: { $exists: true, $ne: "" },
  };
  if (outdatedOnly) {
    filter.$or = [
      { panelSteamSettingsVersion: { $lt: WORKER_STEAM_SETTINGS_VERSION } },
      { panelSteamSettingsVersion: { $exists: false } },
      { panelSteamSettingsError: { $exists: true, $ne: "" } },
    ];
  }
  const users = await User.find(filter);
  const queue = [...users];
  const result = { total: users.length, configured: 0, unchanged: 0, failed: 0, errors: [] };
  const count = Math.max(1, Math.min(5, Number(concurrency) || 3));
  await Promise.all(
    Array.from({ length: Math.min(count, queue.length) }, async () => {
      while (queue.length) {
        const user = queue.shift();
        if (!user) return;
        const synced = await syncWorkerSteamSettings(user);
        if (synced.ok) {
          if (synced.changed) result.configured += 1;
          else result.unchanged += 1;
        } else {
          result.failed += 1;
          result.errors.push({ telegramId: String(user.telegramId), error: synced.error });
        }
      }
    })
  );
  return result;
}

module.exports = {
  WORKER_STEAM_SETTINGS_VERSION,
  WORKER_STEAM_SETTINGS,
  mergeSettings,
  settingsMatchPolicy,
  configureWorkerSteamSettings,
  syncWorkerSteamSettings,
  syncAllWorkerSteamSettings,
};
