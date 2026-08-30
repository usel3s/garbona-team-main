const mongoose = require("mongoose");
const User = require("../models/User");
const Branch = require("../models/Branch");
const BranchApplication = require("../models/BranchApplication");
const ProfitTransaction = require("../models/ProfitTransaction");
const { CREDIT_KINDS } = require("../models/ProfitTransaction");
const { Markup } = require("telegraf");
const { pe, btn } = require("../utils/emoji");

const BRANCH_CREATE_MIN_PROFITS_USD = 100;
const BRANCH_CREATE_COST_USD = BRANCH_CREATE_MIN_PROFITS_USD;
const BRANCH_MAX_PERCENT = 10;
const BRANCH_NAME_MAX = 32;
const BRANCH_DESC_MAX = 500;

function roundUsd(value) {
  return Number((Math.round(Number(value) * 100) / 100).toFixed(2));
}

function branchCreateMinStatsMessage(need = BRANCH_CREATE_MIN_PROFITS_USD) {
  return `Ваша статистика должна быть не менее $${Number(need).toFixed(0)}.`;
}

function isCreateEligible({ canCreateBranch, profits }) {
  const waived = Boolean(canCreateBranch);
  const earned = Number(profits) || 0;
  if (waived || earned + 1e-9 >= BRANCH_CREATE_MIN_PROFITS_USD) {
    return {
      ok: true,
      waived,
      profits: roundUsd(earned),
      need: BRANCH_CREATE_MIN_PROFITS_USD,
      missing: 0,
    };
  }
  return {
    ok: false,
    waived: false,
    profits: roundUsd(earned),
    need: BRANCH_CREATE_MIN_PROFITS_USD,
    missing: roundUsd(Math.max(0, BRANCH_CREATE_MIN_PROFITS_USD - earned)),
  };
}

function clampBranchPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(BRANCH_MAX_PERCENT, Math.round(n)));
}

function splitBranchCommission(workerShare, percent) {
  const share = roundUsd(workerShare);
  const pct = clampBranchPercent(percent);
  if (!(share > 0) || pct <= 0) {
    return { net: share, commission: 0 };
  }
  const commission = roundUsd((share * pct) / 100);
  const net = roundUsd(Math.max(0, share - commission));
  if (!(commission > 0) || net < 0) {
    return { net: share, commission: 0 };
  }
  return { net, commission };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeBranchName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  if (name.length < 2) throw new Error("Название филиала — минимум 2 символа.");
  if (name.length > BRANCH_NAME_MAX) {
    throw new Error(`Название филиала — максимум ${BRANCH_NAME_MAX} символов.`);
  }
  return name;
}

function normalizeBranchDescription(value) {
  return String(value || "").trim().slice(0, BRANCH_DESC_MAX);
}

function curatorConflictMessage(user) {
  if (user?.isCurator) {
    return "Ты куратор. Филиал недоступен — обратись к администрации.";
  }
  if (user?.curatorTelegramId) {
    return "Ты привязан к куратору. Филиал недоступен — обратись к администрации.";
  }
  return "";
}

function assertNoCuratorConflict(user) {
  const message = curatorConflictMessage(user);
  if (message) throw new Error(message);
}

function ownerMention(owner) {
  if (owner?.username) return `@${escapeHtml(owner.username)}`;
  return `<code>${escapeHtml(owner?.telegramId || "—")}</code>`;
}

async function getActiveBranchById(branchId) {
  const id = String(branchId || "").trim();
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return Branch.findOne({ _id: id, status: "active" });
}

async function getOwnedBranch(telegramId) {
  return Branch.findOne({
    ownerTelegramId: String(telegramId),
    status: "active",
  });
}

async function getUserBranch(user) {
  if (!user?.branchId) return null;
  return getActiveBranchById(user.branchId);
}

async function listActiveBranches() {
  return Branch.find({ status: "active" }).sort({ createdAt: 1 }).limit(50);
}

