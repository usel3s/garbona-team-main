const { Markup } = require("telegraf");
const { btn } = require("../utils/emoji");

function applicationCancelKeyboard() {
  return Markup.inlineKeyboard([
    [btn("Отменить", "app:cancel", "error")],
  ]);
}

function applicationPreviewKeyboard() {
  return Markup.inlineKeyboard([
    [btn("Отправить", "app:submit", "success")],
    [btn("Изменить", "app:edit", "edit")],
    [btn("Отменить", "app:cancel", "error")],
  ]);
}

function applicationResultKeyboard() {
  return Markup.inlineKeyboard([[btn("В главное меню", "menu:home", "home")]]);
}

function moderatorApplicationKeyboard(applicationId) {
  return Markup.inlineKeyboard([
    [
      btn("Принять", `moderate:accept:${applicationId}`, "success"),
      btn("Отклонить", `moderate:reject:${applicationId}`, "error"),
    ],
  ]);
}

function adminAppsHubKeyboard() {
  return Markup.inlineKeyboard([
    [btn("На рассмотрении", "admin:apps:pending:0", "time")],
    [btn("Закрытые", "admin:apps:closed:0", "file")],
    [btn("Вопросы формы", "admin:apps:questions", "edit")],
    [btn("Назад", "admin:stats", "home")],
  ]);
}

function adminAppsListKeyboard(kind, page, totalPages, items) {
  const rows = items.map((app) => {
    const user = app.userId;
    const name = user?.username ? `@${user.username}` : user?.telegramId || "user";
    const shortId = String(app._id).slice(-6);
    const statusMark =
      app.status === "accepted" ? "✓ " : app.status === "rejected" ? "✗ " : "";
    return [
      btn(
        `${statusMark}${name} · ${shortId}`,
        `admin:apps:view:${kind}:${page}:${app._id}`,
        "profile"
      ),
    ];
  });

  const nav = [];
  if (page > 0) {
    nav.push(btn("←", `admin:apps:${kind}:${page - 1}`, "time"));
  }
  nav.push(btn(`${page + 1}/${totalPages}`, "admin:apps:noop", "info"));
  if (page + 1 < totalPages) {
    nav.push(btn("→", `admin:apps:${kind}:${page + 1}`, "time"));
  }
  if (nav.length) rows.push(nav);

  rows.push([btn("Назад", "admin:apps", "home")]);
  return Markup.inlineKeyboard(rows);
}

function adminAppViewKeyboard(applicationId, status, backCallback = "admin:apps") {
  const rows = [];
  if (status === "pending") {
    rows.push([
      btn("Принять", `admin:apps:accept:${applicationId}`, "success"),
      btn("Отклонить", `admin:apps:reject:${applicationId}`, "error"),
    ]);
  } else if (status === "rejected") {
    rows.push([
      btn("Изменить → принять", `admin:apps:accept:${applicationId}`, "success"),
    ]);
  } else if (status === "accepted") {
    rows.push([
      btn("Изменить → отклонить", `admin:apps:reject:ask:${applicationId}`, "error"),
    ]);
  }
  rows.push([btn("Назад", backCallback, "home")]);
  return Markup.inlineKeyboard(rows);
}

function adminAppRejectConfirmKeyboard(applicationId, backCallback = "admin:apps") {
  return Markup.inlineKeyboard([
    [
      btn("Да, отклонить", `admin:apps:reject:confirm:${applicationId}`, "error"),
      btn("Отмена", backCallback, "home"),
    ],
  ]);
}

function adminQuestionsKeyboard(questions) {
  const rows = questions.map((q, idx) => [
    btn(`${idx + 1}. ${q.label}`, `admin:apps:qdel:${q.key}`, "delete"),
  ]);
  rows.push([btn("Добавить вопрос", "admin:apps:qadd", "edit")]);
  rows.push([btn("Назад", "admin:apps", "home")]);
  return Markup.inlineKeyboard(rows);
}

function adminQuestionDeleteConfirmKeyboard(questionKey) {
  return Markup.inlineKeyboard([
    [
      btn("Удалить", `admin:apps:qdel:confirm:${questionKey}`, "delete"),
      btn("Отмена", "admin:apps:questions", "error"),
    ],
  ]);
}

module.exports = {
  applicationCancelKeyboard,
  applicationPreviewKeyboard,
  applicationResultKeyboard,
  moderatorApplicationKeyboard,
  adminAppsHubKeyboard,
  adminAppsListKeyboard,
  adminAppViewKeyboard,
  adminAppRejectConfirmKeyboard,
  adminQuestionsKeyboard,
  adminQuestionDeleteConfirmKeyboard,
};
