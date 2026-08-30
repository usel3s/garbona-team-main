const { Markup } = require("telegraf");
const { btn, urlBtn, webAppBtn, switchInlineBtn } = require("../utils/emoji");
const {
  workerPanelAppUrl,
  adminPayoutUrl,
  docsSiteUrl,
} = require("../utils/panelLinks");
const { env } = require("../config/env");

function applicationStartKeyboard() {
  return Markup.inlineKeyboard([[btn("Подать заявку", "menu:apply", "notification")]]);
}

function channelSubscribeKeyboard() {
  const url = env.aboutInfoChannelUrl || "https://t.me/garbonainfo";
  return Markup.inlineKeyboard([
    [urlBtn("Подписаться на канал", url, "broadcast")],
    [btn("Я подписался · проверить", "app:check_sub", "success")],
    [btn("Назад", "menu:home", "home")],
  ]);
}

function rulesAcceptKeyboard() {
  return Markup.inlineKeyboard([
    [btn("Принимаю", "app:rules_accept", "success")],
    [btn("Отменить", "menu:home", "error")],
  ]);
}

function acceptedStartKeyboard({ chatInviteUrl = "", showChatCallback = false } = {}) {
  const panelUrl = workerPanelAppUrl();
  const rows = [];

  if (chatInviteUrl) {
    rows.push([urlBtn("Вступить в чат", chatInviteUrl, "users")]);
  } else if (showChatCallback) {
    rows.push([btn("Вступить в чат", "welcome:workers_chat", "users")]);
  }

  if (panelUrl) {
    rows.push([webAppBtn("Открыть панель", panelUrl, "code")]);
  }

  rows.push([btn("В главное меню", "menu:home", "home")]);
  return Markup.inlineKeyboard(rows);
}

function participantPanelKeyboard(isAdmin) {
  const panelUrl = workerPanelAppUrl();
  const rows = [];

  if (panelUrl) {
    rows.push([webAppBtn("Открыть панель", panelUrl, "code")]);
  }

  rows.push(
    [btn("Профиль", "menu:profile", "profile")],
    [btn("Топ воркеров", "menu:top_workers", "analytics")],
    [btn("О проекте", "menu:about", "info"), btn("Настройки", "menu:settings", "settings")],
  );

  if (isAdmin) {
    rows.push([btn("Админ-панель", "admin:panel", "code")]);
  }
  return Markup.inlineKeyboard(rows);
}

function sitesMovedToPanelKeyboard() {
  const panelUrl = workerPanelAppUrl();
  const rows = [];
  if (panelUrl) {
    rows.push([webAppBtn("Открыть панель · Сайты", `${panelUrl}#sites`, "link")]);
  }
  rows.push([btn("Назад", "menu:home", "home")]);
  return Markup.inlineKeyboard(rows);
}

function profileKeyboard(selectedPeriod = "all") {
  const label = (period, text) => (selectedPeriod === period ? `• ${text} •` : text);

  return Markup.inlineKeyboard([
    [
      btn(label("all", "За всё время"), "profile:stats:all", "calendar"),
      btn(label("24h", "За 24 часа"), "profile:stats:24h", "time"),
    ],
    [
      btn(label("7d", "За 7 дней"), "profile:stats:7d", "calendar"),
      btn(label("30d", "За 30 дней"), "profile:stats:30d", "calendar"),
    ],
    [btn("Мои профиты", "profile:profits", "coins")],
    [btn("Мой кошелёк", "profile:wallet", "wallet")],
    [btn("Назад", "menu:home", "home")],
  ]);
}

function walletKeyboard({ showWithdraw = false } = {}) {
  const rows = [
    [
      {
        text: "История транзакций",
        switch_inline_query_current_chat: "wallet",
        icon_custom_emoji_id: "5870528606328852614",
      },
    ],
  ];
  if (showWithdraw) {
    rows.push([btn("Вывод средств", "wallet:withdraw", "transfer")]);
  }
  rows.push([btn("Назад", "menu:profile", "profile")]);
  return Markup.inlineKeyboard(rows);
}

