const { Markup } = require("telegraf");
const { btn } = require("../utils/emoji");

/** Корень: только хабы */
function adminPanelKeyboard() {
  return Markup.inlineKeyboard([
    [
      btn("Участники", "admin:users", "users"),
      btn("Коммуникация", "admin:comms", "broadcast"),
    ],
    [btn("Статистика", "admin:stats", "statistics")],
    [
      btn("Экономика", "admin:economy", "coins"),
      btn("Шаблоны", "admin:templates", "file"),
    ],
    [
      btn("Логи Steam", "admin:logs", "package"),
      btn("Логи бота", "admin:botlogs", "file"),
    ],
    [btn("В меню", "menu:home", "home")],
  ]);
}

function adminTemplatesKeyboard(templates = []) {
  const rows = [[btn("Включить по ID", "admin:templates:enable", "edit")]];
  for (const template of templates.slice(0, 15)) {
    rows.push([
      btn(`Название #${template.id}`, `admin:templates:rename:${template.id}`, "edit"),
      btn(`Выкл #${template.id}`, `admin:templates:disable:${template.id}`, "delete"),
    ]);
  }
  rows.push([btn("Назад", "admin:panel", "home")]);
  return Markup.inlineKeyboard(rows);
}

function adminLogsKeyboard() {
  return Markup.inlineKeyboard([
    [btn("Поиск по ID", "admin:logs:search", "file")],
    [
      {
        text: "Просмотр логов",
        switch_inline_query_current_chat: "logs ",
        icon_custom_emoji_id: "5884479287171485878",
      },
    ],
    [btn("Назад", "admin:panel", "home")],
  ]);
}

function adminBotLogsKeyboard() {
  return Markup.inlineKeyboard([
    [btn("Выгрузить последние 250 строк", "admin:botlogs:export", "download")],
    [btn("Назад", "admin:panel", "home")],
  ]);
}

function adminUsersKeyboard() {
  return Markup.inlineKeyboard([
    [btn("Поиск участника", "admin:search", "users")],
    [btn("Воркеры сайтов", "admin:uproject_workers", "users")],
    [
      btn("Кураторы", "admin:curators_list", "userVerified"),
      btn("Прозвонщицы", "admin:callers_list", "broadcast"),
    ],
    [btn("Филиалы", "admin:branches_list", "users")],
    [btn("Назад", "admin:panel", "home")],
  ]);
}

function adminCommsKeyboard() {
  return Markup.inlineKeyboard([
    [
      btn("Рассылка", "admin:broadcast", "broadcast"),
      btn("Postbot", "admin:postbot", "bot"),
    ],
    [btn("Динамический закреп", "admin:dynamic_pin", "notification")],
    [btn("Назад", "admin:panel", "home")],
  ]);
}

function adminEconomyKeyboard(globalPercent = 70, currency = "USD") {
  const currencyLabel = currency === "RUB" ? "₽ RUB" : "$ USD";
  return Markup.inlineKeyboard([
    [btn(`Глобальный %: ${globalPercent}%`, "admin:global_percent", "analytics")],
    [btn(`Валюта: ${currencyLabel}`, "admin:currency", "coins")],
    [btn("Курс USD→RUB", "admin:currency:rate", "analytics")],
    [
      btn("Фейк-профит", "admin:fake_profit:start", "coins"),
      btn("Фейк-лог", "admin:fake_log:start", "package"),
    ],
    [btn("Назад", "admin:panel", "home")],
  ]);
}

function adminCurrencyKeyboard(currency = "USD") {
  const isUsd = currency !== "RUB";
  return Markup.inlineKeyboard([
    [
      btn(isUsd ? "• USD •" : "USD", "admin:currency:set:USD", "coins"),
      btn(!isUsd ? "• RUB •" : "RUB", "admin:currency:set:RUB", "coins"),
    ],
    [btn("Назад", "admin:economy", "home")],
  ]);
}

