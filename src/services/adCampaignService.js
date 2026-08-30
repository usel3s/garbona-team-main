const crypto = require("crypto");
const AdCampaign = require("../models/AdCampaign");
const User = require("../models/User");
const Application = require("../models/Application");
const ProfitTransaction = require("../models/ProfitTransaction");
const { profitStatsFilter } = require("./profitService");
const { periodSince } = require("./adminStatsService");
const { env } = require("../config/env");

const START_PREFIX = "c_";
const SLUG_PATTERN = /^[a-z0-9_]{2,24}$/;
const SLUG_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789_";

function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 24);
}

function validateSlug(slug) {
  const normalized = normalizeSlug(slug);
  if (!SLUG_PATTERN.test(normalized)) {
    throw new Error("Ссылка: 2–24 символа, лatinica, цифры и _.");
  }
  return normalized;
}

function validateCampaignName(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) throw new Error("Укажите название рекламы.");
  if (trimmed.length > 80) throw new Error("Название не длиннее 80 символов.");
  return trimmed;
}

function validateSlugInput(slug) {
  const normalized = validateSlug(slug);
  return normalized;
}

function generateSlug(length = 8) {
  const size = Math.max(2, Math.min(24, Number(length) || 8));
  let out = "";
  for (let i = 0; i < size; i += 1) {
    out += SLUG_CHARS[crypto.randomInt(0, SLUG_CHARS.length)];
  }
  return out;
}

async function allocateUniqueSlug(preferred = "") {
  const normalized = preferred ? normalizeSlug(preferred) : "";
  if (normalized && SLUG_PATTERN.test(normalized)) {
    const taken = await AdCampaign.exists({ slug: normalized });
    if (!taken) return normalized;
    if (preferred) {
      throw new Error(`Метка «${normalized}» уже занята.`);
    }
  }

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const slug = generateSlug();
    const taken = await AdCampaign.exists({ slug });
    if (!taken) return slug;
  }
  throw new Error("Не удалось выделить уникальную метку кампании.");
}

function parseCampaignStartPayload(payload) {
  const raw = String(payload || "").trim();
  if (!raw.startsWith(START_PREFIX)) return "";
  const slug = normalizeSlug(raw.slice(START_PREFIX.length));
  return SLUG_PATTERN.test(slug) ? slug : "";
}

function isServiceStartPayload(payload) {
  const raw = String(payload || "").trim();
  if (!raw) return false;
  if (/^payout_[a-f0-9]{24}$/i.test(raw)) return true;
  if (/^(feedback|fb)$/i.test(raw)) return true;
  if (/^fb_(reply|close)_[a-f0-9]{24}$/i.test(raw)) return true;
  if (/^u_\d+(?:_(all|24h|7d|30d))?$/.test(raw)) return true;
  if (raw.startsWith("dsc_")) return true;
  return false;
}

function buildTelegramDeepLink(slug, botUsername = env.botUsername) {
  const username = String(botUsername || "").replace(/^@/, "").trim();
  const normalized = normalizeSlug(slug);
  if (!username || !SLUG_PATTERN.test(normalized)) return "";
  return `https://t.me/${username}?start=${START_PREFIX}${normalized}`;
}

function buildTrackingRedirectUrl(slug, panelPublicUrl = env.panelPublicUrl) {
  const normalized = normalizeSlug(slug);
  if (!SLUG_PATTERN.test(normalized)) return "";
  const base = String(panelPublicUrl || "").replace(/\/$/, "");
  if (!base) return "";
  return `${base}/r/${encodeURIComponent(normalized)}`;
}

function ratePercent(numerator, denominator) {
  const num = Number(numerator || 0);
  const den = Number(denominator || 0);
  if (!den) return null;
  return Math.round((num / den) * 10000) / 100;
}

function buildFunnelMetrics({ starts = 0, applications = 0, accepted = 0, firstProfit = 0, clicks = 0 } = {}) {
  return {
    starts,
    applications,
    accepted,
    firstProfit,
    clicks,
    startToApplication: ratePercent(applications, starts),
    applicationToAccepted: ratePercent(accepted, applications),
    acceptedToProfit: ratePercent(firstProfit, accepted),
    startToAccepted: ratePercent(accepted, starts),
    startToProfit: ratePercent(firstProfit, starts),
  };
}

function cohortDateMatch(period) {
  const since = period === "all" ? null : periodSince(period);
  return since ? { $gte: since } : null;
}

async function getCampaignBySlug(slug) {
  const normalized = normalizeSlug(slug);
  if (!SLUG_PATTERN.test(normalized)) return null;
  return AdCampaign.findOne({ slug: normalized });
}

async function getCampaignById(campaignId) {
  const id = String(campaignId || "").trim();
  if (!id) return null;
  return AdCampaign.findById(id);
}

async function listCampaigns() {
  return AdCampaign.find().sort({ createdAt: -1 }).lean();
}