function profitsKeyboard() {
  return Markup.inlineKeyboard([
    [switchInlineBtn("История моих профитов", "profits", "coins")],
    [switchInlineBtn("История профитов помесячно", "profits?group_by=month", "calendar")],
    [switchInlineBtn("История профитов посуточно", "profits?group_by=day", "time")],
    [btn("Назад", "menu:profile", "profile")],
  ]);
}

function withdrawMethodKeyboard() {
  return Markup.inlineKeyboard([
    [btn("USDT TRC20", "wallet:method:usdt_trc20", "coins")],
    [btn("USDT BEP20", "wallet:method:usdt_bep20", "coins")],
    [btn("TON (GRAM)", "wallet:method:ton_gram", "transfer")],
    [btn("Solana", "wallet:method:solana", "coins")],
    [btn("CryptoBot", "wallet:method:cryptobot", "cryptobot")],
    [btn("xRocket", "wallet:method:xRocketr", "transfer")],
    [btn("Lolz", "wallet:method:lolz", "users")],
    [btn("Отменить", "profile:wallet", "error")],
    [btn("В главное меню", "menu:home", "home")],
  ]);
}

function walletAmountCancelKeyboard() {
  return Markup.inlineKeyboard([
    [btn("Отменить", "profile:wallet", "error")],
    [btn("В главное меню", "menu:home", "home")],
  ]);
}

function withdrawConfirmKeyboard() {
  return Markup.inlineKeyboard([
    [btn("Отправить", "wallet:confirm_send", "success")],
    [btn("Отменить", "profile:wallet", "error")],
    [btn("В главное меню", "menu:home", "home")],
  ]);
}

function settingsCancelKeyboard() {
  return Markup.inlineKeyboard([
    [btn("Отменить", "settings:cancel", "error")],
    [btn("В главное меню", "menu:home", "home")],
  ]);
}

function settingsResultKeyboard() {
  return Markup.inlineKeyboard([
    [btn("К настройкам", "menu:settings", "settings")],
    [btn("В главное меню", "menu:home", "home")],
  ]);
}

function homeOnlyKeyboard() {
  return Markup.inlineKeyboard([[btn("В главное меню", "menu:home", "home")]]);
}

function payoutModerationKeyboard(requestId) {
  const url = adminPayoutUrl(requestId);
  if (!url) return Markup.inlineKeyboard([]);
  return Markup.inlineKeyboard([[urlBtn("🔎 Открыть заявку", url)]]);
}

function steamLogSellKeyboard(sourceId) {
  return Markup.inlineKeyboard([
    [btn("Продать", `log:sell:${sourceId}`, "transfer")],
  ]);
}

function steamLogSellPendingKeyboard() {
  return Markup.inlineKeyboard([
    [btn("Заявка отправлена", "log:sell:pending", "time")],
  ]);
}

/**
 * @param {string} infoChannelUrl
 * @param {Record<string, string>} inviteUrls
 */
function aboutProjectKeyboard(infoChannelUrl = "https://t.me/garbona", inviteUrls = {}) {
  const infoUrl = String(infoChannelUrl || "https://t.me/garbona").trim();
  const inv = inviteUrls || {};
  const workersBtn = inv.workers_chat
    ? urlBtn("Чат воркеров", inv.workers_chat, "users")
    : btn("Чат воркеров", "about:workers_chat", "users");
  const payoutsBtn = inv.payouts
    ? urlBtn("Выплаты", inv.payouts, "transfer")
    : btn("Выплаты", "about:payouts", "transfer");
  const manualsBtn = urlBtn("Мануалы", docsSiteUrl(), "file");

  return Markup.inlineKeyboard([
    [workersBtn, payoutsBtn],
    [manualsBtn, urlBtn("Инфоканал", infoUrl, "broadcast")],
    [urlBtn("Discord", env.aboutDiscordUrl, "link")],
    [btn("Правила", "about:rules", "lock")],
    [btn("Назад", "menu:home", "home")],
  ]);
}

function aboutRulesBackKeyboard() {
  return Markup.inlineKeyboard([[btn("Назад", "menu:about", "info")]]);
}

