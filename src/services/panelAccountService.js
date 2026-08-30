const User = require("../models/User");
const { createWorkerAccount, authCredentials, formatPanelError } = require("./apiService");
const { generatePassword } = require("../utils/password");
const { logger } = require("../utils/logger");
const { encryptSecret, isEncryptedSecret } = require("../utils/secretBox");
const {
  WORKER_STEAM_SETTINGS_VERSION,
  syncWorkerSteamSettings,
} = require("./workerSteamSettingsService");

async function migrateLegacyPanelPasswords() {
  const users = await User.find({
    panelPassword: { $exists: true, $ne: "", $not: /^enc:v1:/ },
  }).select("_id panelPassword");
  let migrated = 0;
  for (const user of users) {
    const plaintext = user.panelPassword;
    if (!plaintext || isEncryptedSecret(plaintext)) continue;
    await User.updateOne({ _id: user._id }, { $set: { panelPassword: encryptSecret(plaintext) } });
    migrated += 1;
  }
  return migrated;
}

function sanitizePanelLogin(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 24);
}

/** Login = Telegram username (если есть), иначе fallback по ID. */
function buildAutoPanelUsername(user) {
  const fromTg = sanitizePanelLogin(user?.username);
  if (fromTg.length >= 3) return fromTg;

  const tid = String(user?.telegramId || Date.now()).slice(-8);
  const fallback = `u${tid}`;
  return fallback.length >= 5 ? fallback : `worker_${tid}`.slice(0, 24);
}

/** Если логин занят — username + короткий суффикс. */
function buildUniquePanelUsername(user) {
  const base =
    sanitizePanelLogin(user?.username) ||
    `u${String(user?.telegramId || Date.now()).slice(-8)}`;
  const suffix = generatePassword(4).toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${base.slice(0, 18)}_${suffix || String(Date.now()).slice(-4)}`.slice(0, 24);
}

function isUsernameTakenError(error) {
  const status = error?.response?.status;
  const code = String(error?.response?.data?.code || "");
  const message = String(error?.response?.data?.message || error?.message || "");
  return status === 409 || /username_already_exists|already.?exists|уже существует/i.test(`${code} ${message}`);
}

async function persistPanelCredentials(telegramId, panelUsername, panelPassword) {
  const updated = await User.findOneAndUpdate(
    { telegramId: String(telegramId) },
    {
      $set: {
        panelUsername,
        panelPassword,
        panelCreatedAt: new Date(),
      },
    },
    { new: true }
  );
  if (!updated) throw new Error("Пользователь не найден.");
  return updated;
}

async function clearPanelCredentials(telegramId) {
  const updated = await User.findOneAndUpdate(
    { telegramId: String(telegramId) },
    { $set: { panelUsername: "", panelPassword: "", panelCreatedAt: null } },
    { new: true }
  );
  if (!updated) throw new Error("Пользователь не найден.");
  return updated;
}

function syncUserDoc(user, saved) {
  if (!user || !saved) return saved;
  user.panelUsername = saved.panelUsername;
  user.panelPassword = saved.panelPassword;
  user.panelCreatedAt = saved.panelCreatedAt;
  user.panelSteamSettingsVersion = saved.panelSteamSettingsVersion;
  user.panelSteamSettingsConfiguredAt = saved.panelSteamSettingsConfiguredAt;
  user.panelSteamSettingsError = saved.panelSteamSettingsError;
  return saved;
}

async function applySteamPolicy(saved, originalUser = null) {
  await syncWorkerSteamSettings(saved);
  return syncUserDoc(originalUser, saved);
}

/**
 * Создаёт служебный доступ к партнёрской панели автоматически.
 * Login = Telegram username, password = случайный (generatePassword).
 * @param {{ forceUnique?: boolean, forceRecreate?: boolean }} [options]
 */
async function ensureWorkerPanelAccount(user, options = {}) {
  if (!user) throw new Error("Пользователь не найден.");
  const forceRecreate = Boolean(options.forceUnique || options.forceRecreate);
  if (!forceRecreate && user.panelUsername && user.panelPassword) {
    if (
      Number(user.panelSteamSettingsVersion || 0) < WORKER_STEAM_SETTINGS_VERSION ||
      user.panelSteamSettingsError
    ) {
      await syncWorkerSteamSettings(user);
    }
    return user;
  }

  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    // 1-я попытка — чистый username; далее username_xxxx если занят.
    const panelUsername =
      attempt === 0 ? buildAutoPanelUsername(user) : buildUniquePanelUsername(user);
    const panelPassword = generatePassword(12);
    try {
      await createWorkerAccount(panelUsername, panelPassword);
      const saved = await persistPanelCredentials(user.telegramId, panelUsername, panelPassword);
      await applySteamPolicy(saved, user);
      return user;
    } catch (error) {
      lastError = error;
      logger.warn(
        "Panel account create retry",
        user.telegramId,
        error?.response?.data || error.message
      );
      if (!isUsernameTakenError(error) && !error?.response && attempt >= 2) break;
    }
  }

  throw lastError || new Error("Не удалось подготовить доступ к сайтам.");
}

/** Принудительно создаёт новый panel-аккаунт, затирая текущую привязку. */
async function recreateWorkerPanelAccount(user) {
  if (!user) throw new Error("Пользователь не найден.");
  await clearPanelCredentials(user.telegramId);
  user.panelUsername = "";
  user.panelPassword = "";
  user.panelCreatedAt = null;
  return ensureWorkerPanelAccount(user, { forceRecreate: true });
}

/**
 * Привязывает существующий аккаунт панели после проверки логина/пароля.
 */
async function bindWorkerPanelAccount(user, username, password) {
  if (!user) throw new Error("Пользователь не найден.");
  const login = String(username || "").trim();
  const pass = String(password || "").trim();
  if (login.length < 3 || pass.length < 3) {
    throw new Error("Укажите логин и пароль панели.");
  }

  let auth;
  try {
    auth = await authCredentials(login, pass);
  } catch (error) {
    throw new Error(formatPanelError(error));
  }
  if (!auth?.token) {
    throw new Error("Неверный логин или пароль панели.");
  }

  const saved = await persistPanelCredentials(user.telegramId, login, pass);
  await applySteamPolicy(saved, user);
  return user;
}

function parsePanelCredentialsInput(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  if (raw.includes(":")) {
    const idx = raw.indexOf(":");
    const username = raw.slice(0, idx).trim();
    const password = raw.slice(idx + 1).trim();
    if (!username || !password) return null;
    return { username, password };
  }
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return { username: parts[0], password: parts.slice(1).join(" ") };
}

module.exports = {
  buildAutoPanelUsername,
  ensureWorkerPanelAccount,
  recreateWorkerPanelAccount,
  bindWorkerPanelAccount,
  parsePanelCredentialsInput,
  migrateLegacyPanelPasswords,
};