async function applyBranchCommission(user, workerShare) {
  const share = roundUsd(workerShare);
  const empty = {
    net: share,
    commission: 0,
    ownerTelegramId: "",
    branchId: "",
  };
  if (!user?.branchId || !(share > 0)) return empty;

  const branch = await getActiveBranchById(user.branchId);
  if (!branch) return empty;
  if (String(branch.ownerTelegramId) === String(user.telegramId)) {
    return { ...empty, branchId: String(branch._id) };
  }

  const { net, commission } = splitBranchCommission(share, branch.percent);
  return {
    net,
    commission,
    ownerTelegramId: commission > 0 ? String(branch.ownerTelegramId) : "",
    branchId: String(branch._id),
  };
}

async function countBranchMembers(branchId) {
  return User.countDocuments({
    branchId: String(branchId),
    isBanned: { $ne: true },
    telegramId: { $not: /^padmin:/i },
  });
}

function startOfPeriod(period) {
  const now = new Date();
  if (period === "24h") return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (period === "7d") return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (period === "30d") return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return null;
}

async function getBranchStats(branch, period = "all") {
  const branchId = String(branch._id);
  const since = startOfPeriod(period);
  const match = {
    branchId,
    kind: { $in: [CREDIT_KINDS.PROFIT, CREDIT_KINDS.BRANCH_COMMISSION] },
  };
  if (since) match.createdAt = { $gte: since };

  const [agg] = await ProfitTransaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        total: { $sum: "$workerShare" },
        count: {
          $sum: { $cond: [{ $eq: ["$kind", CREDIT_KINDS.PROFIT] }, 1, 0] },
        },
      },
    },
  ]);

  const memberCount = await countBranchMembers(branchId);
  return {
    total: roundUsd(agg?.total || 0),
    count: Number(agg?.count || 0),
    members: memberCount,
  };
}

async function getTopBranches(period = "all", limit = 10) {
  const since = startOfPeriod(period);
  const match = {
    branchId: { $gt: "" },
    kind: { $in: [CREDIT_KINDS.PROFIT, CREDIT_KINDS.BRANCH_COMMISSION] },
  };
  if (since) match.createdAt = { $gte: since };

  const rows = await ProfitTransaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$branchId",
        total: { $sum: "$workerShare" },
        count: {
          $sum: { $cond: [{ $eq: ["$kind", CREDIT_KINDS.PROFIT] }, 1, 0] },
        },
      },
    },
    { $sort: { total: -1, count: -1 } },
    { $limit: Math.max(1, Math.min(20, Number(limit) || 10)) },
  ]);

  const ids = rows.map((row) => row._id).filter((id) => mongoose.Types.ObjectId.isValid(id));
  const branches = ids.length
    ? await Branch.find({ _id: { $in: ids }, status: "active" }).lean()
    : [];
  const byId = new Map(branches.map((b) => [String(b._id), b]));

  return rows
    .map((row) => {
      const branch = byId.get(String(row._id));
      if (!branch) return null;
      return {
        branch,
        total: roundUsd(row.total || 0),
        count: Number(row.count || 0),
      };
    })
    .filter(Boolean);
}

async function listBranchMembers(branchId, limit = 30) {
  return User.find({
    branchId: String(branchId),
    telegramId: { $not: /^padmin:/i },
  })
    .sort({ branchJoinedAt: 1, createdAt: 1 })
    .limit(Math.max(1, Math.min(50, Number(limit) || 30)));
}

async function memberProfitTotal(user) {
  if (!user?._id) return 0;
  const { profitStatsFilter } = require("./profitService");
  const [agg] = await ProfitTransaction.aggregate([
    { $match: profitStatsFilter({ userId: user._id }) },
    { $group: { _id: null, total: { $sum: "$workerShare" } } },
  ]);
  return roundUsd(agg?.total || 0);
}

function daysInBranch(user) {
  const from = user?.branchJoinedAt || user?.createdAt;
  if (!from) return 1;
  return Math.max(1, Math.floor((Date.now() - new Date(from).getTime()) / (1000 * 60 * 60 * 24)));
}

async function assertCanUseBranchFeature(user) {
  if (!user?.isTeamMember) throw new Error("Филиалы доступны участникам команды.");
  if (user.isBanned) throw new Error("Доступ ограничен.");
  assertNoCuratorConflict(user);
}

