const ProfitTransaction = require("../models/ProfitTransaction");
const User = require("../models/User");
const {
  getUserProfitStatsByTelegramId,
  getProfitDashboard,
  groupUserProfits,
  daysWithTeam,
  profitStatsFilter,
} = require("./profitService");
const { getWorkerDailyProfitSeries } = require("./workerDashboardService");
const { getUserByTelegramId } = require("./userService");
const { getCurrencyContext, formatDisplayAmount } = require("./currencyService");
const { resolveWorkerPhotoUrl } = require("../utils/profilePhoto");
const { formatFakeProfitTagLabel } = require("../utils/fakeProfitTag");
const { pe } = require("../utils/emoji");

function periodSince(period) {
  const now = Date.now();
  if (period === "24h") return new Date(now - 24 * 60 * 60 * 1000);
  if (period === "7d") return new Date(now - 7 * 24 * 60 * 60 * 1000);
  if (period === "30d") return new Date(now - 30 * 24 * 60 * 60 * 1000);
  return null;
}

function topPeriodTitle(period) {
  const map = {
    all: "за всё время",
    "24h": "за день",
    "7d": "за неделю",
    "30d": "за месяц",
  };
  return map[period] || map.all;
}

function pluralRu(n, one, few, many) {
  const abs = Math.abs(Number(n) || 0);
  const n10 = abs % 10;
  const n100 = abs % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
  return many;
}

function formatProfitsCount(count) {
  const n = Math.max(0, Number(count) || 0);
  return `${n} ${pluralRu(n, "профит", "профита", "профитов")}`;
}

function formatDaysLabel(days) {
  const n = Math.max(0, Number(days) || 0);
  return `${n} ${pluralRu(n, "день", "дня", "дней")}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function displayNameOf(user) {
  const first = String(user?.firstName || "").trim();
  if (first) return first;
  if (user?.username) return user.username;
  return user?.telegramId ? `ID ${user.telegramId}` : "—";
}

function roleLabelOf(user) {
  if (!user) return "Пользователь";
  if (user.role === "admin") return "Администратор";
  if (user.isCurator) return "Куратор";
  if (user.isCaller) return "Прозвонщица";
  if (user.isTeamMember) return "Воркер";
  if (user.isBanned) return "Заблокирован";
  return "Пользователь";
}

function rankIcon(index) {
  if (index === 0) return "🥇";
  if (index === 1) return "🥈";
  if (index === 2) return "🥉";
  return "🔹";
}

function profileDeepLink(botUsername, telegramId, period = "all") {
  const bot = String(botUsername || "").replace(/^@/, "");
  if (!bot) return "";
  const p = ["all", "24h", "7d", "30d"].includes(period) ? period : "all";
  const suffix = p === "all" ? "" : `_${p}`;
  return `https://t.me/${bot}?start=u_${String(telegramId)}${suffix}`;
}

/**
 * Топ воркеров за период (до 10 позиций).
 */
async function getTopWorkers(period = "all", limit = 10) {
  const since = period === "all" ? null : periodSince(period);
  const match = profitStatsFilter(since ? { createdAt: { $gte: since } } : {});

  const agg = await ProfitTransaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$userId",
        total: { $sum: "$workerShare" },
        count: { $sum: 1 },
      },
    },
    { $sort: { total: -1 } },
    { $limit: Math.max(1, Math.min(50, Number(limit) || 10)) },
  ]);

  const userIds = agg.map((a) => a._id);
  const members = await User.find({ _id: { $in: userIds } }).select(
    "username telegramId firstName avatarUrl isAnonymous fakeProfitTag"
  );
  const byId = new Map(members.map((m) => [String(m._id), m]));

  return agg.map((a) => {
    const user = byId.get(String(a._id));
    return {
      telegramId: user?.telegramId ? String(user.telegramId) : "",
      username: user?.username || "",
      firstName: user?.firstName || "",
      photoUrl: user && !user.isAnonymous ? resolveWorkerPhotoUrl(user) : "",
      isAnonymous: Boolean(user?.isAnonymous),
      fakeProfitTag: String(user?.fakeProfitTag || ""),
      total: Number(a.total || 0),
      count: Number(a.count || 0),
    };
  });
}

function formatTopNameHtml(row, botUsername, period = "all") {
  const anonTag = row.isAnonymous ? formatFakeProfitTagLabel(row.fakeProfitTag) : "";
  const label = row.isAnonymous ? anonTag || "Аноним" : displayNameOf(row);
  const safe = escapeHtml(label);
  const href = row.telegramId ? profileDeepLink(botUsername, row.telegramId, period) : "";
  if (!href) return `<b>${safe}</b>`;
  return `<a href="${href}"><b>${safe}</b></a>`;
}

function buildTopWorkersHtml(rows, period, currencyCtx, botUsername) {
  const topic = topPeriodTitle(period);
  const lines = [`${pe("analytics")} <b>Топ воркеров ${topic}:</b>`, ""];

  if (!rows.length) {
    lines.push("Пока нет данных по выбранному периоду.");
    return lines.join("\n");
  }

  const totalAmount = rows.reduce((sum, r) => sum + r.total, 0);

  rows.forEach((row, i) => {
    lines.push(
      `${rankIcon(i)} ${formatTopNameHtml(row, botUsername, period)} - <b>${formatDisplayAmount(row.total, currencyCtx)}</b> - ${formatProfitsCount(row.count)}`
    );
  });

  lines.push("");
  lines.push(
    `${pe("transfer")} Общий профит - <b>${formatDisplayAmount(totalAmount, currencyCtx)}</b>`
  );

  return lines.join("\n");
}

