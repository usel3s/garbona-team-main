const User = require("../models/User");
const {
  normalizeFakeProfitTag,
  randomFakeProfitTag,
  resolveFakeProfitTag,
} = require("../utils/fakeProfitTag");
const { env } = require("../config/env");
const { logger } = require("../utils/logger");

const CUSTOM_ID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CUSTOM_ID_LENGTH = 12;

function isAdminTelegramId(telegramId) {
  return env.adminIds.includes(String(telegramId));
}

function generateCustomId(length = CUSTOM_ID_LENGTH) {
  const size = Math.max(1, Math.min(12, Number(length) || CUSTOM_ID_LENGTH));
  let out = "";
  for (let i = 0; i < size; i += 1) {
    out += CUSTOM_ID_CHARS[Math.floor(Math.random() * CUSTOM_ID_CHARS.length)];
  }
  return out;
}

async function allocateCustomId() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const customId = generateCustomId();
    const taken = await User.exists({ customId });
    if (!taken) return customId;
  }
  throw new Error("Не удалось выделить уникальный customId.");
}

/** Выдаёт customId участнику команды, если его ещё нет. */
async function ensureCustomId(userOrTelegramId) {
  let user =
    userOrTelegramId && typeof userOrTelegramId === "object" && userOrTelegramId.telegramId
      ? userOrTelegramId
      : await User.findOne({ telegramId: String(userOrTelegramId) });
  if (!user) return null;
  if (String(user.customId || "").trim()) return user;
  user.customId = await allocateCustomId();
  await user.save();
  return user;
}

/** Проставляет customId всем участникам команды без него. */
async function backfillTeamCustomIds() {
  const users = await User.find({
    isTeamMember: true,
    $or: [{ customId: { $exists: false } }, { customId: "" }, { customId: null }],
  }).limit(5000);

  let updated = 0;
  for (const user of users) {
    user.customId = await allocateCustomId();
    await user.save();
    updated += 1;
  }
  return { updated, total: users.length };
}

async function ensureUser(telegramUser) {
  const telegramId = String(telegramUser.id);
  const nextUsername = String(telegramUser.username || "").trim();
  const firstName = String(telegramUser.first_name || "").trim();
  const existing = await User.findOne({ telegramId });
  if (existing) {
    let dirty = false;
    if (existing.username !== nextUsername) {
      existing.username = nextUsername;
      dirty = true;
    }
    if (firstName && existing.firstName !== firstName) {
      existing.firstName = firstName;
      dirty = true;
    }
    if (isAdminTelegramId(telegramId)) {
      if (existing.role !== "admin") {
        existing.role = "admin";
        dirty = true;
      }
      if (!existing.isTeamMember) {
        existing.isTeamMember = true;
        dirty = true;
      }
    }
    if (existing.isTeamMember && !String(existing.customId || "").trim()) {
      existing.customId = await allocateCustomId();
      dirty = true;
    }
    if (dirty) await existing.save();
    return existing;
  }

  const isAdmin = isAdminTelegramId(telegramId);
  const payload = {
    telegramId,
    username: nextUsername,
    firstName,
    role: isAdmin ? "admin" : "user",
    isTeamMember: isAdmin,
  };
  if (isAdmin) payload.customId = await allocateCustomId();
  return User.create(payload);
}

async function setTeamMember(telegramId, value) {
  const user = await User.findOne({ telegramId: String(telegramId) });
  if (!user) return null;

  user.isTeamMember = Boolean(value);
  if (!value) {
    user.isCurator = false;
    user.isCaller = false;
    user.isModerator = false;
    if (user.branchId) {
      const { getOwnedBranch, closeBranch } = require("./branchService");
      const owned = await getOwnedBranch(user.telegramId);
      if (owned) await closeBranch(owned);
      user.branchId = "";
      user.branchJoinedAt = null;
    }
    user.canCreateBranch = false;
  } else if (!String(user.customId || "").trim()) {
    user.customId = await allocateCustomId();
  }
  await user.save();
  if (!value && user.discordId) {
    try {
      const { revokeVerifiedAccess } = require("../discord/guild");
      await revokeVerifiedAccess(user.discordId);
    } catch (error) {
      logger.warn("Discord role revoke on team removal failed", error.message);
    }
  }
  return user;
}