function settingsKeyboard(isNicknameOpen, fakeProfitTag = "", autoSellLogs = true) {
  const rows = [
    [
      btn(
        isNicknameOpen ? "Ник в выплатах: открыт" : "Ник в выплатах: скрыт",
        "settings:toggle_nick",
        isNicknameOpen ? "visible" : "hidden"
      ),
    ],
  ];
  if (!isNicknameOpen) {
    const tag = String(fakeProfitTag || "").trim();
    const label = tag ? `FAKE-TAG: #${tag}` : "FAKE-TAG: Рандом";
    rows.push([btn(label, "settings:fake_tag", "tag")]);
  }
  rows.push(
    [
      btn(
        autoSellLogs ? "Автопродажа логов: вкл" : "Автопродажа логов: выкл",
        "settings:toggle_auto_sell",
        autoSellLogs ? "visible" : "hidden"
      ),
    ],
    [btn("Добавить описание", "settings:add_description", "edit")],
    [btn("Назад", "menu:home", "home")]
  );
  return Markup.inlineKeyboard(rows);
}

function fakeTagKeyboard(currentTag = "") {
  const tag = String(currentTag || "").trim();
  return Markup.inlineKeyboard([
    [btn("Рандом", "settings:fake_tag_random", "loading")],
    [btn("Свой тег", "settings:fake_tag_custom", "edit")],
    [btn("Назад", "menu:settings", "settings")],
  ]);
}

function fakeTagCancelKeyboard() {
  return Markup.inlineKeyboard([[btn("Отменить", "settings:fake_tag", "error")]]);
}

function topWorkersKeyboard(selectedPeriod = "all", options = {}) {
  const label = (period, text) => (selectedPeriod === period ? `• ${text} •` : text);
  const back = options.back || "menu:home";
  const periodPrefix = options.periodPrefix || "top:period";

  return Markup.inlineKeyboard([
    [
      btn(label("all", "За всё время"), `${periodPrefix}:all`, "calendar"),
      btn(label("24h", "За 24 часа"), `${periodPrefix}:24h`, "time"),
    ],
    [
      btn(label("7d", "За 7 дней"), `${periodPrefix}:7d`, "calendar"),
      btn(label("30d", "За 30 дней"), `${periodPrefix}:30d`, "calendar"),
    ],
    [btn("Назад", back, "home")],
  ]);
}

function publicProfileKeyboard(telegramId, selectedPeriod = "all", options = {}) {
  const tid = String(telegramId || "");
  const label = (period, text) => (selectedPeriod === period ? `• ${text} •` : text);
  const back = options.back || "menu:top_workers";
  const hidden = Boolean(options.hidden);

  if (hidden) {
    return Markup.inlineKeyboard([[btn("Назад", back, "home")]]);
  }

  return Markup.inlineKeyboard([
    [
      btn(label("all", "За всё время"), `top:user:${tid}:all`, "calendar"),
      btn(label("24h", "За 24 часа"), `top:user:${tid}:24h`, "time"),
    ],
    [
      btn(label("7d", "За 7 дней"), `top:user:${tid}:7d`, "calendar"),
      btn(label("30d", "За 30 дней"), `top:user:${tid}:30d`, "calendar"),
    ],
    [btn("Назад", back, "home")],
  ]);
}

module.exports = {
  applicationStartKeyboard,
  channelSubscribeKeyboard,
  rulesAcceptKeyboard,
  acceptedStartKeyboard,
  participantPanelKeyboard,
  sitesMovedToPanelKeyboard,
  profileKeyboard,
  walletKeyboard,
  profitsKeyboard,
  withdrawMethodKeyboard,
  walletAmountCancelKeyboard,
  withdrawConfirmKeyboard,
  payoutModerationKeyboard,
  aboutProjectKeyboard,
  aboutRulesBackKeyboard,
  fakeTagKeyboard,
  fakeTagCancelKeyboard,
  settingsKeyboard,
  settingsCancelKeyboard,
  settingsResultKeyboard,
  homeOnlyKeyboard,
  topWorkersKeyboard,
  publicProfileKeyboard,
  steamLogSellKeyboard,
  steamLogSellPendingKeyboard,
};