async function createCampaign({ name, slug, source = "", createdByTelegramId = "" }) {
  const adName = validateCampaignName(name);
  const normalizedSlug = validateSlugInput(slug);
  const taken = await AdCampaign.exists({ slug: normalizedSlug });
  if (taken) {
    throw new Error(`Ссылка «${normalizedSlug}» уже занята.`);
  }

  return AdCampaign.create({
    name: adName,
    slug: normalizedSlug,
    source: String(source || "").trim().slice(0, 120),
    createdByTelegramId: String(createdByTelegramId || ""),
    status: "active",
  });
}

async function deleteCampaign(campaignId) {
  const campaign = await AdCampaign.findByIdAndDelete(String(campaignId || ""));
  if (!campaign) throw new Error("Реклама не найдена.");
  return campaign;
}

async function setCampaignStatus(campaignId, status) {
  const next = status === "paused" ? "paused" : "active";
  const campaign = await AdCampaign.findByIdAndUpdate(
    campaignId,
    { $set: { status: next } },
    { new: true }
  );
  if (!campaign) throw new Error("Реклама не найдена.");
  return campaign;
}

async function incrementCampaignClick(slug) {
  const campaign = await getCampaignBySlug(slug);
  if (!campaign) return null;
  campaign.clickCount = Number(campaign.clickCount || 0) + 1;
  await campaign.save();
  return campaign;
}

/**
 * First paid touch: set campaign on user if not already attributed.
 * Organic /start without payload does not block later attribution.
 */
async function attributeUserFromStartPayload(user, payload) {
  if (!user?._id) return { attributed: false, reason: "no_user" };
  if (String(user.campaignId || "").trim()) {
    return { attributed: false, reason: "already_attributed", user };
  }

  const slug = parseCampaignStartPayload(payload);
  if (!slug) return { attributed: false, reason: "no_campaign_payload", user };

  const campaign = await getCampaignBySlug(slug);
  if (!campaign) return { attributed: false, reason: "unknown_campaign", user };

  user.campaignId = String(campaign._id);
  user.campaignSlug = campaign.slug;
  user.campaignAttributedAt = new Date();
  await user.save();

  return { attributed: true, campaign, user };
}

function applicationCampaignSnapshot(user) {
  if (!user?.campaignId) return { campaignId: "", campaignSlug: "" };
  return {
    campaignId: String(user.campaignId),
    campaignSlug: String(user.campaignSlug || ""),
  };
}

async function countUsersWithFirstProfit(userIds) {
  const ids = [...new Set((userIds || []).map((id) => String(id)).filter(Boolean))];
  if (!ids.length) return 0;

  const rows = await ProfitTransaction.aggregate([
    { $match: profitStatsFilter({ userId: { $in: ids.map((id) => new mongooseObjectId(id)) } }) },
    { $group: { _id: "$userId" } },
    { $count: "count" },
  ]);
  return Number(rows[0]?.count || 0);
}

function mongooseObjectId(id) {
  const mongoose = require("mongoose");
  return new mongoose.Types.ObjectId(String(id));
}

async function computeCampaignFunnel(campaignId, period = "all") {
  const id = String(campaignId || "");
  const dateMatch = cohortDateMatch(period);
  const userQuery = { campaignId: id };
  if (dateMatch) userQuery.campaignAttributedAt = dateMatch;

  const cohortUsers = await User.find(userQuery).select("_id").lean();
  const userIds = cohortUsers.map((row) => String(row._id));
  const starts = userIds.length;

  if (!starts) {
    const campaign = id ? await getCampaignById(id) : null;
    return buildFunnelMetrics({ clicks: Number(campaign?.clickCount || 0) });
  }

  const objectIds = userIds.map((uid) => mongooseObjectId(uid));
  const [applications, acceptedApps, firstProfit] = await Promise.all([
    Application.countDocuments({ userId: { $in: objectIds } }),
    Application.countDocuments({ userId: { $in: objectIds }, status: "accepted" }),
    countUsersWithFirstProfit(userIds),
  ]);

  const campaign = await getCampaignById(id);
  return buildFunnelMetrics({
    starts,
    applications,
    accepted: acceptedApps,
    firstProfit,
    clicks: Number(campaign?.clickCount || 0),
  });
}

async function computeUnlabeledFunnel(period = "all") {
  const dateMatch = cohortDateMatch(period);
  const userQuery = {
    $or: [{ campaignId: { $exists: false } }, { campaignId: "" }, { campaignId: null }],
  };
  if (dateMatch) userQuery.createdAt = dateMatch;

  const cohortUsers = await User.find(userQuery).select("_id").lean();
  const userIds = cohortUsers.map((row) => String(row._id));
  const starts = userIds.length;
  if (!starts) return buildFunnelMetrics();

  const objectIds = userIds.map((uid) => mongooseObjectId(uid));
  const [applications, acceptedApps, firstProfit] = await Promise.all([
    Application.countDocuments({ userId: { $in: objectIds } }),
    Application.countDocuments({ userId: { $in: objectIds }, status: "accepted" }),
    countUsersWithFirstProfit(userIds),
  ]);

  return buildFunnelMetrics({
    starts,
    applications,
    accepted: acceptedApps,
    firstProfit,
  });
}

