const { Markup } = require("telegraf");
const { pe, btn, switchInlineBtn } = require("./emoji");
const {
  BRANCH_CREATE_COST_USD,
  BRANCH_MAX_PERCENT,
  escapeHtml,
  ownerMention,
  clampBranchPercent,
  curatorConflictMessage,
} = require("../services/branchService");

function branchesHomeHtml() {
  return [
    `${pe("users")} <b>Филиалы</b>`,
    "",
    "Филиал — своя команда внутри проекта.",
    "Владелец получает процент с профитов участников.",
    "",
    `${pe("info")} Максимум комиссии: <b>${BRANCH_MAX_PERCENT}%</b>`,
  ].join("\n");
}

function branchesHomeKeyboard() {
  return Markup.inlineKeyboard([
    [
      switchInlineBtn("Поиск", "филиалы ", "users"),
      btn("Мой филиал", "br:mine", "profile"),
    ],
    [btn("Лучшие филиалы", "br:top:all", "analytics")],
    [btn("Инфо", "br:info", "info")],
    [btn("Назад", "menu:home", "home")],
  ]);
}

function branchesInfoHtml() {
  return [
    `${pe("info")} <b>Информация о филиале</b>`,
    "",
    "Выберите, для какого раздела хотите посмотреть информацию:",
  ].join("\n");
}

function branchesInfoKeyboard() {
  return Markup.inlineKeyboard([
    [btn("Создателю", "br:info:owner", "profile")],
    [btn("Воркерам", "br:info:worker", "users")],
    [btn("Назад", "menu:branches", "home")],
  ]);
}

function branchesInfoOwnerHtml() {
  return [
    `${pe("profile")} <b>Информация для создателей:</b>`,
    "",
    `${pe("error")} Запрещено обманывать участников своего филиала.`,
    `${pe("coins")} Можно получать настраиваемый процент с профитов участников. Максимум — ${BRANCH_MAX_PERCENT}%.`,
    `${pe("statistics")} Создать филиал можно, если сумма профитов не меньше <b>$${BRANCH_CREATE_COST_USD}</b>.`,
    `${pe("notification")} Владелец лично принимает заявки на вступление.`,
  ].join("\n");
}

function branchesInfoWorkerHtml() {
  return [
    `${pe("users")} <b>Информация для воркеров:</b>`,
    "",
    `${pe("success")} Владелец филиала и другие участники помогают в работе.`,
    `${pe("error")} Запрещено обманывать или давать дезинформацию другим участникам.`,
    `${pe("analytics")} Владелец филиала может получать процент с твоих профитов — до ${BRANCH_MAX_PERCENT}%.`,
  ].join("\n");
}

function infoBackKeyboard() {
  return Markup.inlineKeyboard([[btn("Назад", "br:info", "home")]]);
}

function emptyBranchHtml() {
  return [
    `${pe("users")} <b>Мой филиал</b>`,
    "",
    "Ты пока не состоишь в филиале.",
  ].join("\n");
}

function emptyBranchKeyboard() {
  return Markup.inlineKeyboard([
    [switchInlineBtn("Поиск", "филиалы ", "users"), btn("Создать филиал", "br:create", "success")],
    [btn("Назад", "menu:branches", "home")],
  ]);
}

function curatorBlockedHtml(user) {
  const reason = curatorConflictMessage(user) || "Филиал недоступен.";
  return [
    `${pe("lock")} <b>Филиал</b>`,
    "",
    escapeHtml(reason),
  ].join("\n");
}

function periodButtonLabel(selected, period, text) {
  return selected === period ? `• ${text} •` : text;
}

