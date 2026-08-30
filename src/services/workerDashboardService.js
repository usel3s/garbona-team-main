const ProfitTransaction = require("../models/ProfitTransaction");
const SteamLog = require("../models/SteamLog");
const { getCurrencyContext, formatDisplayAmount } = require("./currencyService");
const {
  getProfitDashboard,
  profitStatsFilter,
} = require("./profitService");
const { listWorkerLogs } = require("./workerPanelService");
const {
  classifyWorkerAccountStatus,
  serializeWorkerMafileSession,
  preferWorkerStatus,
} = require("./steamControlService");
const {
  autoSaleActivityStatus,
  effectiveActivitySaleStatus,
  preferActivityDisplayStatus,
} = require("./steamLogStatusService");
const { preferSourcePage } = require("../utils/steamSourcePage");

function startOfTodayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function pctChange(current, previous) {
  const cur = Number(current) || 0;
  const prev = Number(previous) || 0;
  if (prev > 0) return Math.round(((cur - prev) / prev) * 100);
  if (cur > 0) return 100;
  return 0;
}

function localDayKey(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function buildDayRange(dayCount, byKey, mapHit) {
  const out = [];
  for (let i = dayCount - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = localDayKey(d);
    const hit = byKey.get(key);
    out.push({
      date: d.toISOString().slice(0, 10),
      ...(mapHit ? mapHit(hit) : hit || {}),
    });
  }
  return out;
}

function logValueUsd(doc) {
  const profit = Number(doc.totalProfit || 0);
  if (profit > 0) return profit;
  return Number((Number(doc.balanceUsd || 0) + Number(doc.inventoryUsd || 0)).toFixed(2));
}

async function countSteamLogsInRange(ownerId, start, end = null, kinds = ["valid"]) {
  const id = String(ownerId || "");
  if (!id) return 0;
  const match = {
    ownerTelegramId: id,
    logKind: { $in: kinds },
    createdAt: { $gte: start },
  };
  if (end) match.createdAt.$lt = end;
  return SteamLog.countDocuments(match);
}

async function countMafileInRange(ownerId, start, end = null) {
  return countSteamLogsInRange(ownerId, start, end, ["mafile"]);
}

function isToday(value) {
  if (!value) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  const start = startOfTodayUtc();
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return d >= start && d < end;
}

async function sumWorkerShareSince(userId, since, until = null) {
  const match = profitStatsFilter({ userId, createdAt: { $gte: since } });
  if (until) match.createdAt.$lt = until;
  const [row] = await ProfitTransaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        total: { $sum: "$workerShare" },
        count: { $sum: 1 },
      },
    },
  ]);
  return {
    total: Number(row?.total || 0),
    count: Number(row?.count || 0),
  };
}

async function getWorkerDailySteamSeries(telegramId, days = 7) {
  const ownerId = String(telegramId || "");
  const dayCount = Math.min(30, Math.max(1, Number(days) || 7));
  const since = new Date(Date.now() - dayCount * 24 * 60 * 60 * 1000);
  if (!ownerId) {
    return buildDayRange(dayCount, new Map(), () => ({
      logsCount: 0,
      logsUsd: 0,
      mafileCount: 0,
    }));
  }

  const rows = await SteamLog.find({
    ownerTelegramId: ownerId,
    logKind: { $in: ["valid", "mafile"] },
    createdAt: { $gte: since },
  })
    .select("logKind balanceUsd inventoryUsd totalProfit createdAt")
    .lean();

  const byKey = new Map();
  for (const row of rows) {
    const key = localDayKey(row.createdAt);
    if (!key) continue;
    const hit = byKey.get(key) || { logsCount: 0, logsUsd: 0, mafileCount: 0 };
    if (row.logKind === "mafile") {
      hit.mafileCount += 1;
    } else {
      hit.logsCount += 1;
      hit.logsUsd += logValueUsd(row);
    }
    byKey.set(key, hit);
  }

  return buildDayRange(dayCount, byKey, (hit) => ({
    logsCount: hit?.logsCount || 0,
    logsUsd: Number((hit?.logsUsd || 0).toFixed(2)),
    mafileCount: hit?.mafileCount || 0,
  }));
}

