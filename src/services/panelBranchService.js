const mongoose = require("mongoose");
const User = require("../models/User");
const Branch = require("../models/Branch");
const BranchApplication = require("../models/BranchApplication");
const ProfitTransaction = require("../models/ProfitTransaction");
const { CREDIT_KINDS } = require("../models/ProfitTransaction");
const { resolveWorkerPhotoUrl } = require("../utils/profilePhoto");
const {
  BRANCH_CREATE_MIN_PROFITS_USD,
  BRANCH_CREATE_COST_USD,
  BRANCH_MAX_PERCENT,
  roundUsd,
  clampBranchPercent,
  getActiveBranchById,
  getOwnedBranch,
  getUserBranch,
  listActiveBranches,
  getBranchStats,
  countBranchMembers,
  listBranchMembers,
  memberProfitTotal,
  daysInBranch,
  assertCanUseBranchFeature,
  getCreateEligibility,
  createEligibleBranch,
  updateBranchSettings,
  createBranchApplication,
  acceptBranchApplication,
  rejectBranchApplication,
  cancelBranchApplication,
  cancelOwnPendingApplication,
  kickBranchMember,
  leaveBranch,
  closeBranchByOwner,
} = require("./branchService");
const { profitStatsFilter } = require("./profitService");

function iso(value) {
  if (!value) return "";
  try {
    return new Date(value).toISOString();
  } catch {
    return "";
  }
}

function ownerPayload(user) {
  if (!user) return {};
  return {
    username: user.username || "",
    firstName: user.firstName || "",
    telegramId: String(user.telegramId || ""),
    avatarUrl: resolveWorkerPhotoUrl(user) || "",
  };
}

function membershipOf(user, branch) {
  if (!user || !branch) return "none";
  if (String(branch.ownerTelegramId) === String(user.telegramId)) return "owner";
  if (String(user.branchId) === String(branch._id)) return "member";
  return "none";
}

async function serializeBranchCard(branch, viewer, statsById, ownersById) {
  const id = String(branch._id);
  const stats = statsById.get(id) || {
    total: 0,
    count: 0,
    members: await countBranchMembers(id),
  };
  const owner = ownersById.get(String(branch.ownerTelegramId)) || null;
  const membership = membershipOf(viewer, branch);
  return {
    id,
    name: branch.name || "",
    description: branch.description || "",
    percent: clampBranchPercent(branch.percent),
    members: Number(stats.members || 0),
    total: roundUsd(stats.total || 0),
    profitCount: Number(stats.count || 0),
    owner: ownerPayload(owner),
    createdAt: iso(branch.createdAt),
    avatarUrl: String(branch.avatarUrl || "").trim(),
    acceptingApplications: branch.acceptingApplications !== false,
    isOwner: membership === "owner",
    isMember: membership === "member",
  };
}

async function loadOwnerMap(branches) {
  const ids = [
    ...new Set(branches.map((b) => String(b.ownerTelegramId || "")).filter(Boolean)),
  ];
  if (!ids.length) return new Map();
  const owners = await User.find({ telegramId: { $in: ids } }).lean();
  return new Map(owners.map((u) => [String(u.telegramId), u]));
}

async function loadStatsMap(branches) {
  const entries = await Promise.all(
    branches.map(async (branch) => {
      const stats = await getBranchStats(branch, "all");
      return [String(branch._id), stats];
    })
  );
  return new Map(entries);
}

async function getPendingApplicationForUser(user) {
  return BranchApplication.findOne({
    applicantTelegramId: String(user.telegramId),
    status: "pending",
  }).lean();
}

async function getBranchMe(user) {
  await assertCanUseBranchFeature(user);
  const [owned, membershipBranch, pending, eligibility] = await Promise.all([
    getOwnedBranch(user.telegramId),
    getUserBranch(user),
    getPendingApplicationForUser(user),
    getCreateEligibility(user).catch((error) => ({
      ok: false,
      profits: 0,
      need: BRANCH_CREATE_MIN_PROFITS_USD,
      missing: BRANCH_CREATE_MIN_PROFITS_USD,
      error: error.message,
    })),
  ]);

  const branch = owned || membershipBranch;
  let myBranch = null;
  if (branch) {
    const stats = await getBranchStats(branch, "all");
    const owners = await loadOwnerMap([branch]);
    myBranch = await serializeBranchCard(
      branch,
      user,
      new Map([[String(branch._id), stats]]),
      owners
    );
  }

  const membership = owned
    ? "owner"
    : membershipBranch
      ? "member"
      : "none";

  return {
    membership,
    branch: myBranch,
    pendingApplication: pending
      ? {
          id: String(pending._id),
          branchId: String(pending.branchId),
          status: pending.status,
          createdAt: iso(pending.createdAt),
        }
      : null,
    create: {
      canCreate: Boolean(eligibility.ok),
      profitsUsd: roundUsd(eligibility.profits || 0),
      needUsd: BRANCH_CREATE_MIN_PROFITS_USD,
      missingUsd: roundUsd(eligibility.missing || 0),
      costUsd: BRANCH_CREATE_COST_USD,
      maxPercent: BRANCH_MAX_PERCENT,
    },
  };
}