async function setBan(telegramId, value) {
  const user = await User.findOneAndUpdate(
    { telegramId: String(telegramId) },
    {
      isBanned: value,
      isTeamMember: value ? false : undefined,
      isCurator: value ? false : undefined,
      isCaller: value ? false : undefined,
      isModerator: value ? false : undefined,
    },
    { new: true }
  );
  if (value && user) {
    const { getOwnedBranch, closeBranch } = require("./branchService");
    const owned = await getOwnedBranch(user.telegramId);
    if (owned) await closeBranch(owned);
    if (user.branchId || user.canCreateBranch) {
      user.branchId = "";
      user.branchJoinedAt = null;
      user.canCreateBranch = false;
      await user.save();
    }
  }
  if (value && user?.discordId) {
    try {
      const { revokeVerifiedAccess } = require("../discord/guild");
      await revokeVerifiedAccess(user.discordId);
    } catch (error) {
      logger.warn("Discord role revoke on ban failed", error.message);
    }
  }
  return user;
}

async function setModerator(telegramId, value) {
  return User.findOneAndUpdate(
    { telegramId: String(telegramId) },
    { isModerator: Boolean(value) },
    { new: true }
  );
}

async function setCurator(telegramId, value) {
  const current = await User.findOne({ telegramId: String(telegramId) });
  if (!current) return null;
  if (value && (current.branchId || current.canCreateBranch)) {
    throw new Error("Нельзя назначить куратора: пользователь связан с филиалом.");
  }
  const update = { isCurator: Boolean(value) };
  if (!value) {
    update.curatorDescription = "";
    update.curatorPercent = 80;
    update.curatorMinProfits = 0;
  }
  const updated = await User.findOneAndUpdate(
    { telegramId: String(telegramId) },
    update,
    { new: true }
  );
  if (!value) {
    await User.updateMany(
      { curatorTelegramId: String(telegramId) },
      { curatorTelegramId: "" }
    );
  }
  return updated;
}

async function listCurators() {
  return User.find({
    isCurator: true,
    isBanned: { $ne: true },
    telegramId: { $not: /^padmin:/i },
  }).sort({ username: 1, createdAt: 1 });
}

async function setCaller(telegramId, value) {
  const update = { isCaller: Boolean(value) };
  if (!value) {
    update.callerDescription = "";
    update.callerPercent = 80;
    update.callerMinProfits = 0;
  }
  const updated = await User.findOneAndUpdate(
    { telegramId: String(telegramId) },
    update,
    { new: true }
  );
  if (!value) {
    await User.updateMany(
      { callerTelegramId: String(telegramId) },
      { callerTelegramId: "" }
    );
  }
  return updated;
}

async function listCallers() {
  return User.find({
    isCaller: true,
    isBanned: { $ne: true },
    telegramId: { $not: /^padmin:/i },
  }).sort({ username: 1, createdAt: 1 });
}

async function listTeamMembers() {
  return User.find({
    isTeamMember: true,
    telegramId: { $not: /^padmin:/i },
  })
    .sort({ createdAt: -1 })
    .lean();
}

async function getUserByTelegramId(telegramId) {
  return User.findOne({ telegramId: String(telegramId) });
}

async function getUserByPanelUsername(panelUsername) {
  const login = String(panelUsername || "").trim();
  if (!login) return null;
  const escaped = login.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return User.findOne({ panelUsername: new RegExp(`^${escaped}$`, "i") });
}