function mergeDailySeries(profitSeries, steamSeries) {
  const steamByDate = new Map((steamSeries || []).map((row) => [row.date, row]));
  return (profitSeries || []).map((row) => {
    const steam = steamByDate.get(row.date) || { logsCount: 0, logsUsd: 0, mafileCount: 0 };
    const profitUsd = Number(row.totalUsd || 0);
    const profitCount = Number(row.count || 0);
    const logsCount = Number(steam.logsCount || 0);
    const logsUsd = Number(steam.logsUsd || 0);
    const mafileCount = Number(steam.mafileCount || 0);
    return {
      date: row.date,
      profitUsd,
      profitCount,
      logsCount,
      logsUsd,
      mafileCount,
      totalUsd: profitUsd + logsUsd,
      count: profitCount + logsCount + mafileCount,
    };
  });
}

async function getWorkerDailyProfitSeries(user, days = 7) {
  const dayCount = Math.min(30, Math.max(1, Number(days) || 7));
  const since = new Date(Date.now() - dayCount * 24 * 60 * 60 * 1000);
  const rows = await ProfitTransaction.aggregate([
    { $match: profitStatsFilter({ userId: user._id, createdAt: { $gte: since } }) },
    {
      $group: {
        _id: {
          y: { $year: "$createdAt" },
          m: { $month: "$createdAt" },
          d: { $dayOfMonth: "$createdAt" },
        },
        total: { $sum: "$workerShare" },
        count: { $sum: 1 },
      },
    },
    { $sort: { "_id.y": 1, "_id.m": 1, "_id.d": 1 } },
  ]);

  const byKey = new Map();
  for (const row of rows) {
    const key = `${row._id.y}-${row._id.m}-${row._id.d}`;
    byKey.set(key, {
      total: Number(row.total || 0),
      count: Number(row.count || 0),
    });
  }

  return buildDayRange(dayCount, byKey, (hit) => ({
    totalUsd: hit?.total || 0,
    count: hit?.count || 0,
  }));
}

async function getSteamLogMafileStats(telegramId) {
  const ownerId = String(telegramId || "");
  if (!ownerId) return { mafileTotal: 0, todayMafile: 0 };

  const todayStart = startOfTodayUtc();
  const [mafileTotal, todayMafile] = await Promise.all([
    SteamLog.countDocuments({ ownerTelegramId: ownerId, logKind: "mafile" }),
    SteamLog.countDocuments({
      ownerTelegramId: ownerId,
      logKind: "mafile",
      createdAt: { $gte: todayStart },
    }),
  ]);
  return { mafileTotal, todayMafile };
}

function steamLogKindToStatus(kind) {
  if (kind === "mafile") return "MaFile";
  if (kind === "valid") return "Валид";
  if (kind === "invalid") return "Невалид";
  return "—";
}

function serializeSteamLogDoc(doc) {
  const balance = Number(doc.balanceUsd || 0);
  const inventory = Number(doc.inventoryUsd || 0);
  const profit = Number(doc.totalProfit || 0);
  const priceUsd = profit > 0 ? profit : Number((balance + inventory).toFixed(2));
  const row = {
    status:
      autoSaleActivityStatus(doc.autoSaleStatus) ||
      doc.accountStatus ||
      steamLogKindToStatus(String(doc.logKind || "")),
    isMaFile: String(doc.logKind || "") === "mafile",
    mafileTime: doc.mafileSnapshot?.mafileTime || doc.mafileTime || "",
    mafileSnapshot: doc.mafileSnapshot,
    invalidDate:
      doc.mafileStatus === "invalid" || /^(invalid|невалид)$/i.test(String(doc.accountStatus || ""))
        ? doc.mafileStatusUpdatedAt || true
        : null,
  };
  const session = serializeWorkerMafileSession(row);
  const sourceId = String(doc.sourceId || "");
  return {
    id: sourceId || String(doc._id),
    sourceId,
    createdAt: doc.createdAt,
    username: doc.accountUsername || "",
    sourcePage: String(doc.sourcePage || "").trim(),
    level: null,
    country: "",
    priceUsd,
    status: classifyWorkerAccountStatus(row),
    steamId: doc.steamId || "",
    gamesCount: 0,
    saleStatus: effectiveActivitySaleStatus(doc),
    processStatus: String(doc.processStatus || "none"),
    accountTag: String(doc.accountTag || ""),
    eventType: String(doc.logKind || "") === "mafile" ? "mafile" : session.eventType,
    mafileTime: session.mafileTime,
    mafileSessionHoursLeft: session.mafileSessionHoursLeft,
    mafileSessionUnlocked: session.mafileSessionUnlocked,
    sessionInvalid: session.sessionInvalid || String(doc.mafileStatus || "") === "invalid",
    sessionCheckedAt: session.sessionCheckedAt,
  };
}