async function getBranchCatalog(user) {
  await assertCanUseBranchFeature(user);
  const branches = await listActiveBranches();
  const [statsById, ownersById, pending] = await Promise.all([
    loadStatsMap(branches),
    loadOwnerMap(branches),
    getPendingApplicationForUser(user),
  ]);
  const cards = await Promise.all(
    branches.map((branch) => serializeBranchCard(branch, user, statsById, ownersById))
  );
  return {
    branches: cards,
    pendingApplication: pending
      ? {
          id: String(pending._id),
          branchId: String(pending.branchId),
          status: pending.status,
          createdAt: iso(pending.createdAt),
        }
      : null,
  };
}

async function requireMemberBranch(user) {
  const branch = await getUserBranch(user);
  if (!branch) {
    const err = new Error("Ты не состоишь в филиале.");
    err.status = 404;
    throw err;
  }
  return branch;
}

async function requireOwnedBranch(user) {
  const branch = await getOwnedBranch(user.telegramId);
  if (!branch) {
    const err = new Error("У тебя нет филиала.");
    err.status = 403;
    throw err;
  }
  return branch;
}

function emptySeries(days) {
  const out = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    out.push({
      date: d.toISOString().slice(0, 10),
      totalUsd: 0,
      profitUsd: 0,
      logsUsd: 0,
      logsCount: 0,
      mafileCount: 0,
    });
  }
  return out;
}

async function buildProfitSeries(match, days) {
  const series = emptySeries(days);
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - (days - 1));

  const rows = await ProfitTransaction.aggregate([
    {
      $match: {
        ...match,
        createdAt: { $gte: since },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
        },
        profits: { $sum: "$workerShare" },
        logs: {
          $sum: { $cond: [{ $eq: ["$kind", CREDIT_KINDS.PROFIT] }, 1, 0] },
        },
      },
    },
  ]);

  const byDay = new Map(rows.map((row) => [row._id, row]));
  return series.map((point) => {
    const hit = byDay.get(point.date);
    if (!hit) return point;
    const profitUsd = roundUsd(hit.profits || 0);
    return {
      ...point,
      totalUsd: profitUsd,
      profitUsd,
      logsUsd: profitUsd,
      logsCount: Number(hit.logs || 0),
      mafileCount: 0,
    };
  });
}

function branchProfitMatch(branchId) {
  return {
    branchId: String(branchId),
    kind: { $in: [CREDIT_KINDS.PROFIT, CREDIT_KINDS.BRANCH_COMMISSION] },
  };
}

async function topWorkersForBranch(branchId, period) {
  const since =
    period === "day"
      ? new Date(Date.now() - 24 * 60 * 60 * 1000)
      : period === "7d"
        ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        : null;
  const match = {
    branchId: String(branchId),
    kind: CREDIT_KINDS.PROFIT,
  };
  if (since) match.createdAt = { $gte: since };

  const rows = await ProfitTransaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$userId",
        profits: { $sum: "$workerShare" },
      },
    },
    { $sort: { profits: -1 } },
    { $limit: 10 },
  ]);

  const userIds = rows
    .map((row) => row._id)
    .filter((id) => id && mongoose.Types.ObjectId.isValid(String(id)));
  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } }).lean()
    : [];
  const byId = new Map(users.map((u) => [String(u._id), u]));

  return rows
    .map((row) => {
      const user = byId.get(String(row._id));
      if (!user) return null;
      const isAnonymous = Boolean(user.isAnonymous);
      return {
        id: String(user.telegramId),
        username: user.username || user.firstName || user.telegramId,
        avatarUrl: isAnonymous ? "" : resolveWorkerPhotoUrl(user) || "",
        profits: roundUsd(row.profits || 0),
        isAnonymous,
        fakeProfitTag: String(user.fakeProfitTag || ""),
      };
    })
    .filter(Boolean);
}

async function getBranchOverview(user) {
  const branch = await requireMemberBranch(user);
  const stats = await getBranchStats(branch, "all");
  const owners = await loadOwnerMap([branch]);
  const card = await serializeBranchCard(
    branch,
    user,
    new Map([[String(branch._id), stats]]),
    owners
  );

  const pendingApps =
    membershipOf(user, branch) === "owner"
      ? await BranchApplication.countDocuments({
          branchId: String(branch._id),
          status: "pending",
        })
      : 0;

  const match = branchProfitMatch(branch._id);
  const [series7, series14, series30, topDay, top7d, topAll] = await Promise.all([
    buildProfitSeries(match, 7),
    buildProfitSeries(match, 14),
    buildProfitSeries(match, 30),
    topWorkersForBranch(branch._id, "day"),
    topWorkersForBranch(branch._id, "7d"),
    topWorkersForBranch(branch._id, "all"),
  ]);

  return {
    branch: card,
    pendingApplications: pendingApps,
    series: { 7: series7, 14: series14, 30: series30 },
    topWorkers: { day: topDay, "7d": top7d, all: topAll },
    achievements: [],
  };
}