async function createBranchForUser(user, { name, description, percent, via, paidUsd = 0 }) {
  await assertCanUseBranchFeature(user);
  if (user.branchId) throw new Error("Ты уже состоишь в филиале.");
  const existing = await getOwnedBranch(user.telegramId);
  if (existing) throw new Error("У тебя уже есть филиал.");

  const normalizedName = normalizeBranchName(name);
  const dup = await Branch.findOne({
    status: "active",
    name: new RegExp(`^${escapeRegex(normalizedName)}$`, "i"),
  });
  if (dup) throw new Error("Филиал с таким названием уже есть.");

  const branch = await Branch.create({
    ownerTelegramId: String(user.telegramId),
    name: normalizedName,
    description: normalizeBranchDescription(description),
    percent: clampBranchPercent(percent),
    status: "active",
    createdVia: via,
    paidUsd: roundUsd(paidUsd || 0),
  });

  user.branchId = String(branch._id);
  user.branchJoinedAt = new Date();
  await user.save();
  return branch;
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function getCreateEligibility(user) {
  await assertCanUseBranchFeature(user);
  const [profits, fresh] = await Promise.all([
    memberProfitTotal(user),
    user?.telegramId
      ? User.findOne({ telegramId: String(user.telegramId) })
          .select("canCreateBranch")
          .lean()
      : null,
  ]);
  return isCreateEligible({
    canCreateBranch: Boolean(user?.canCreateBranch || fresh?.canCreateBranch),
    profits,
  });
}

async function createEligibleBranch(user, draft) {
  const eligibility = await getCreateEligibility(user);
  if (!eligibility.ok) {
    throw new Error(branchCreateMinStatsMessage(eligibility.need));
  }
  return createBranchForUser(user, {
    ...draft,
    via: eligibility.waived ? "admin" : "profits",
    paidUsd: 0,
  });
}

async function grantBranchCreateAccess(telegramId, value) {
  const user = await User.findOne({ telegramId: String(telegramId) });
  if (!user) throw new Error("Пользователь не найден.");
  if (value) {
    assertNoCuratorConflict(user);
  }
  user.canCreateBranch = Boolean(value);
  await user.save();
  return user;
}

async function closeBranchByOwner(ownerTelegramId, { actorTelegramId = "" } = {}) {
  const branch = await getOwnedBranch(ownerTelegramId);
  if (!branch) throw new Error("Активный филиал не найден.");
  return closeBranch(branch, { actorTelegramId });
}

async function closeBranch(branch, { actorTelegramId = "" } = {}) {
  void actorTelegramId;
  branch.status = "closed";
  await branch.save();
  await User.updateMany(
    { branchId: String(branch._id) },
    { $set: { branchId: "", branchJoinedAt: null } }
  );
  await BranchApplication.updateMany(
    { branchId: String(branch._id), status: "pending" },
    { $set: { status: "rejected" } }
  );
  return branch;
}

async function updateBranchSettings(ownerTelegramId, { name, description, percent, acceptingApplications, avatarUrl }) {
  const branch = await getOwnedBranch(ownerTelegramId);
  if (!branch) throw new Error("У тебя нет филиала.");
  if (name != null) {
    const normalizedName = normalizeBranchName(name);
    const dup = await Branch.findOne({
      _id: { $ne: branch._id },
      status: "active",
      name: new RegExp(`^${escapeRegex(normalizedName)}$`, "i"),
    });
    if (dup) throw new Error("Филиал с таким названием уже есть.");
    branch.name = normalizedName;
  }
  if (description != null) {
    branch.description = normalizeBranchDescription(description);
  }
  if (percent != null) {
    const p = Number(percent);
    if (!Number.isFinite(p) || p < 0 || p > BRANCH_MAX_PERCENT || !Number.isInteger(p)) {
      throw new Error(`Процент должен быть целым числом от 0 до ${BRANCH_MAX_PERCENT}.`);
    }
    branch.percent = p;
  }
  if (acceptingApplications != null) {
    branch.acceptingApplications = Boolean(acceptingApplications);
  }
  if (avatarUrl != null) {
    branch.avatarUrl = String(avatarUrl || "").trim().slice(0, 500);
  }
  await branch.save();
  return branch;
}

async function cancelBranchApplication(applicantTelegramId, applicationId) {
  const app = await BranchApplication.findById(applicationId);
  if (!app || app.status !== "pending") throw new Error("Заявка не найдена или уже обработана.");
  if (String(app.applicantTelegramId) !== String(applicantTelegramId)) {
    throw new Error("Это не твоя заявка.");
  }
  app.status = "rejected";
  await app.save();
  return app;
}

async function cancelOwnPendingApplication(applicantTelegramId) {
  const app = await BranchApplication.findOne({
    applicantTelegramId: String(applicantTelegramId),
    status: "pending",
  });
  if (!app) throw new Error("Активная заявка не найдена.");
  app.status = "rejected";
  await app.save();
  return app;
}

async function kickBranchMember(ownerTelegramId, memberTelegramId) {
  const branch = await getOwnedBranch(ownerTelegramId);
  if (!branch) throw new Error("У тебя нет филиала.");
  if (String(memberTelegramId) === String(ownerTelegramId)) {
    throw new Error("Нельзя исключить владельца.");
  }
  const member = await User.findOne({ telegramId: String(memberTelegramId) });
  if (!member || String(member.branchId) !== String(branch._id)) {
    throw new Error("Участник не найден в филиале.");
  }
  member.branchId = "";
  member.branchJoinedAt = null;
  await member.save();
  return member;
}

async function createBranchApplication(applicant, branch) {
  await assertCanUseBranchFeature(applicant);
  if (!branch || branch.status !== "active") throw new Error("Филиал не найден.");
  if (branch.acceptingApplications === false) {
    throw new Error("Филиал сейчас не принимает заявки.");
  }
  if (String(applicant.telegramId) === String(branch.ownerTelegramId)) {
    throw new Error("Это твой филиал.");
  }
  if (applicant.branchId) throw new Error("Ты уже состоишь в филиале.");

  const existingPending = await BranchApplication.findOne({
    applicantTelegramId: String(applicant.telegramId),
    status: "pending",
  });
  if (existingPending) {
    throw new Error("У тебя уже есть заявка на рассмотрении.");
  }

  return BranchApplication.create({
    applicantTelegramId: String(applicant.telegramId),
    branchId: String(branch._id),
    ownerTelegramId: String(branch.ownerTelegramId),
    status: "pending",
  });
}

async function acceptBranchApplication(applicationId, ownerTelegramId) {
  const app = await BranchApplication.findById(applicationId);
  if (!app || app.status !== "pending") throw new Error("Заявка не найдена или уже обработана.");
  if (String(app.ownerTelegramId) !== String(ownerTelegramId)) {
    throw new Error("Это не твоя заявка.");
  }

  const branch = await getActiveBranchById(app.branchId);
  if (!branch) {
    app.status = "rejected";
    await app.save();
    throw new Error("Филиал больше не активен.");
  }

  const applicant = await User.findOne({ telegramId: app.applicantTelegramId });
  if (!applicant) throw new Error("Заявитель не найден.");
  assertNoCuratorConflict(applicant);
  if (applicant.branchId) {
    app.status = "rejected";
    await app.save();
    throw new Error("Заявитель уже состоит в другом филиале.");
  }

  applicant.branchId = String(branch._id);
  applicant.branchJoinedAt = new Date();
  await applicant.save();
  app.status = "accepted";
  await app.save();

  await BranchApplication.updateMany(
    {
      applicantTelegramId: app.applicantTelegramId,
      status: "pending",
      _id: { $ne: app._id },
    },
    { status: "rejected" }
  );

  return { app, applicant, branch };
}

async function rejectBranchApplication(applicationId, ownerTelegramId) {
  const app = await BranchApplication.findById(applicationId);
  if (!app || app.status !== "pending") throw new Error("Заявка не найдена или уже обработана.");
  if (String(app.ownerTelegramId) !== String(ownerTelegramId)) {
    throw new Error("Это не твоя заявка.");
  }
  app.status = "rejected";
  await app.save();
  return app;
}

async function leaveBranch(user) {
  if (!user?.branchId) throw new Error("Ты не состоишь в филиале.");
  const branch = await getActiveBranchById(user.branchId);
  if (branch && String(branch.ownerTelegramId) === String(user.telegramId)) {
    throw new Error("Владелец не может покинуть филиал. Сначала закрой его через администрацию.");
  }
  user.branchId = "";
  user.branchJoinedAt = null;
  await user.save();
  return { user, branch };
}

function branchCardKeyboard(branch, { isOwner = false, isMember = false } = {}) {
  const id = String(branch._id);
  if (isOwner || isMember) {
    return Markup.inlineKeyboard([
      [btn("Открыть филиал", `br:card:${id}`, "users")],
    ]);
  }
  return Markup.inlineKeyboard([
    [btn("Подать заявку", `br:apply:${id}`, "notification")],
  ]);
}

function buildBranchCardHtml(branch, owner, stats, currencyLabel) {
  const description = String(branch.description || "").trim() || "Описание пока не указано.";
  return [
    `${pe("users")} <b>${escapeHtml(branch.name)}</b>`,
    "",
    `${pe("profile")} Владелец: ${ownerMention(owner)}`,
    `${pe("analytics")} Процент филиала: <b>${clampBranchPercent(branch.percent)}%</b>`,
    `${pe("users")} Участников: <b>${stats?.members ?? 0}</b>`,
    `${pe("coins")} Касса: <b>${currencyLabel}</b>${stats?.count ? ` · ${stats.count} проф.` : ""}`,
    "",
    `${pe("edit")} <b>Описание</b>`,
    escapeHtml(description),
  ].join("\n");
}

function buildBranchApplicationNotifyHtml(applicant, branch) {
  const nick = applicant.username ? `@${escapeHtml(applicant.username)}` : "без username";
  return [
    `${pe("notification")} <b>Заявка в филиал</b>`,
    "",
    `${pe("users")} Филиал: <b>${escapeHtml(branch.name)}</b>`,
    `${pe("profile")} От: ${nick}`,
    `${pe("users")} ID: <code>${escapeHtml(applicant.telegramId)}</code>`,
  ].join("\n");
}

function branchApplicationModerationKeyboard(applicationId) {
  const id = String(applicationId);
  return Markup.inlineKeyboard([
    [
      btn("Принять", `br:accept:${id}`, "success"),
      btn("Отклонить", `br:reject:${id}`, "error"),
    ],
  ]);
}

module.exports = {
  BRANCH_CREATE_MIN_PROFITS_USD,
  BRANCH_CREATE_COST_USD,
  BRANCH_MAX_PERCENT,
  BRANCH_NAME_MAX,
  BRANCH_DESC_MAX,
  roundUsd,
  branchCreateMinStatsMessage,
  isCreateEligible,
  clampBranchPercent,
  splitBranchCommission,
  escapeHtml,
  normalizeBranchName,
  normalizeBranchDescription,
  curatorConflictMessage,
  assertNoCuratorConflict,
  ownerMention,
  getActiveBranchById,
  getOwnedBranch,
  getUserBranch,
  listActiveBranches,
  applyBranchCommission,
  countBranchMembers,
  getBranchStats,
  getTopBranches,
  listBranchMembers,
  memberProfitTotal,
  daysInBranch,
  assertCanUseBranchFeature,
  createBranchForUser,
  getCreateEligibility,
  createEligibleBranch,
  grantBranchCreateAccess,
  closeBranchByOwner,
  closeBranch,
  updateBranchSettings,
  createBranchApplication,
  acceptBranchApplication,
  rejectBranchApplication,
  cancelBranchApplication,
  cancelOwnPendingApplication,
  kickBranchMember,
  leaveBranch,
  branchCardKeyboard,
  buildBranchCardHtml,
  buildBranchApplicationNotifyHtml,
  branchApplicationModerationKeyboard,
};