function lookupSourceId(value) {
  const id = String(value || "").trim().replace(/^#/, "");
  return /^\d{4,}$/.test(id) ? id : "";
}

async function getRecentSteamLogsFromDb(telegramId, { limit = 5000, sourceId = "" } = {}) {
  const ownerId = String(telegramId || "");
  if (!ownerId) return [];
  const safeLimit = Math.min(8000, Math.max(1, Number(limit) || 5000));
  const rows = await SteamLog.find({ ownerTelegramId: ownerId })
    .sort({ createdAt: -1 })
    .limit(safeLimit)
    .lean();
  const wanted = lookupSourceId(sourceId);
  if (wanted && !rows.some((row) => String(row.sourceId) === wanted)) {
    const extra = await SteamLog.findOne({
      sourceId: wanted,
      ownerTelegramId: ownerId,
    }).lean();
    if (extra) rows.unshift(extra);
  }
  return rows.map(serializeSteamLogDoc);
}

async function getSteamLogStats(telegramId) {
  const ownerId = String(telegramId || "");
  if (!ownerId) return { totalLogs: 0, todayLogs: 0 };

  const todayStart = startOfTodayUtc();
  const [totalLogs, todayLogs] = await Promise.all([
    SteamLog.countDocuments({
      ownerTelegramId: ownerId,
      logKind: { $in: ["valid", "mafile"] },
    }),
    SteamLog.countDocuments({
      ownerTelegramId: ownerId,
      logKind: { $in: ["valid", "mafile"] },
      createdAt: { $gte: todayStart },
    }),
  ]);
  return { totalLogs, todayLogs };
}

function mergeLogRows(apiLogs, dbLogs) {
  const byId = new Map();
  for (const row of [...(dbLogs || []), ...(apiLogs || [])]) {
    const key = String(row.id || "");
    if (!key) continue;
    const prev = byId.get(key);
    if (!prev) {
      byId.set(key, row);
      continue;
    }
    const mergedStatus = preferWorkerStatus(row.status, prev.status);
    const merged = {
      ...prev,
      ...row,
      status: preferActivityDisplayStatus(
        { status: mergedStatus, saleStatus: row.saleStatus },
        prev
      ),
      sourcePage: preferSourcePage(row.sourcePage, prev.sourcePage),
      accountTag: row.accountTag || prev.accountTag || "",
      saleStatus: row.saleStatus || prev.saleStatus,
      processStatus: row.processStatus || prev.processStatus,
      mafileTime: row.mafileTime || prev.mafileTime || "",
      sessionCheckedAt: row.sessionCheckedAt || prev.sessionCheckedAt || "",
      sessionInvalid: Boolean(row.sessionInvalid) || Boolean(prev.sessionInvalid),
      eventType: row.eventType === "mafile" || prev.eventType === "mafile"
        ? "mafile"
        : (row.eventType || prev.eventType),
    };
    byId.set(key, merged);
  }
  return [...byId.values()].sort(
    (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
  );
}

async function getWorkerOverview(user, { days = 7, q = "" } = {}) {
  const currencyCtx = await getCurrencyContext();
  const dayCount = Math.min(30, Math.max(1, Number(days) || 7));
  const todayStart = startOfTodayUtc();
  const periodStart = new Date(Date.now() - dayCount * 24 * 60 * 60 * 1000);
  const prevPeriodStart = new Date(periodStart.getTime() - dayCount * 24 * 60 * 60 * 1000);

  const [
    profitDash,
    periodProfit,
    prevPeriodProfit,
    todayProfit,
    profitSeries,
    steamSeries,
    steamMafileStats,
    logsInPeriod,
    logsInPrevPeriod,
    mafileInPeriod,
    mafileInPrevPeriod,
    logsResult,
    dbLogs,
    dbLogStats,
  ] = await Promise.all([
    getProfitDashboard(user),
    sumWorkerShareSince(user._id, periodStart),
    sumWorkerShareSince(user._id, prevPeriodStart, periodStart),
    sumWorkerShareSince(user._id, todayStart),
    getWorkerDailyProfitSeries(user, dayCount),
    getWorkerDailySteamSeries(user.telegramId, dayCount),
    getSteamLogMafileStats(user.telegramId),
    countSteamLogsInRange(user.telegramId, periodStart, null, ["valid"]),
    countSteamLogsInRange(user.telegramId, prevPeriodStart, periodStart, ["valid"]),
    countMafileInRange(user.telegramId, periodStart),
    countMafileInRange(user.telegramId, prevPeriodStart, periodStart),
    listWorkerLogs(user, { offset: 0, limit: 100, q, skipCache: true }).catch((error) => ({
      panelUsername: user.panelUsername || "",
      summary: { totalLogs: 0, todayLogs: 0, todayVisits: 0 },
      logs: [],
      error: error.message || "logs_error",
    })),
    getRecentSteamLogsFromDb(user.telegramId, { limit: 5000, sourceId: q }),
    getSteamLogStats(user.telegramId),
  ]);

  const series = mergeDailySeries(profitSeries, steamSeries);

  const logs = mergeLogRows(logsResult.logs || [], dbLogs);
  const mafileFromLogs = logs.filter(
    (row) =>
      row.eventType === "mafile" || /mafile/i.test(String(row.status || ""))
  );
  const regularLogs = logs.filter(
    (row) =>
      row.eventType !== "mafile" && !/mafile/i.test(String(row.status || ""))
  );
  const todayLogsFromBatch = logs.filter((row) => isToday(row.createdAt)).length;
  const todayMafileFromBatch = mafileFromLogs.filter((row) => isToday(row.createdAt)).length;

  const mafileTotal = Math.max(steamMafileStats.mafileTotal, mafileFromLogs.length);
  const todayMafile = Math.max(steamMafileStats.todayMafile, todayMafileFromBatch);

  const profitTodayUsd = todayProfit.total;
  const totalNow = Number(profitDash.totalShare || 0);
  const totalBeforePeriod = Math.max(0, totalNow - periodProfit.total);

  const profitTotalDeltaPct =
    totalBeforePeriod > 0
      ? Math.round((periodProfit.total / totalBeforePeriod) * 100)
      : periodProfit.total > 0
        ? 100
        : 0;
  const profitPeriodDeltaPct = pctChange(periodProfit.total, prevPeriodProfit.total);
  const logsDeltaPct = pctChange(logsInPeriod, logsInPrevPeriod);
  const mafileDeltaPct = pctChange(mafileInPeriod, mafileInPrevPeriod);

  const walletUsd = Number(user.totalProfit || 0);

  return {
    currency: {
      rate: currencyCtx.rate,
      globalCurrency: currencyCtx.currency,
    },
    user: {
      profitPercent: Number(user.profitPercent ?? 70),
      daysWithTeam: profitDash.days,
      walletUsd,
      profitTotalUsd: profitDash.totalShare,
      walletDisplay: formatDisplayAmount(walletUsd, currencyCtx),
      operationsTotal: profitDash.count,
      maxShareUsd: profitDash.maxShare,
    },
    kpi: {
      profitTodayUsd,
      profitTodayDisplay: formatDisplayAmount(profitTodayUsd, currencyCtx),
      profitTotalDeltaPct,
      profitPeriodDeltaPct,
      logsDeltaPct,
      mafileDeltaPct,
      profitPeriodUsd: periodProfit.total,
      profitPeriodDisplay: formatDisplayAmount(periodProfit.total, currencyCtx),
      operationsPeriod: periodProfit.count,
      logsPeriod: logsInPeriod,
      totalLogs: Math.max(
        Number(logsResult.summary?.totalLogs ?? 0),
        dbLogStats.totalLogs,
        logs.length
      ),
      todayLogs: Math.max(
        Number(logsResult.summary?.todayLogs ?? 0),
        dbLogStats.todayLogs,
        todayLogsFromBatch
      ),
      mafileTotal,
      todayMafile,
      mafilePeriod: mafileInPeriod,
    },
    days: dayCount,
    series: series.map((row) => ({
      ...row,
      totalDisplay: formatDisplayAmount(row.totalUsd, currencyCtx),
      profitDisplay: formatDisplayAmount(row.profitUsd, currencyCtx),
      logsDisplay: formatDisplayAmount(row.logsUsd, currencyCtx),
    })),
    recentLogs: regularLogs,
    recentMafiles: mafileFromLogs,
    panelUsername: logsResult.panelUsername || user.panelUsername || "",
    logsError: logsResult.error && !dbLogs.length ? logsResult.error : null,
  };
}

module.exports = {
  getWorkerOverview,
  getWorkerDailyProfitSeries,
};