async function getAdsDashboard(period = "all") {
  const campaigns = await listCampaigns();
  const rows = await Promise.all(
    campaigns.map(async (campaign) => {
      const funnel = await computeCampaignFunnel(String(campaign._id), period);
      return {
        id: String(campaign._id),
        name: campaign.name,
        slug: campaign.slug,
        source: campaign.source || "",
        status: campaign.status,
        createdAt: campaign.createdAt,
        telegramUrl: buildTelegramDeepLink(campaign.slug),
        trackingUrl: buildTrackingRedirectUrl(campaign.slug),
        funnel,
      };
    })
  );

  const unlabeled = await computeUnlabeledFunnel(period);
  const totals = rows.reduce(
    (acc, row) => ({
      starts: acc.starts + row.funnel.starts,
      applications: acc.applications + row.funnel.applications,
      accepted: acc.accepted + row.funnel.accepted,
      firstProfit: acc.firstProfit + row.funnel.firstProfit,
      clicks: acc.clicks + row.funnel.clicks,
    }),
    { starts: 0, applications: 0, accepted: 0, firstProfit: 0, clicks: 0 }
  );

  return {
    period,
    campaigns: rows,
    unlabeled,
    totals: buildFunnelMetrics(totals),
  };
}

async function listCampaignCohortMembers(campaignId, period = "all", limit = 50) {
  const dateMatch = cohortDateMatch(period);
  const userQuery = { campaignId: String(campaignId || "") };
  if (dateMatch) userQuery.campaignAttributedAt = dateMatch;

  const users = await User.find(userQuery)
    .sort({ campaignAttributedAt: -1 })
    .limit(Math.min(100, Math.max(1, Number(limit) || 50)))
    .lean();

  const userIds = users.map((row) => row._id);
  const [apps, profitUserIds] = await Promise.all([
    Application.find({ userId: { $in: userIds } })
      .select("userId status createdAt")
      .lean(),
    ProfitTransaction.distinct("userId", profitStatsFilter({ userId: { $in: userIds } })),
  ]);

  const appsByUser = new Map();
  for (const app of apps) {
    const key = String(app.userId);
    const prev = appsByUser.get(key);
    if (!prev || new Date(app.createdAt) > new Date(prev.createdAt)) {
      appsByUser.set(key, app);
    }
  }
  const profitSet = new Set(profitUserIds.map((id) => String(id)));

  return users.map((user) => {
    const app = appsByUser.get(String(user._id));
    return {
      telegramId: String(user.telegramId),
      username: user.username || "",
      firstName: user.firstName || "",
      attributedAt: user.campaignAttributedAt || null,
      isTeamMember: Boolean(user.isTeamMember),
      applicationStatus: app?.status || "",
      hasFirstProfit: profitSet.has(String(user._id)),
    };
  });
}

async function resolveCampaignLabel(campaignId, campaignSlug) {
  const id = String(campaignId || "").trim();
  const slug = String(campaignSlug || "").trim();
  if (id) {
    const campaign = await getCampaignById(id);
    if (campaign) {
      return {
        name: campaign.name,
        slug: campaign.slug,
        telegramUrl: buildTelegramDeepLink(campaign.slug),
      };
    }
  }
  if (slug) {
    const campaign = await getCampaignBySlug(slug);
    if (campaign) {
      return {
        name: campaign.name,
        slug: campaign.slug,
        telegramUrl: buildTelegramDeepLink(campaign.slug),
      };
    }
    return { name: slug, slug, telegramUrl: buildTelegramDeepLink(slug) };
  }
  return null;
}

module.exports = {
  START_PREFIX,
  SLUG_PATTERN,
  normalizeSlug,
  validateCampaignName,
  validateSlugInput,
  validateSlug,
  generateSlug,
  allocateUniqueSlug,
  parseCampaignStartPayload,
  isServiceStartPayload,
  buildTelegramDeepLink,
  buildTrackingRedirectUrl,
  ratePercent,
  buildFunnelMetrics,
  getCampaignBySlug,
  getCampaignById,
  listCampaigns,
  createCampaign,
  deleteCampaign,
  setCampaignStatus,
  incrementCampaignClick,
  attributeUserFromStartPayload,
  applicationCampaignSnapshot,
  computeCampaignFunnel,
  computeUnlabeledFunnel,
  getAdsDashboard,
  listCampaignCohortMembers,
  resolveCampaignLabel,
};