async function buildPublicProfileCaption(user, period, currencyCtx) {
  if (!user) {
    return `${pe("error")} Пользователь не найден.`;
  }

  if (user.isAnonymous) {
    return [
      `${pe("profile")} <b>Профиль пользователя:</b> Аноним`,
      "┖ Статус: Скрыто",
      "",
      `${pe("statistics")} <b>Статистика за всё время:</b>`,
      "┖ Профиты скрыты.",
      "",
      "О себе: Скрыто",
      "",
      "<i>С нами: Скрыто</i>",
    ].join("\n");
  }

  const stats = await getUserProfitStatsByTelegramId(user.telegramId, period);
  const periodProfit = stats ? stats.periodProfit : 0;
  const operationsCount = stats ? stats.operationsCount : 0;
  const avgProfit = operationsCount > 0 ? periodProfit / operationsCount : 0;
  const name = escapeHtml(displayNameOf(user));
  const topic = topPeriodTitle(period);

  const lines = [
    `${pe("profile")} <b>Профиль пользователя:</b> ${name}`,
    `┖ Статус: ${roleLabelOf(user)}`,
    "",
    `${pe("statistics")} <b>Статистика ${topic}:</b>`,
  ];

  if (operationsCount > 0) {
    lines.push(`┠ Сумма профитов: ${formatDisplayAmount(periodProfit, currencyCtx)}`);
    lines.push(`┠ Кол-во профитов: ${formatProfitsCount(operationsCount)}`);
    lines.push(`┖ Средний профит: ${formatDisplayAmount(avgProfit, currencyCtx)}`);
  } else {
    lines.push("┖ Профиты отсутствуют.");
  }

  lines.push("");
  lines.push(`О себе: ${escapeHtml(user.bio || "Не заполнено")}`);
  lines.push("");
  lines.push(`<i>С нами: ${formatDaysLabel(daysWithTeam(user))}</i>`);

  return lines.join("\n");
}

function formatChartDayLabel(isoDate) {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(isoDate || "");
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}`;
}

async function getProfileChartSeries(user, chartPeriod, currencyCtx) {
  if (chartPeriod === "7d" || chartPeriod === "30d") {
    const days = chartPeriod === "7d" ? 7 : 30;
    const rows = await getWorkerDailyProfitSeries(user, days);
    return rows.map((row) => ({
      date: row.date,
      label: formatChartDayLabel(row.date),
      profitUsd: Number(row.totalUsd || 0),
      profitDisplay: formatDisplayAmount(row.totalUsd, currencyCtx),
    }));
  }

  const rows = await groupUserProfits(user, "month");
  return [...rows]
    .reverse()
    .slice(-18)
    .map((row) => {
      const month = String(row.month).padStart(2, "0");
      return {
        date: `${row.year}-${month}-01`,
        label: `${month}.${String(row.year).slice(-2)}`,
        profitUsd: Number(row.total || 0),
        profitDisplay: formatDisplayAmount(row.total, currencyCtx),
      };
    });
}

async function getTopWorkerProfile(telegramId, chartPeriod = "7d") {
  const tid = String(telegramId || "").trim();
  const user = tid ? await getUserByTelegramId(tid) : null;
  if (!user) {
    const error = new Error("Пользователь не найден");
    error.status = 404;
    throw error;
  }
  if (user.isAnonymous) {
    const error = new Error("Профиль скрыт");
    error.status = 403;
    throw error;
  }

  const period = ["7d", "30d", "all"].includes(chartPeriod) ? chartPeriod : "7d";
  const currencyCtx = await getCurrencyContext();
  const [dash, series] = await Promise.all([
    getProfitDashboard(user),
    getProfileChartSeries(user, period, currencyCtx),
  ]);

  return {
    telegramId: String(user.telegramId),
    username: user.username || "",
    firstName: user.firstName || "",
    displayName: displayNameOf(user),
    bio: String(user.bio || "").trim(),
    photoUrl: resolveWorkerPhotoUrl(user),
    role: roleLabelOf(user),
    daysInTeam: dash.days,
    totalProfitUsd: Number(dash.totalShare || 0),
    maxProfitUsd: Number(dash.maxShare || 0),
    operationsTotal: Number(dash.count || 0),
    chartPeriod: period,
    series,
  };
}

async function getPublicProfileImageData(user) {
  if (!user || user.isAnonymous) return null;
  const dash = await getProfitDashboard(user);
  return {
    days: dash.days,
    nickname: displayNameOf(user),
    count: dash.count,
    totalShare: dash.totalShare,
    maxShare: dash.maxShare,
  };
}

module.exports = {
  getTopWorkers,
  getTopWorkerProfile,
  buildTopWorkersHtml,
  buildPublicProfileCaption,
  getPublicProfileImageData,
  profileDeepLink,
  displayNameOf,
  formatDaysLabel,
  formatProfitsCount,
};
