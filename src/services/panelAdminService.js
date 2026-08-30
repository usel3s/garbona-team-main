const PanelAdmin = require("../models/PanelAdmin");
const User = require("../models/User");
const {
  hashAppPassword,
  verifyAppPasswordSafe,
  validateUsername,
  validateNewPassword,
  validateLoginPassword,
  passwordVersion,
} = require("../panel/appPassword");
const { logger } = require("../utils/logger");

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function syntheticTelegramId(username) {
  return `padmin:${normalizeUsername(username)}`;
}

async function ensureLinkedUser(admin) {
  const telegramId = syntheticTelegramId(admin.username);
  let user = await User.findOne({ telegramId });
  if (!user) {
    user = await User.create({
      telegramId,
      username: admin.username,
      firstName: admin.displayName || admin.username,
      role: "admin",
      isTeamMember: true,
    });
  } else {
    let dirty = false;
    if (user.role !== "admin") {
      user.role = "admin";
      dirty = true;
    }
    if (!user.isTeamMember) {
      user.isTeamMember = true;
      dirty = true;
    }
    if (dirty) await user.save();
  }
  return { user, telegramId };
}

async function upsertPanelAdmin(username, password, displayName = "", { forcePassword = false } = {}) {
  const checked = validateUsername(username);
  if (!checked.ok) throw new Error(checked.error || "invalid_username");
  const passwordCheck = validateNewPassword(password);
  if (!passwordCheck.ok) throw new Error(passwordCheck.error || "invalid_password");

  const login = checked.username;
  const existing = await PanelAdmin.findOne({ username: login });
  if (existing && !forcePassword) {
    await ensureLinkedUser(existing);
    return existing;
  }

  const passwordHash = hashAppPassword(password);
  const admin = await PanelAdmin.findOneAndUpdate(
    { username: login },
    {
      $set: {
        passwordHash,
        displayName: String(displayName || username).trim() || login,
        active: true,
        sessionVersion: existing ? Number(existing.sessionVersion || 1) + 1 : 1,
      },
      $setOnInsert: { username: login },
    },
    { upsert: true, new: true }
  );

  await ensureLinkedUser(admin);
  return admin;
}

function serializePanelAdmin(admin) {
  return {
    id: String(admin._id),
    username: admin.username,
    displayName: admin.displayName || admin.username,
    active: Boolean(admin.active),
    createdAt: admin.createdAt || null,
    createdByUsername: admin.createdByUsername || "",
    lastLoginAt: admin.lastLoginAt || null,
  };
}

async function createPanelAdmin(username, password, displayName, createdByUsername = "") {
  const checked = validateUsername(username);
  if (!checked.ok) throw new Error(checked.error || "invalid_username");
  const passwordCheck = validateNewPassword(password);
  if (!passwordCheck.ok) throw new Error(passwordCheck.error || "invalid_password");
  const existing = await PanelAdmin.exists({ username: checked.username });
  if (existing) throw new Error("admin_username_taken");
  try {
    const admin = await PanelAdmin.create({
      username: checked.username,
      passwordHash: hashAppPassword(password),
      displayName: String(displayName || checked.username).trim().slice(0, 64) || checked.username,
      createdByUsername: normalizeUsername(createdByUsername),
      active: true,
    });
    await ensureLinkedUser(admin);
    return admin;
  } catch (error) {
    if (error?.code === 11000) throw new Error("admin_username_taken");
    throw error;
  }
}

async function listPanelAdmins() {
  const admins = await PanelAdmin.find({}).sort({ createdAt: -1 }).lean();
  return admins.map(serializePanelAdmin);
}

async function ensureSeedPanelAdmins() {
  const { env } = require("../config/env");
  const username = env.panelBootstrapAdminUsername;
  const password = env.panelBootstrapAdminPassword;
  if (!username && !password) return { created: 0, existing: 0, total: 0 };
  if (!username || !password) {
    throw new Error("Set both PANEL_BOOTSTRAP_ADMIN_USERNAME and PANEL_BOOTSTRAP_ADMIN_PASSWORD");
  }
  const before = await PanelAdmin.exists({ username: normalizeUsername(username) });
  await upsertPanelAdmin(username, password, username, { forcePassword: false });
  return { created: before ? 0 : 1, existing: before ? 1 : 0, total: 1 };
}

async function authenticatePanelAdmin(username, password) {
  const userCheck = validateUsername(username);
  const passCheck = validateLoginPassword(password);
  if (!userCheck.ok || !passCheck.ok) {
    verifyAppPasswordSafe(password || "x", null);
    return { ok: false, error: "invalid_credentials" };
  }

  const admin = await PanelAdmin.findOne({ username: userCheck.username, active: true });
  const ok = verifyAppPasswordSafe(password, admin?.passwordHash);
  if (!admin || !ok) {
    return { ok: false, error: "invalid_credentials" };
  }

  const { user, telegramId } = await ensureLinkedUser(admin);
  return {
    ok: true,
    admin,
    user,
    telegramId,
    sessionVersion: Number(admin.sessionVersion || 1),
    passwordVersion: passwordVersion(admin.passwordHash),
  };
}

async function getPanelAdminUserById(adminId, expected = {}) {
  if (!adminId || !/^[a-f0-9]{24}$/i.test(String(adminId))) return null;
  const admin = await PanelAdmin.findById(adminId);
  if (!admin || !admin.active) return null;

  if (
    expected.sessionVersion != null &&
    Number(admin.sessionVersion || 1) !== Number(expected.sessionVersion)
  ) {
    return null;
  }
  if (
    expected.passwordVersion &&
    passwordVersion(admin.passwordHash) !== String(expected.passwordVersion)
  ) {
    return null;
  }

  const { user, telegramId } = await ensureLinkedUser(admin);
  return { admin, user, telegramId };
}

async function markPanelAdminLogin(adminId, ip) {
  await PanelAdmin.updateOne(
    { _id: adminId },
    {
      $set: {
        lastLoginAt: new Date(),
        lastLoginIp: String(ip || "").slice(0, 64),
      },
    }
  );
}

async function seedPanelAdminsOnBoot() {
  try {
    const result = await ensureSeedPanelAdmins();
    logger.info(
      `Panel bootstrap admin: ${result.total} configured (new ${result.created}, existing ${result.existing})`
    );
  } catch (error) {
    logger.error("Failed to seed panel admins", error);
    throw error;
  }
}

module.exports = {
  normalizeUsername,
  syntheticTelegramId,
  upsertPanelAdmin,
  createPanelAdmin,
  listPanelAdmins,
  serializePanelAdmin,
  ensureSeedPanelAdmins,
  authenticatePanelAdmin,
  getPanelAdminUserById,
  markPanelAdminLogin,
  seedPanelAdminsOnBoot,
};