function branchProfileKeyboard(branch, { isOwner, isMember, period = "all" } = {}) {
  const id = String(branch._id);
  const rows = [
    [
      btn(periodButtonLabel(period, "all", "За всё время"), `br:card:${id}:all`, "calendar"),
      btn(periodButtonLabel(period, "24h", "За 24 часа"), `br:card:${id}:24h`, "time"),
    ],
    [
      btn(periodButtonLabel(period, "7d", "За 7 дней"), `br:card:${id}:7d`, "calendar"),
      btn(periodButtonLabel(period, "30d", "За 30 дней"), `br:card:${id}:30d`, "calendar"),
    ],
  ];

  if (isOwner) {
    rows.push([btn("Настройки", "br:settings", "settings"), btn("Участники", "br:members", "users")]);
  } else if (isMember) {
    rows.push([btn("Участники", "br:members", "users")]);
    rows.push([btn("Покинуть филиал", "br:leave", "error")]);
  } else {
    rows.push([btn("Подать заявку", `br:apply:${id}`, "notification")]);
  }

  rows.push([btn("Назад", "menu:branches", "home")]);
  return Markup.inlineKeyboard(rows);
}

function branchSettingsHtml(branch) {
  return [
    `${pe("settings")} <b>Настройки филиала</b>`,
    "",
    `${pe("tag")} Название: <b>${escapeHtml(branch.name)}</b>`,
    `${pe("edit")} Описание: ${escapeHtml(branch.description || "—")}`,
    `${pe("analytics")} Процент: <b>${clampBranchPercent(branch.percent)}%</b> из ${BRANCH_MAX_PERCENT}%`,
  ].join("\n");
}

function branchSettingsKeyboard(branch) {
  return Markup.inlineKeyboard([
    [btn("Название", "br:set:name", "tag"), btn("Описание", "br:set:desc", "edit")],
    [btn(`Процент: ${clampBranchPercent(branch.percent)}%`, "br:set:pct", "analytics")],
    [btn("Назад", "br:mine", "home")],
  ]);
}

function branchCancelKeyboard(back = "br:mine") {
  return Markup.inlineKeyboard([
    [btn("Отменить", back, "error")],
    [btn("Назад", "menu:branches", "home")],
  ]);
}

function leaveConfirmHtml(branch) {
  return [
    `${pe("error")} <b>Покинуть филиал?</b>`,
    "",
    `Филиал: <b>${escapeHtml(branch.name)}</b>`,
    "После выхода комиссия с твоих профитов больше не будет уходить владельцу.",
  ].join("\n");
}

function leaveConfirmKeyboard() {
  return Markup.inlineKeyboard([
    [btn("Да, покинуть", "br:leave:ok", "error")],
    [btn("Отмена", "br:mine", "home")],
  ]);
}

function createIntroHtml(eligibility) {
  const profits = Number(eligibility?.profits || 0);
  const need = Number(eligibility?.need || BRANCH_CREATE_COST_USD);
  const ok = Boolean(eligibility?.ok);
  return [
    `${pe("success")} <b>Создать филиал</b>`,
    "",
    `${pe("statistics")} Твои профиты: <b>$${profits.toFixed(2)}</b>`,
    ok
      ? `${pe("coins")} Создание бесплатное.`
      : `${pe("error")} Ваша статистика должна быть не менее <b>$${need.toFixed(0)}</b>.`,
    "",
    "Дальше понадобятся название, описание и процент (0–10).",
  ].join("\n");
}

function createIntroKeyboard(canCreate) {
  const rows = [];
  if (canCreate) {
    rows.push([btn("Продолжить", "br:create:start", "success")]);
  }
  rows.push([btn("Назад", "menu:branches", "home")]);
  return Markup.inlineKeyboard(rows);
}

function createConfirmHtml(draft) {
  return [
    `${pe("info")} <b>Подтверждение</b>`,
    "",
    `${pe("tag")} Название: <b>${escapeHtml(draft.name)}</b>`,
    `${pe("edit")} Описание: ${escapeHtml(draft.description || "—")}`,
    `${pe("analytics")} Процент: <b>${clampBranchPercent(draft.percent)}%</b>`,
    "",
    `${pe("coins")} Создание бесплатное.`,
  ].join("\n");
}

function createConfirmKeyboard() {
  return Markup.inlineKeyboard([
    [btn("Создать", "br:create:pay", "success")],
    [btn("Отменить", "menu:branches", "error")],
  ]);
}