async function setProfitPercent(telegramId, percent) {
  return User.findOneAndUpdate(
    { telegramId: String(telegramId) },
    { profitPercent: percent },
    { new: true }
  );
}

/** Пополнение баланса кошелька на точную сумму в USD (без процента воркера) + запись в историю. */
async function addWalletBalanceUsd(telegramId, amountUsd, actorTelegramId = "") {
  const { creditWalletBalanceUsd, CREDIT_KINDS } = require("./profitService");
  return creditWalletBalanceUsd(telegramId, amountUsd, {
    kind: CREDIT_KINDS.WALLET_CREDIT,
    actorTelegramId,
    note: "Пополнение администратором",
  });
}

async function setUserBio(telegramId, bio) {
  return User.findOneAndUpdate(
    { telegramId: String(telegramId) },
    { bio: String(bio || "").trim().slice(0, 250) },
    { new: true }
  );
}

async function toggleAnonymous(telegramId) {
  const user = await User.findOne({ telegramId: String(telegramId) });
  if (!user) return null;
  user.isAnonymous = !user.isAnonymous;
  if (user.isAnonymous && !normalizeFakeProfitTag(user.fakeProfitTag)) {
    user.fakeProfitTag = randomFakeProfitTag();
  }
  await user.save();
  return user;
}

async function toggleAutoSellLogs(telegramId) {
  const user = await User.findOne({ telegramId: String(telegramId) });
  if (!user) return null;
  user.autoSellLogs = !(user.autoSellLogs !== false);
  await user.save();
  return user;
}

async function setFakeProfitTag(telegramId, input, { randomize = false } = {}) {
  const user = await User.findOne({ telegramId: String(telegramId) });
  if (!user) return null;
  user.fakeProfitTag = randomize ? randomFakeProfitTag() : resolveFakeProfitTag(input);
  await user.save();
  return user;
}

async function searchTeamMembers(query) {
  const q = String(query || "").trim();
  if (!q) return [];
  const raw = q.replace(/^@/, "");
  const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const byId = /^\d+$/.test(raw) ? { telegramId: raw } : null;
  const byUsername = { username: { $regex: escaped, $options: "i" } };
  const byFirstName = { firstName: { $regex: escaped, $options: "i" } };
  const byCustomId = { customId: { $regex: `^${escaped}$`, $options: "i" } };
  return User.find({
    isTeamMember: true,
    telegramId: { $not: /^padmin:/i },
    $or: byId ? [byId, byUsername, byFirstName, byCustomId] : [byUsername, byFirstName, byCustomId],
  }).sort({ createdAt: -1 });
}

/** Точное совпадение по ID/username/customId, иначе первый результат поиска. */
async function findUserByQuery(query) {
  const results = await searchTeamMembers(query);
  if (!results.length) return null;

  const q = String(query || "")
    .trim()
    .replace(/^@/, "");
  if (/^\d+$/.test(q)) {
    return results.find((u) => String(u.telegramId) === q) || results[0];
  }

  const needle = q.toLowerCase();
  const byCustom = results.find((u) => String(u.customId || "").toLowerCase() === needle);
  if (byCustom) return byCustom;
  const exact = results.find((u) => String(u.username || "").toLowerCase() === needle);
  return exact || results[0];
}

async function isTeamReferralPathTaken(domainId, path) {
  return (await User.countDocuments({
    teamReferrals: { $elemMatch: { domainId: Number(domainId), path: String(path) } },
  })) > 0;
}

async function getTeamReferralForDomain(telegramId, domainId) {
  const user = await getUserByTelegramId(telegramId);
  return user?.teamReferrals?.find((row) => Number(row.domainId) === Number(domainId)) || null;
}

async function getTeamReferralByLinkId(telegramId, panelLinkId) {
  const user = await getUserByTelegramId(telegramId);
  const id = Number(panelLinkId);
  if (!Number.isFinite(id)) return null;
  return user?.teamReferrals?.find((row) => Number(row.panelLinkId) === id) || null;
}