function adminStatsKeyboard(selectedPeriod = "all") {
  const label = (period, text) => (selectedPeriod === period ? `• ${text} •` : text);

  return Markup.inlineKeyboard([
    [
      btn(label("24h", "День"), "admin:stats:period:24h", "time"),
      btn(label("7d", "Неделя"), "admin:stats:period:7d", "calendar"),
    ],
    [
      btn(label("30d", "Месяц"), "admin:stats:period:30d", "calendar"),
      btn(label("all", "Всё время"), "admin:stats:period:all", "statistics"),
    ],
    [btn("Реклама", `admin:ads:period:${selectedPeriod}`, "analytics")],
    [btn("Управление заявками", "admin:apps", "notification")],
    [btn("Топ воркеров", `admin:stats:top:${selectedPeriod}`, "analytics")],
    [btn("Назад", "admin:panel", "home")],
  ]);
}

function adminAdsKeyboard(selectedPeriod = "all", campaigns = []) {
  const label = (period, text) => (selectedPeriod === period ? `• ${text} •` : text);
  const rows = [
    [
      btn(label("24h", "День"), `admin:ads:period:24h`, "time"),
      btn(label("7d", "Неделя"), `admin:ads:period:7d`, "calendar"),
    ],
    [
      btn(label("30d", "Месяц"), `admin:ads:period:30d`, "calendar"),
      btn(label("all", "Всё время"), `admin:ads:period:all`, "statistics"),
    ],
    [btn("Новая реклама", "admin:ads:create", "success")],
  ];

  for (const campaign of campaigns.slice(0, 12)) {
    const rate = campaign.funnel?.startToApplication;
    const suffix =
      rate == null ? "" : ` · ${rate < 10 && rate > 0 ? rate.toFixed(1) : Math.round(rate)}%`;
    rows.push([
      btn(
        `${campaign.name}${suffix}`,
        `admin:ads:view:${campaign.id}:${selectedPeriod}`,
        "tag"
      ),
    ]);
  }

  rows.push([btn("Назад", `admin:stats:period:${selectedPeriod}`, "home")]);
  return Markup.inlineKeyboard(rows);
}

function adminAdCampaignKeyboard(campaignId, period = "all", status = "active") {
  const rows = [];
  if (status === "paused") {
    rows.push([btn("Возобновить", `admin:ads:resume:${campaignId}:${period}`, "success")]);
  } else {
    rows.push([btn("Пауза", `admin:ads:pause:${campaignId}:${period}`, "error")]);
  }
  rows.push([btn("Удалить", `admin:ads:delete:ask:${campaignId}:${period}`, "delete")]);
  rows.push([btn("Назад", `admin:ads:period:${period}`, "home")]);
  return Markup.inlineKeyboard(rows);
}

function adminAdDeleteConfirmKeyboard(campaignId, period = "all") {
  return Markup.inlineKeyboard([
    [
      btn("Да, удалить", `admin:ads:delete:confirm:${campaignId}:${period}`, "delete"),
      btn("Отмена", `admin:ads:view:${campaignId}:${period}`, "home"),
    ],
  ]);
}

/** Ожидание ввода: backTo — куда вернуться при отмене */
function adminCancelKeyboard(backTo = "admin:panel") {
  return Markup.inlineKeyboard([
    [btn("Отменить", backTo, "error")],
    [btn("В главное меню", "menu:home", "home")],
  ]);
}

function adminBackKeyboard(backTo = "admin:panel") {
  return Markup.inlineKeyboard([
    [btn("Назад", backTo, "home")],
    [btn("В главное меню", "menu:home", "home")],
  ]);
}

function adminResultKeyboard(backTo = "admin:users") {
  return Markup.inlineKeyboard([
    [btn("Назад", backTo, "home")],
    [btn("В админ-панель", "admin:panel", "code")],
  ]);
}