async function applicantSeries(userId) {
  const match = profitStatsFilter({ userId });
  const [s7, s14, sAll] = await Promise.all([
    buildProfitSeries(match, 7),
    buildProfitSeries(match, 14),
    buildProfitSeries(match, 30),
  ]);
  return { "7": s7, "14": s14, all: sAll };
}

async function serializeApplicationRow(app, applicant) {
  const profits = applicant ? await memberProfitTotal(applicant) : 0;
  const daysActive = applicant
    ? Math.max(
        1,
        Math.floor(
          (Date.now() - new Date(applicant.createdAt || Date.now()).getTime()) /
            (1000 * 60 * 60 * 24)
        )
      )
    : 1;
  const series = applicant
    ? await applicantSeries(applicant._id)
    : { "7": emptySeries(7), "14": emptySeries(14), all: emptySeries(30) };

  return {
    id: String(app._id),
    username: applicant?.username || applicant?.firstName || app.applicantTelegramId,
    avatarUrl: applicant ? resolveWorkerPhotoUrl(applicant) || "" : "",
    note: "",
    profitsTotal: profits,
    profitsSeries: series,
    daysActive,
    appliedAt: iso(app.createdAt),
    status: app.status,
    decidedAt: app.status === "pending" ? undefined : iso(app.updatedAt),
    telegramId: String(app.applicantTelegramId),
  };
}

async function getBranchMembersPayload(user) {
  const branch = await requireMemberBranch(user);
  const isOwner = String(branch.ownerTelegramId) === String(user.telegramId);
  const members = await listBranchMembers(branch._id, 50);

  const memberRows = await Promise.all(
    members.map(async (member) => {
      const profits = await memberProfitTotal(member);
      const role =
        String(member.telegramId) === String(branch.ownerTelegramId)
          ? "owner"
          : "member";
      return {
        id: String(member.telegramId),
        username: member.username || member.firstName || member.telegramId,
        profits,
        joinedDays: daysInBranch(member),
        role,
        avatarUrl: resolveWorkerPhotoUrl(member) || "",
        telegramId: String(member.telegramId),
      };
    })
  );

  let applications = [];
  if (isOwner) {
    const apps = await BranchApplication.find({ branchId: String(branch._id) })
      .sort({ createdAt: -1 })
      .limit(40)
      .lean();
    const applicantIds = [
      ...new Set(apps.map((a) => String(a.applicantTelegramId)).filter(Boolean)),
    ];
    const applicants = applicantIds.length
      ? await User.find({ telegramId: { $in: applicantIds } })
      : [];
    const byTg = new Map(applicants.map((u) => [String(u.telegramId), u]));
    applications = await Promise.all(
      apps.map((app) => serializeApplicationRow(app, byTg.get(String(app.applicantTelegramId))))
    );
  }

  return {
    members: memberRows,
    applications,
    invites: [],
  };
}

async function createBranchFromPanel(user, body) {
  const branch = await createEligibleBranch(user, {
    name: body?.name,
    description: body?.description,
    percent: body?.percent,
  });
  if (body?.avatarUrl != null || body?.acceptingApplications != null) {
    await updateBranchSettings(user.telegramId, {
      avatarUrl: body.avatarUrl,
      acceptingApplications: body.acceptingApplications,
    });
  }
  const fresh = await Branch.findById(branch._id);
  const stats = await getBranchStats(fresh, "all");
  const owners = await loadOwnerMap([fresh]);
  return serializeBranchCard(
    fresh,
    user,
    new Map([[String(fresh._id), stats]]),
    owners
  );
}

async function applyToBranch(user, branchId) {
  const branch = await getActiveBranchById(branchId);
  if (!branch) {
    const err = new Error("Филиал не найден.");
    err.status = 404;
    throw err;
  }
  const app = await createBranchApplication(user, branch);
  return {
    id: String(app._id),
    branchId: String(app.branchId),
    status: app.status,
    createdAt: iso(app.createdAt),
  };
}

async function patchOwnBranch(user, body) {
  await requireOwnedBranch(user);
  const branch = await updateBranchSettings(user.telegramId, {
    name: body?.name,
    description: body?.description,
    percent: body?.percent,
    acceptingApplications: body?.acceptingApplications,
    avatarUrl: body?.avatarUrl,
  });
  const stats = await getBranchStats(branch, "all");
  const owners = await loadOwnerMap([branch]);
  return serializeBranchCard(
    branch,
    user,
    new Map([[String(branch._id), stats]]),
    owners
  );
}

async function deleteOwnBranch(user) {
  await requireOwnedBranch(user);
  await closeBranchByOwner(user.telegramId, {
    actorTelegramId: String(user.telegramId || ""),
  });
  return { ok: true };
}

module.exports = {
  getBranchMe,
  getBranchCatalog,
  getBranchOverview,
  getBranchMembersPayload,
  createBranchFromPanel,
  applyToBranch,
  patchOwnBranch,
  deleteOwnBranch,
  acceptBranchApplication,
  rejectBranchApplication,
  cancelBranchApplication,
  cancelOwnPendingApplication,
  kickBranchMember,
  leaveBranch,
};