function topBranchesHtml(rows, period, formatAmount) {
  const title =
    period === "24h"
      ? "за 24 часа"
      : period === "7d"
        ? "за 7 дней"
        : period === "30d"
          ? "за 30 дней"
          : "за всё время";
  const medals = ["1.", "2.", "3."];
  const lines = [`${pe("users")} <b>Топ филиалов ${title}</b>`, ""];
  if (!rows.length) {
    lines.push("Пока нет данных.");
    return lines.join("\n");
  }
  rows.forEach((row, i) => {
    const rank = i < 3 ? medals[i] : `${i + 1}.`;
    const amount = formatAmount(row.total);
    lines.push(
      `${rank} <b>${escapeHtml(row.branch.name)}</b> — ${amount} — ${row.count} проф.`
    );
  });
  return lines.join("\n");
}

function topBranchesKeyboard(period = "all") {
  return Markup.inlineKeyboard([
    [
      btn(periodButtonLabel(period, "all", "За всё время"), "br:top:all", "calendar"),
      btn(periodButtonLabel(period, "24h", "За 24 часа"), "br:top:24h", "time"),
    ],
    [
      btn(periodButtonLabel(period, "7d", "За 7 дней"), "br:top:7d", "calendar"),
      btn(periodButtonLabel(period, "30d", "За 30 дней"), "br:top:30d", "calendar"),
    ],
    [btn("Назад", "menu:branches", "home")],
  ]);
}

function membersHtml(branch, members, formatAmount) {
  const lines = [
    `${pe("users")} <b>Участники · ${escapeHtml(branch.name)}</b>`,
    `${pe("analytics")} Процент филиала: <b>${clampBranchPercent(branch.percent)}%</b>`,
    "",
  ];
  if (!members.length) {
    lines.push("Пока никого нет.");
    return lines.join("\n");
  }
  members.forEach((row, i) => {
    const isOwner = String(row.user.telegramId) === String(branch.ownerTelegramId);
    const role = isOwner ? "Владелец" : "Участник";
    const nick = row.user.username ? `@${escapeHtml(row.user.username)}` : escapeHtml(row.user.firstName || row.user.telegramId);
    lines.push(
      `${i + 1}. ${nick} · ${role}`,
      ` ┖ ${formatAmount(row.profit)} · ${row.days} дн.`
    );
  });
  return lines.join("\n");
}

function membersBackKeyboard() {
  return Markup.inlineKeyboard([[btn("Назад", "br:mine", "home")]]);
}

function branchProfileHtml(branch, owner, stats, formatAmount, periodLabel) {
  const description = String(branch.description || "").trim() || "Описание пока не указано.";
  return [
    `${pe("users")} <b>${escapeHtml(branch.name)}</b>`,
    `${pe("profile")} Владелец: ${ownerMention(owner)}`,
    `${pe("analytics")} Процент филиала: <b>${clampBranchPercent(branch.percent)}%</b>`,
    "",
    escapeHtml(description),
    "",
    `${pe("statistics")} <b>Статистика ${periodLabel}</b>`,
    `├ Касса: ${formatAmount(stats.total)}`,
    `├ Профитов: ${stats.count}`,
    `└ Участников: ${stats.members}`,
  ].join("\n");
}

module.exports = {
  branchesHomeHtml,
  branchesHomeKeyboard,
  branchesInfoHtml,
  branchesInfoKeyboard,
  branchesInfoOwnerHtml,
  branchesInfoWorkerHtml,
  infoBackKeyboard,
  emptyBranchHtml,
  emptyBranchKeyboard,
  curatorBlockedHtml,
  branchProfileKeyboard,
  branchProfileHtml,
  branchSettingsHtml,
  branchSettingsKeyboard,
  branchCancelKeyboard,
  leaveConfirmHtml,
  leaveConfirmKeyboard,
  createIntroHtml,
  createIntroKeyboard,
  createConfirmHtml,
  createConfirmKeyboard,
  topBranchesHtml,
  topBranchesKeyboard,
  membersHtml,
  membersBackKeyboard,
};
