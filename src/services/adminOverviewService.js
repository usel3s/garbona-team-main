const SteamLog = require("../models/SteamLog");

function localDayKey(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Стоимость на момент поступления — только баланс + инвентарь, без totalProfit. */
function arrivalValueUsd(doc) {
  return Number((Number(doc.balanceUsd || 0) + Number(doc.inventoryUsd || 0)).toFixed(2));
}

function buildDayRange(dayCount, byKey) {
  const out = [];
  for (let i = dayCount - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = localDayKey(d);
    const hit = byKey.get(key) || { logsCount: 0, mafileCount: 0, totalUsd: 0 };
    out.push({
      date: d.toISOString().slice(0, 10),
      label: formatDayLabel(d),
      logsCount: hit.logsCount,
      mafileCount: hit.mafileCount,
      count: hit.logsCount + hit.mafileCount,
      totalUsd: Number(hit.totalUsd.toFixed(2)),
    });
  }
  return out;
}

function formatDayLabel(d) {
  const months = [
    "янв.", "фев.", "мар.", "апр.", "мая", "июн.",
    "июл.", "авг.", "сен.", "окт.", "ноя.", "дек.",
  ];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

function summarizeArrivals(stats) {
  const logs = Number(stats.logsCount || 0);
  const mafiles = Number(stats.mafileCount || 0);
  const parts = [];
  if (logs) parts.push(`${logs} ${logs === 1 ? "лог" : logs < 5 ? "лога" : "логов"}`);
  if (mafiles) parts.push(`${mafiles} MaFile`);
  return parts.length ? parts.join(" · ") : "0 поступлений";
}

function pctChange(current, previous) {
  const cur = Number(current) || 0;
  const prev = Number(previous) || 0;
  if (prev > 0) return Math.round(((cur - prev) / prev) * 100);
  if (cur > 0) return 100;
  return null;
}

function foldUniqueRows(rows) {
  const unique = new Map();
  for (const row of rows) {
    const sourceId = String(row.sourceId || "").trim();
    if (!sourceId) continue;
    const createdAt = new Date(row.createdAt || 0);
    const prev = unique.get(sourceId);
    if (!prev || createdAt < new Date(prev.createdAt || 0)) {
      unique.set(sourceId, row);
    }
  }
  return [...unique.values()];
}

function tallyRows(rows) {
  const uniqueRows = foldUniqueRows(rows);
  let logsCount = 0;
  let mafileCount = 0;
  let totalUsd = 0;
  let inventoryUsd = 0;
  let balanceUsd = 0;
  for (const row of uniqueRows) {
    if (row.logKind === "mafile") mafileCount += 1;
    else logsCount += 1;
    totalUsd += arrivalValueUsd(row);
    inventoryUsd += Number(row.inventoryUsd || 0);
    balanceUsd += Number(row.balanceUsd || 0);
  }
  return {
    logsCount,
    mafileCount,
    count: logsCount + mafileCount,
    totalUsd: Number(totalUsd.toFixed(2)),
    inventoryUsd: Number(inventoryUsd.toFixed(2)),
    balanceUsd: Number(balanceUsd.toFixed(2)),
    rawRows: rows.length,
    uniqueRows: uniqueRows.length,
  };
}

async function fetchArrivalRows(match) {
  return SteamLog.find({
    logKind: { $in: ["valid", "mafile"] },
    ...match,
  })
    .select("sourceId logKind balanceUsd inventoryUsd createdAt")
    .sort({ createdAt: 1 })
    .lean();
}

function startOfTodayMoscow(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return new Date(`${map.year}-${map.month}-${map.day}T00:00:00+03:00`);
}

function moscowDayRange(offsetDays = 0) {
  const start = startOfTodayMoscow();
  start.setDate(start.getDate() + offsetDays);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function moscowDayKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatMoscowDayLabel(offsetDays = 0) {
  const { start } = moscowDayRange(offsetDays);
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "numeric",
    month: "long",
  }).format(start);
}

async function getTeamArrivalForMoscowDay(offsetDays = 0) {
  const { start, end } = moscowDayRange(offsetDays);
  return aggregateArrivals({ createdAt: { $gte: start, $lt: end } });
}

async function aggregateArrivals(match) {
  const rows = await fetchArrivalRows(match);
  return tallyRows(rows);
}

async function getTeamArrivalSeries(days = 7) {
  const dayCount = Math.min(30, Math.max(1, Number(days) || 7));
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - (dayCount - 1));

  const rows = foldUniqueRows(await fetchArrivalRows({ createdAt: { $gte: since } }));
  const byKey = new Map();
  for (const row of rows) {
    const key = localDayKey(row.createdAt);
    if (!key) continue;
    const hit = byKey.get(key) || { logsCount: 0, mafileCount: 0, totalUsd: 0 };
    if (row.logKind === "mafile") hit.mafileCount += 1;
    else hit.logsCount += 1;
    hit.totalUsd += arrivalValueUsd(row);
    byKey.set(key, hit);
  }

  return buildDayRange(dayCount, byKey);
}

async function getTeamArrivalKpi() {
  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const yesterdayStart = new Date();
  yesterdayStart.setHours(0, 0, 0, 0);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const yesterdayEnd = new Date(yesterdayStart);
  yesterdayEnd.setDate(yesterdayEnd.getDate() + 1);

  const [last24hStats, yesterdayStats] = await Promise.all([
    aggregateArrivals({ createdAt: { $gte: last24h, $lte: now } }),
    aggregateArrivals({ createdAt: { $gte: yesterdayStart, $lt: yesterdayEnd } }),
  ]);

  return {
    last24h: last24hStats,
    yesterday: yesterdayStats,
    countDeltaPct: pctChange(last24hStats.count, yesterdayStats.count),
    valueDeltaPct: pctChange(last24hStats.totalUsd, yesterdayStats.totalUsd),
    last24hSummary: summarizeArrivals(last24hStats),
    yesterdaySummary: summarizeArrivals(yesterdayStats),
  };
}

module.exports = {
  getTeamArrivalSeries,
  getTeamArrivalKpi,
  getTeamArrivalForMoscowDay,
  arrivalValueUsd,
  foldUniqueRows,
  tallyRows,
  summarizeArrivals,
  moscowDayKey,
  formatMoscowDayLabel,
  moscowDayRange,
};