function memberActionKeyboard(
  memberTelegramId,
  isBanned = false,
  isCurator = false,
  isCaller = false,
  isModerator = false,
  member = null
) {
  const rows = [
    [
      btn("Начислить профит", `admin:profit:${memberTelegramId}`, "coins"),
      btn("Пополнить кошелёк", `admin:wallet:${memberTelegramId}`, "wallet"),
    ],
    [btn("Процент воркера", `admin:percent:${memberTelegramId}`, "settings")],
    [btn("Отправить сообщение", `admin:msg:${memberTelegramId}`, "broadcast")],
    [btn("Аккаунт сайтов", `admin:panelacc:${memberTelegramId}`, "lock")],
    [
      btn(
        isCurator ? "Снять куратора" : "Назначить куратором",
        `admin:curator:${memberTelegramId}`,
        isCurator ? "userBlocked" : "userVerified"
      ),
      btn(
        isCaller ? "Снять прозвонщицу" : "Назначить прозвонщицей",
        `admin:caller:${memberTelegramId}`,
        isCaller ? "userBlocked" : "broadcast"
      ),
    ],
    [
      btn(
        isModerator ? "Снять модератора" : "Добавить модератора",
        `admin:moderator:${memberTelegramId}`,
        isModerator ? "userBlocked" : "lock"
      ),
    ],
  ];
  if (isCurator) {
    rows.push([btn("Настройки куратора", `admin:curator_cfg:${memberTelegramId}`, "edit")]);
  }
  if (isCaller) {
    rows.push([btn("Настройки прозвонщицы", `admin:caller_cfg:${memberTelegramId}`, "edit")]);
  }
  const canCreate = Boolean(member?.canCreateBranch);
  const hasBranch = Boolean(member?.branchId);
  if (hasBranch) {
    rows.push([btn("Закрыть филиал", `admin:branch_close:${memberTelegramId}`, "delete")]);
  } else if (canCreate) {
    rows.push([btn("Забрать филиал без $100", `admin:branch_revoke:${memberTelegramId}`, "userBlocked")]);
  } else {
    rows.push([btn("Филиал без $100", `admin:branch_grant:${memberTelegramId}`, "userVerified")]);
  }
  rows.push(
    [
      btn("Списать профиты", `admin:profit_deduct:${memberTelegramId}`, "delete"),
      btn("Обнулить статистику", `admin:profit_reset:${memberTelegramId}`, "delete"),
    ],
    [
      btn("Кикнуть", `admin:kick:${memberTelegramId}`, "delete"),
      btn(
        isBanned ? "Разблокировать" : "Забанить",
        isBanned ? `admin:unban:${memberTelegramId}` : `admin:ban:${memberTelegramId}`,
        isBanned ? "unlock" : "userBlocked"
      ),
    ],
    [btn("Назад", "admin:users", "home")]
  );
  return Markup.inlineKeyboard(rows);
}

function memberPanelAccountKeyboard(memberTelegramId, hasAccount = false) {
  const rows = [];
  if (hasAccount) {
    rows.push([btn("Пересоздать аккаунт", `admin:panelacc:recreate:${memberTelegramId}`, "loading")]);
    rows.push([btn("Привязать другой", `admin:panelacc:bind:${memberTelegramId}`, "edit")]);
  } else {
    rows.push([btn("Создать аккаунт", `admin:panelacc:create:${memberTelegramId}`, "success")]);
    rows.push([btn("Привязать существующий", `admin:panelacc:bind:${memberTelegramId}`, "edit")]);
  }
  rows.push([btn("Назад", `admin:member:${memberTelegramId}`, "home")]);
  return Markup.inlineKeyboard(rows);
}

function memberPanelRecreateConfirmKeyboard(memberTelegramId) {
  return Markup.inlineKeyboard([
    [btn("Подтвердить пересоздание", `admin:panelacc:recreate:ok:${memberTelegramId}`, "error")],
    [btn("Отмена", `admin:panelacc:${memberTelegramId}`, "home")],
  ]);
}

function memberProfitResetConfirmKeyboard(memberTelegramId) {
  return Markup.inlineKeyboard([
    [btn("Да, обнулить", `admin:profit_reset:ok:${memberTelegramId}`, "error")],
    [btn("Отмена", `admin:member:${memberTelegramId}`, "home")],
  ]);
}

module.exports = {
  adminPanelKeyboard,
  adminUsersKeyboard,
  adminCommsKeyboard,
  adminEconomyKeyboard,
  adminCurrencyKeyboard,
  adminStatsKeyboard,
  adminAdsKeyboard,
  adminAdCampaignKeyboard,
  adminAdDeleteConfirmKeyboard,
  adminLogsKeyboard,
  adminBotLogsKeyboard,
  adminTemplatesKeyboard,
  adminCancelKeyboard,
  adminBackKeyboard,
  adminResultKeyboard,
  memberActionKeyboard,
  memberPanelAccountKeyboard,
  memberPanelRecreateConfirmKeyboard,
  memberProfitResetConfirmKeyboard,
};