async function upsertTeamReferral(telegramId, { domainId, path, panelLinkId }) {
  const user = await getUserByTelegramId(telegramId);
  if (!user) return null;
  const domain = Number(domainId);
  const normalizedPath = String(path || "").replace(/^\/+/, "");
  const linkId = Number.isFinite(Number(panelLinkId)) ? Number(panelLinkId) : null;
  const referrals = (user.teamReferrals || []).filter((row) => {
    if (linkId != null && Number(row.panelLinkId) === linkId) return false;
    if (Number(row.domainId) === domain && String(row.path || "") === normalizedPath) return false;
    return true;
  });
  referrals.push({
    domainId: domain,
    path: normalizedPath,
    panelLinkId: linkId,
  });
  user.teamReferrals = referrals;
  await user.save();
  return user;
}

async function clearTeamReferralForDomain(telegramId, domainId) {
  const user = await getUserByTelegramId(telegramId);
  if (!user) return null;
  const before = (user.teamReferrals || []).length;
  user.teamReferrals = (user.teamReferrals || []).filter(
    (row) => Number(row.domainId) !== Number(domainId)
  );
  if (user.teamReferrals.length === before) return user;
  await user.save();
  return user;
}

async function clearTeamReferralsByDomain(domainId) {
  const id = Number(domainId);
  if (!Number.isFinite(id) || id < 1) return 0;
  const result = await User.updateMany(
    { "teamReferrals.domainId": id },
    { $pull: { teamReferrals: { domainId: id } } }
  );
  return Number(result.modifiedCount || 0);
}

async function clearTeamReferralByLinkId(telegramId, panelLinkId) {
  const user = await getUserByTelegramId(telegramId);
  if (!user) return null;
  const id = Number(panelLinkId);
  if (!Number.isFinite(id)) return user;
  const before = (user.teamReferrals || []).length;
  user.teamReferrals = (user.teamReferrals || []).filter((row) => Number(row.panelLinkId) !== id);
  if (user.teamReferrals.length === before) return user;
  await user.save();
  return user;
}

/** Все рефералки воркеров из Mongo. */
async function listTeamReferralsFromDb() {
  const users = await User.find({ "teamReferrals.0": { $exists: true } })
    .select("telegramId username customId panelUsername teamReferrals")
    .lean();
  const items = [];
  for (const user of users) {
    for (const ref of user.teamReferrals || []) {
      items.push({
        telegramId: String(user.telegramId),
        username: user.username || "",
        customId: user.customId || "",
        panelUsername: user.panelUsername || "",
        domainId: Number(ref.domainId),
        path: String(ref.path || ""),
        panelLinkId: ref.panelLinkId != null ? Number(ref.panelLinkId) : null,
      });
    }
  }
  items.sort((a, b) => {
    if (a.domainId !== b.domainId) return a.domainId - b.domainId;
    return String(a.username).localeCompare(String(b.username));
  });
  return items;
}

module.exports = {
  ensureUser,
  isAdminTelegramId,
  generateCustomId,
  allocateCustomId,
  ensureCustomId,
  backfillTeamCustomIds,
  setTeamMember,
  setBan,
  setCurator,
  listCurators,
  setCaller,
  listCallers,
  setModerator,
  listTeamMembers,
  getUserByTelegramId,
  getUserByPanelUsername,
  setProfitPercent,
  addWalletBalanceUsd,
  setUserBio,
  toggleAnonymous,
  toggleAutoSellLogs,
  setFakeProfitTag,
  searchTeamMembers,
  findUserByQuery,
  isTeamReferralPathTaken,
  getTeamReferralForDomain,
  getTeamReferralByLinkId,
  upsertTeamReferral,
  clearTeamReferralForDomain,
  clearTeamReferralsByDomain,
  clearTeamReferralByLinkId,
  listTeamReferralsFromDb,
};
