window.WorkerViews = window.WorkerViews || {};

WorkerViews.analyticsState = {
  q: "",
  status: "all",
  sort: "views",
  steamFunnel: null,
};

function analyticsText(key) {
  const strings = {
    ru: {
      active: "Активные",
      allLinks: "Все ссылки",
      conversion: "Конверсия",
      details: "Детализация ссылки",
      funnel: "Воронка",
      fromViews: "от просмотров",
      fromAuths: "от авторизаций",
      pcUsers: "ПК",
      noFilteredResults: "Измените фильтр или поисковый запрос.",
      paused: "Остановленные",
      results: "Показано",
      sortAuths: "Авторизации",
      sortEarned: "Заработано",
      sortLabel: "Сортировка",
      sortLogs: "Валидные логи",
      sortOnline: "Сейчас онлайн",
      sortViews: "Просмотры",
      totalLinks: "Всего ссылок",
      visitsTitle: "Переходов на сайт",
    },
    en: {
      active: "Active",
      allLinks: "All links",
      conversion: "Conversion",
      details: "Link details",
      funnel: "Funnel",
      fromViews: "of views",
      fromAuths: "of auths",
      pcUsers: "PC",
      noFilteredResults: "Change the filter or search query.",
      paused: "Paused",
      results: "Showing",
      sortAuths: "Authorizations",
      sortEarned: "Earned",
      sortLabel: "Sort",
      sortLogs: "Valid logs",
      sortOnline: "Online now",
      sortViews: "Views",
      totalLinks: "Total links",
      visitsTitle: "Site visits",
    },
  };
  const language = window.WorkerI18n?.lang?.() === "en" ? "en" : "ru";
  return strings[language][key] || strings.ru[key] || key;
}

function analyticsNumber(value) {
  return new Intl.NumberFormat(WorkerI18n.lang() === "en" ? "en-US" : "ru-RU").format(
    Number(value || 0)
  );
}

function analyticsRate(value, total) {
  const denominator = Number(total || 0);
  if (denominator <= 0) return 0;
  return Math.min(999, Math.max(0, (Number(value || 0) / denominator) * 100));
}

function analyticsRateLabel(value, total) {
  const rate = analyticsRate(value, total);
  return `${rate < 10 && rate > 0 ? rate.toFixed(1) : Math.round(rate)}%`;
}

function linkLabel(link, domainName) {
  const path = String(link.path || "").replace(/^\/+/, "");
  const host = String(domainName || "").replace(/^https?:\/\//, "");
  if (link.url) return String(link.url).replace(/^https?:\/\//, "");
  return path ? `${host}/${path}` : `${host}/`;
}

function countryFlagUrl(code, size) {
  const cc = String(code || "")
    .trim()
    .toLowerCase();
  if (!/^[a-z]{2}$/.test(cc)) return "";
  const dim = size === "w40" ? "w40" : "w20";
  return `https://flagcdn.com/${dim}/${cc}.png`;
}

function countryFlag(code) {
  const cc = String(code || "")
    .trim()
    .toUpperCase();
  if (cc === "CIS" || cc === "UN" || cc === "XX" || cc === "ZZ" || !/^[A-Z]{2}$/.test(cc)) {
    return `<span class="analytics-flag is-fallback" aria-hidden="true">🌐</span>`;
  }
  const src = countryFlagUrl(cc, "w20");
  const src2x = countryFlagUrl(cc, "w40");
  const safe = WorkerFormat.escapeHtml(cc);
  return `<span class="analytics-flag" aria-hidden="true"><img src="${src}" srcset="${src2x} 2x" width="20" height="15" alt="${safe}" title="${safe}" loading="lazy" decoding="async" /></span>`;
}

function countryLabel(row) {
  return String(row?.name || row?.code || "").trim() || "—";
}

function countryCode(row) {
  return String(row?.code || row?.name || "")
    .trim()
    .toUpperCase();
}

function deviceIcon(name) {
  const n = String(name || "").toLowerCase();
  if (/iphone|android|mobile|phone|ios/.test(n)) {
    return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="7.5" y="3.5" width="9" height="17" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M11 17.5h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  }
  if (/ipad|tablet/.test(n)) {
    return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4.5" y="3.5" width="15" height="17" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M11 17.5h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  }
  if (/mac|windows|linux|desktop|pc|chromeos/.test(n)) {
    return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="5" width="17" height="11.5" rx="1.8" stroke="currentColor" stroke-width="1.5"/><path d="M8.5 19.5h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.25" stroke="currentColor" stroke-width="1.5"/><path d="M4.5 12h15M12 4.5c2.4 2.6 2.4 12.4 0 15M12 4.5c-2.4 2.6-2.4 12.4 0 15" stroke="currentColor" stroke-width="1.3"/></svg>`;
}

function renderEmptyState({ kind = "empty", title, text, actions = [] } = {}) {
  const icon =
    kind === "error"
      ? `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.25" stroke="currentColor" stroke-width="1.5"/><path d="M12 8v5.2M12 15.8h.01" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4.5 19.5h15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M7 16.5V11M12 16.5V7.5M17 16.5v-3.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  const actionsHtml = actions.length
    ? `<div class="empty-state-actions">${actions.join("")}</div>`
    : "";
  return `
    <div class="empty-state">
      <div class="empty-state-icon">${icon}</div>
      <h2 class="empty-state-title">${WorkerFormat.escapeHtml(title)}</h2>
      <p class="empty-state-text">${WorkerFormat.escapeHtml(text)}</p>
      ${actionsHtml}
    </div>`;
}

function renderBreakdownList(items, { kind = "device" } = {}) {
  if (!items?.length) {
    return `<div class="analytics-breakdown-empty">${WorkerFormat.escapeHtml(
      WorkerI18n.t("analytics.noBreakdown")
    )}</div>`;
  }
  const total = items.reduce((sum, row) => sum + Number(row.count || 0), 0) || 1;
  return `
    <ul class="analytics-breakdown-list">
      ${items
        .map((row) => {
          const pct = Math.max(2, Math.round((Number(row.count || 0) / total) * 100));
          const leading =
            kind === "country"
              ? countryFlag(countryCode(row))
              : `<span class="analytics-device-icon" aria-hidden="true">${deviceIcon(row.name)}</span>`;
          const label = kind === "country" ? countryLabel(row) : row.name;
          return `
            <li class="analytics-breakdown-item">
              <div class="analytics-breakdown-head">
                <span class="analytics-breakdown-label">
                  ${leading}
                  <span>${WorkerFormat.escapeHtml(label)}</span>
                </span>
                <span class="analytics-breakdown-count">${Number(row.count || 0)}</span>
              </div>
              <div class="analytics-breakdown-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
            </li>`;
        })
        .join("")}
    </ul>`;
}

function renderLinkRow(row, index) {
  const { link, domain, url } = row;
  if (!link || typeof link !== "object") return "";
  const stats = link.stats || {};
  const paused = Boolean(link.isPaused || domain?.isPaused);
  const conversion = analyticsRateLabel(stats.auths, stats.views);
  return `
    <tr class="analytics-row" data-analytics-index="${index}" tabindex="0" role="button">
      <td>
        <span class="analytics-link-open">
          <span class="analytics-link-url">${WorkerFormat.escapeHtml(url)}</span>
          <span class="analytics-link-meta muted">
            ${WorkerFormat.escapeHtml(domain?.domain || "")}
            ${paused ? ` · ${WorkerI18n.t("sites.linkPaused")}` : ""}
          </span>
        </span>
      </td>
      <td class="td-num"><span class="analytics-online-value${Number(link.online || 0) > 0 ? " is-live" : ""}">${analyticsNumber(link.online)}</span></td>
      <td class="td-num">${analyticsNumber(stats.views)}</td>
      <td class="td-num">
        <span class="analytics-conversion-value">${analyticsNumber(stats.auths)}</span>
        <span class="analytics-cell-rate">${conversion}</span>
      </td>
      <td class="td-num">${analyticsNumber(stats.logs)}</td>
      <td class="td-num">${analyticsNumber(stats.mafiles)}</td>
      <td class="td-num">${WorkerFormat.money(stats.earnedUsd)}</td>
    </tr>`;
}

function renderLinkCard(row, index) {
  const { link, domain, url } = row || {};
  if (!link || typeof link !== "object") return "";
  const stats = link.stats || {};
  const paused = Boolean(link.isPaused || domain?.isPaused);
  return `
    <button type="button" class="analytics-mobile-card" data-analytics-index="${index}">
      <span class="analytics-mobile-card-head">
        <span class="analytics-mobile-card-title">
          <strong>${WorkerFormat.escapeHtml(url)}</strong>
          <small>${WorkerFormat.escapeHtml(domain?.domain || "")}</small>
        </span>
        <span class="site-badge ${paused ? "site-badge-paused" : "site-badge-active"}">
          ${paused ? analyticsText("paused") : analyticsText("active")}
        </span>
      </span>
      <span class="analytics-mobile-stats">
        <span><small>${WorkerI18n.t("sites.onlineLabel")}</small><strong>${analyticsNumber(link.online)}</strong></span>
        <span><small>${WorkerI18n.t("sites.views")}</small><strong>${analyticsNumber(stats.views)}</strong></span>
        <span><small>${WorkerI18n.t("sites.auths")}</small><strong>${analyticsNumber(stats.auths)} <em>${analyticsRateLabel(stats.auths, stats.views)}</em></strong></span>
        <span><small>${WorkerI18n.t("sites.validLogs")}</small><strong>${analyticsNumber(stats.logs)}</strong></span>
        <span><small>MaFile</small><strong>${analyticsNumber(stats.mafiles)}</strong></span>
        <span><small>${WorkerI18n.t("analytics.colEarned")}</small><strong>${WorkerFormat.money(stats.earnedUsd)}</strong></span>
      </span>
    </button>`;
}

function renderAnalyticsSummary(rows, steamFunnel = null) {
  const totals = rows.reduce(
    (result, row) => {
      const stats = row.link?.stats || {};
      result.online += Number(row.link?.online || 0);
      result.views += Number(stats.views || 0);
      result.clicks += Number(stats.clicks || 0);
      result.auths += Number(stats.auths || 0);
      result.logs += Number(stats.logs || 0);
      result.mafiles += Number(stats.mafiles || 0);
      return result;
    },
    { online: 0, views: 0, clicks: 0, auths: 0, logs: 0, mafiles: 0 }
  );

  // UProject may omit Log/MaFile; API fills steamFunnel from SteamLog.
  if (!totals.logs && steamFunnel && Number(steamFunnel.logs || 0) > 0) {
    totals.logs = Number(steamFunnel.logs);
  }
  if (!totals.mafiles && steamFunnel && Number(steamFunnel.mafiles || 0) > 0) {
    totals.mafiles = Number(steamFunnel.mafiles);
  }

  const cards = [
    {
      tone: "links",
      label: analyticsText("totalLinks"),
      value: rows.length,
      meta: `${rows.filter((row) => !row.isPaused).length} ${analyticsText("active").toLowerCase()}`,
      icon: `<path d="M9.5 14.5 14.5 9M7.2 16.8l-1 .9a3 3 0 0 1-4.2-4.2l3.1-3.1a3 3 0 0 1 4.2 0M16.8 7.2l1-.9a3 3 0 0 1 4.2 4.2l-3.1 3.1a3 3 0 0 1-4.2 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
    },
    {
      tone: "online",
      label: WorkerI18n.t("sites.onlineLabel"),
      value: totals.online,
      meta: analyticsText("sortOnline"),
      icon: `<circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.5"/><path d="M5 12h14M12 4c2.3 2.5 2.3 13.5 0 16M12 4c-2.3 2.5-2.3 13.5 0 16" stroke="currentColor" stroke-width="1.3"/>`,
    },
    {
      tone: "views",
      label: WorkerI18n.t("sites.views"),
      value: totals.views,
      meta: analyticsText("visitsTitle"),
      icon: `<path d="M3.5 12s3.2-5.5 8.5-5.5 8.5 5.5 8.5 5.5-3.2 5.5-8.5 5.5S3.5 12 3.5 12Z" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="2.4" stroke="currentColor" stroke-width="1.5"/>`,
    },
    {
      tone: "auths",
      label: WorkerI18n.t("sites.auths"),
      value: totals.auths,
      meta: `${analyticsRateLabel(totals.auths, totals.views)} ${analyticsText("fromViews")}`,
      icon: `<path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10M6.5 10h11v9.5h-11V10Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 14v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
    },
    {
      tone: "logs",
      label: WorkerI18n.t("sites.validLogs"),
      value: totals.logs,
      meta: `${analyticsRateLabel(totals.logs, totals.auths)} ${analyticsText("fromAuths")}`,
      icon: `<path d="M7 4h7l3 3v13H7V4Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M14 4v4h3M10 12h4M10 15h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
    },
    {
      tone: "mafile",
      label: "MaFile",
      value: totals.mafiles,
      meta: `${analyticsRateLabel(totals.mafiles, totals.auths)} ${analyticsText("fromAuths")}`,
      icon: `<path d="M8 4.5h5l4 4V19a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 19V6A1.5 1.5 0 0 1 8 4.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M13 4.5V9h4.5M9.5 13.5h5M9.5 16.5h3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
    },
  ];

  return cards
    .map(
      (card) => `
        <article class="analytics-summary-card is-${card.tone}">
          <span class="analytics-summary-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none">${card.icon}</svg></span>
          <span class="analytics-summary-copy">
            <span>${WorkerFormat.escapeHtml(card.label)}</span>
            <strong>${card.money ? WorkerFormat.money(card.value) : analyticsNumber(card.value)}</strong>
            <small>${WorkerFormat.escapeHtml(card.meta)}</small>
          </span>
        </article>`
    )
    .join("");
}

function renderAnalyticsFunnel(stats) {
  const steps = [
    { label: WorkerI18n.t("sites.views"), value: Number(stats.views || 0), base: Number(stats.views || 0) },
    { label: WorkerI18n.t("sites.auths"), value: Number(stats.auths || 0), base: Number(stats.views || 0) },
    { label: WorkerI18n.t("sites.validLogs"), value: Number(stats.logs || 0), base: Number(stats.auths || 0) },
    { label: "MaFile", value: Number(stats.mafiles || 0), base: Number(stats.auths || 0) },
  ];
  const max = Math.max(1, ...steps.map((step) => step.value));
  return `
    <div class="analytics-funnel">
      ${steps
        .map(
          (step, index) => `
            <div class="analytics-funnel-row">
              <div class="analytics-funnel-copy">
                <span>${WorkerFormat.escapeHtml(step.label)}</span>
                <strong>${analyticsNumber(step.value)}${index ? `<small>${analyticsRateLabel(step.value, step.base)}</small>` : ""}</strong>
              </div>
              <div class="analytics-funnel-track" aria-hidden="true"><span style="width:${Math.max(step.value ? 7 : 0, (step.value / max) * 100)}%"></span></div>
            </div>`
        )
        .join("")}
    </div>`;
}

function renderDrawer(row) {
  const { link, domain, url } = row;
  if (!link || typeof link !== "object") return "";
  const stats = link.stats || {};
  const href = `https://${url}`;
  const paused = Boolean(link.isPaused || domain.isPaused);
  return `
    <div class="analytics-drawer-panel">
      <div class="analytics-drawer-head">
        <div class="analytics-drawer-titles">
          <div class="analytics-drawer-kicker">${analyticsText("details")} · ${WorkerFormat.escapeHtml(domain.domain || "")}</div>
          <h2 class="analytics-drawer-title">${WorkerFormat.escapeHtml(url)}</h2>
        </div>
        <button type="button" class="btn btn-ghost analytics-drawer-close" id="analyticsDrawerClose" aria-label="${WorkerFormat.escapeHtml(WorkerI18n.t("common.close"))}">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        </button>
      </div>

      <div class="analytics-drawer-actions">
        <a class="btn btn-primary" href="${WorkerFormat.escapeHtml(href)}" target="_blank" rel="noopener noreferrer">
          ${WorkerI18n.t("analytics.openLink")}
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 15 15.5 8.5M11 8.5h4.5V13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 14.5V18H6V6h3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </a>
        ${
          paused
            ? `<span class="badge warn">${WorkerI18n.t("sites.linkPaused")}</span>`
            : `<span class="badge ok">${analyticsText("active")}</span>`
        }
      </div>

      <div class="analytics-drawer-kpis">
        <div class="analytics-drawer-kpi is-live"><span>${WorkerI18n.t("sites.onlineLabel")}</span><strong>${analyticsNumber(link.online)}</strong></div>
        <div class="analytics-drawer-kpi"><span>${WorkerI18n.t("analytics.colEarned")}</span><strong>${WorkerFormat.money(stats.earnedUsd)}</strong></div>
        <div class="analytics-drawer-kpi"><span>${WorkerI18n.t("sites.auths")}</span><strong>${analyticsNumber(stats.auths)}</strong></div>
        <div class="analytics-drawer-kpi"><span>${analyticsText("conversion")}</span><strong>${analyticsRateLabel(stats.auths, stats.views)}</strong></div>
        ${
          stats.desktopPercent != null
            ? `<div class="analytics-drawer-kpi"><span>${analyticsText("pcUsers")}</span><strong>${Number(stats.desktopPercent).toFixed(2)}%</strong></div>`
            : ""
        }
      </div>

      <section class="analytics-drawer-section">
        <h3>${analyticsText("funnel")}</h3>
        ${renderAnalyticsFunnel(stats)}
      </section>

      <section class="analytics-drawer-section">
        <h3>${WorkerI18n.t("analytics.devicesTitle")}</h3>
        ${renderBreakdownList(link.devices || [], { kind: "device" })}
      </section>

      ${
        (link.countries || []).length
          ? `<section class="analytics-drawer-section">
        <h3>${WorkerI18n.t("analytics.countriesTitle")}</h3>
        ${renderBreakdownList(link.countries || [], { kind: "country" })}
      </section>`
          : ""
      }

      <section class="analytics-drawer-section analytics-drawer-meta">
        <div><span class="muted">${WorkerI18n.t("analytics.template")}</span><strong>${WorkerFormat.escapeHtml(link.templateName || "—")}</strong></div>
        <div><span class="muted">${WorkerI18n.t("analytics.window")}</span><strong>${WorkerFormat.escapeHtml(link.windowType || "—")}</strong></div>
      </section>
    </div>`;
}

WorkerViews.analytics = async function renderAnalytics(ctx) {
  const { main } = ctx;
  const state = WorkerViews.analyticsState;
  let allRows = [];

  function renderShell() {
    main.innerHTML = `
      <div class="page-head analytics-page-head">
        <div>
          <h1 class="page-greeting">${WorkerI18n.t("analytics.pageTitle")}</h1>
          <p class="page-sub muted">${WorkerI18n.t("analytics.subtitle")}</p>
        </div>
        <div class="page-head-actions">
          <button type="button" class="btn btn-ghost analytics-refresh" id="analyticsRefresh">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M19 8V4m0 0h-4M19 4l-3.1 3.1a6 6 0 1 0 1.4 6.3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            ${WorkerI18n.t("common.refresh")}
          </button>
        </div>
      </div>

      <div id="analyticsContent">
        <section class="analytics-summary-grid" id="analyticsSummary" aria-label="${WorkerFormat.escapeHtml(analyticsText("totalLinks"))}">
          ${Array.from({ length: 6 }, () => '<div class="analytics-summary-card is-loading"></div>').join("")}
        </section>

        <section class="section analytics-list-section">
          <div class="analytics-list-head">
            <div>
              <h2 class="section-title">${analyticsText("allLinks")}</h2>
              <p class="analytics-results muted" id="analyticsResults"></p>
            </div>
            <div id="analyticsSort" class="custom-select-host analytics-sort"></div>
          </div>

          <div class="analytics-toolbar">
            <label class="sites-search analytics-search">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.5"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
              <input type="search" id="analyticsSearch" value="${WorkerFormat.escapeHtml(state.q)}" placeholder="${WorkerI18n.t("analytics.searchPlaceholder")}" autocomplete="off" />
            </label>
            <div class="analytics-filters" role="group" aria-label="${WorkerFormat.escapeHtml(WorkerI18n.t("sites.filterStatus"))}">
              <button type="button" class="analytics-filter" data-analytics-filter="all">${WorkerI18n.t("sites.filterAll")} <span id="analyticsCountAll">0</span></button>
              <button type="button" class="analytics-filter" data-analytics-filter="active">${analyticsText("active")} <span id="analyticsCountActive">0</span></button>
              <button type="button" class="analytics-filter" data-analytics-filter="paused">${analyticsText("paused")} <span id="analyticsCountPaused">0</span></button>
            </div>
          </div>

          <div class="table-wrap analytics-table-wrap">
            <table class="data analytics-table">
              <thead>
                <tr>
                  <th>${WorkerI18n.t("analytics.colLink")}</th>
                  <th class="col-num">${WorkerI18n.t("sites.onlineLabel")}</th>
                  <th class="col-num">${WorkerI18n.t("sites.views")}</th>
                  <th class="col-num">${WorkerI18n.t("sites.auths")}</th>
                  <th class="col-num">${WorkerI18n.t("sites.validLogs")}</th>
                  <th class="col-num">MaFile</th>
                  <th class="col-num">${WorkerI18n.t("analytics.colEarned")}</th>
                </tr>
              </thead>
              <tbody id="analyticsBody">
                <tr><td colspan="7" class="panel-empty">${WorkerFormat.escapeHtml(WorkerI18n.t("common.loading"))}</td></tr>
              </tbody>
            </table>
          </div>
          <div class="analytics-mobile-list" id="analyticsMobileList"></div>
        </section>
      </div>

      <div class="analytics-drawer" id="analyticsDrawer" hidden>
        <div class="analytics-drawer-backdrop" id="analyticsDrawerBackdrop"></div>
        <aside class="analytics-drawer-sheet" id="analyticsDrawerSheet" role="dialog" aria-modal="true"></aside>
      </div>`;
  }

  function closeDrawer() {
    const drawer = document.getElementById("analyticsDrawer");
    if (!drawer) return;
    drawer.classList.remove("is-open");
    document.body.classList.remove("analytics-drawer-open");
    window.setTimeout(() => {
      if (!drawer.classList.contains("is-open")) drawer.hidden = true;
    }, 220);
  }

  function openDrawer(index) {
    const row = allRows[index];
    const drawer = document.getElementById("analyticsDrawer");
    const sheet = document.getElementById("analyticsDrawerSheet");
    if (!row || !drawer || !sheet) return;
    sheet.innerHTML = renderDrawer(row);
    drawer.hidden = false;
    requestAnimationFrame(() => {
      drawer.classList.add("is-open");
      document.body.classList.add("analytics-drawer-open");
    });
    document.getElementById("analyticsDrawerClose")?.addEventListener("click", closeDrawer);
  }

  function bindResultClicks() {
    document.querySelectorAll("[data-analytics-index]").forEach((element) => {
      const open = () => openDrawer(Number(element.dataset.analyticsIndex));
      element.addEventListener("click", open);
      if (element.classList.contains("analytics-row")) {
        element.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          open();
        });
      }
    });
  }

  function updateFilterCounts() {
    const active = allRows.filter((row) => !row.isPaused).length;
    const paused = allRows.length - active;
    const counts = { All: allRows.length, Active: active, Paused: paused };
    Object.entries(counts).forEach(([key, value]) => {
      const element = document.getElementById(`analyticsCount${key}`);
      if (element) element.textContent = analyticsNumber(value);
    });
    document.querySelectorAll("[data-analytics-filter]").forEach((button) => {
      const selected = button.dataset.analyticsFilter === state.status;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  function filteredRows() {
    const query = String(state.q || "").toLowerCase();
    return allRows
      .filter((row) => state.status === "all" || (state.status === "paused") === row.isPaused)
      .filter((row) => !query || row.search.includes(query))
      .sort((a, b) => {
        const metric = state.sort || "views";
        const aValue = metric === "online" ? a.link.online : a.link.stats?.[metric];
        const bValue = metric === "online" ? b.link.online : b.link.stats?.[metric];
        return Number(bValue || 0) - Number(aValue || 0) || a.url.localeCompare(b.url);
      });
  }

  function paint() {
    if (window.WorkerShell?.currentView?.() !== "analytics") return;
    if (!allRows.length) {
      const content = document.getElementById("analyticsContent");
      if (!content) return;
      content.innerHTML = renderEmptyState({
        title: WorkerI18n.t("analytics.emptyTitle"),
        text: WorkerI18n.t("analytics.emptyText"),
        actions: [
          `<button type="button" class="btn btn-primary" id="analyticsGoSites">${WorkerFormat.escapeHtml(
            WorkerI18n.t("analytics.goSites")
          )}</button>`,
        ],
      });
      document.getElementById("analyticsGoSites")?.addEventListener("click", () => {
        document.querySelector('.nav-item[data-view="sites"]')?.click();
      });
      return;
    }

    if (!document.getElementById("analyticsSummary")) {
      if (window.WorkerShell?.currentView?.() !== "analytics") return;
      renderShell();
      bindControls();
    }

    const summary = document.getElementById("analyticsSummary");
    const body = document.getElementById("analyticsBody");
    const mobileList = document.getElementById("analyticsMobileList");
    const results = document.getElementById("analyticsResults");
    if (!summary || !body || !mobileList || !results) return;

    summary.innerHTML = renderAnalyticsSummary(allRows, state.steamFunnel);
    updateFilterCounts();
    const rows = filteredRows();
    results.textContent = `${analyticsText("results")}: ${analyticsNumber(rows.length)} / ${analyticsNumber(allRows.length)}`;

    if (!rows.length) {
      const empty = renderEmptyState({
        title: WorkerI18n.t("analytics.noResultsTitle"),
        text: analyticsText("noFilteredResults"),
      });
      body.innerHTML = `<tr><td colspan="7">${empty}</td></tr>`;
      mobileList.innerHTML = empty;
      return;
    }

    body.innerHTML = rows.map((row) => renderLinkRow(row, row.index)).join("");
    mobileList.innerHTML = rows.map((row) => renderLinkCard(row, row.index)).join("");
    bindResultClicks();
  }

  function mountSort() {
    const host = document.getElementById("analyticsSort");
    if (!host || !window.WorkerDropdown) return;
    WorkerDropdown.mount(host, {
      value: state.sort,
      ariaLabel: analyticsText("sortLabel"),
      options: [
        { value: "views", label: `${analyticsText("sortViews")} ↓` },
        { value: "auths", label: `${analyticsText("sortAuths")} ↓` },
        { value: "logs", label: `${analyticsText("sortLogs")} ↓` },
        { value: "earnedUsd", label: `${analyticsText("sortEarned")} ↓` },
        { value: "online", label: `${analyticsText("sortOnline")} ↓` },
      ],
      onChange: (value) => {
        state.sort = value;
        paint();
      },
    });
  }

  function bindControls() {
    document.getElementById("analyticsRefresh")?.addEventListener("click", () =>
      load({ force: true })
    );
    document.getElementById("analyticsSearch")?.addEventListener("input", (event) => {
      state.q = event.target.value.trim();
      paint();
    });
    document.querySelectorAll("[data-analytics-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        state.status = button.dataset.analyticsFilter || "all";
        paint();
      });
    });
    document.getElementById("analyticsDrawerBackdrop")?.addEventListener("click", closeDrawer);
    mountSort();
  }

  function showLoadError(error) {
    const content = document.getElementById("analyticsContent");
    if (!content) return;
    content.innerHTML = renderEmptyState({
      kind: "error",
      title: WorkerI18n.t("analytics.errorTitle"),
      text:
        (window.WorkerToast && WorkerToast.friendlyError(error)) ||
        error.message ||
        WorkerI18n.t("common.error"),
      actions: [
        `<button type="button" class="btn btn-ghost" id="analyticsRetry">${WorkerFormat.escapeHtml(
          WorkerI18n.t("common.retry")
        )}</button>`,
      ],
    });
    document.getElementById("analyticsRetry")?.addEventListener("click", () => {
      renderShell();
      bindControls();
      load({ force: true });
    });
  }

  async function load({ force = false } = {}) {
    if (window.WorkerShell?.currentView?.() !== "analytics") return;
    closeDrawer();
    const refreshButton = document.getElementById("analyticsRefresh");
    refreshButton?.classList.add("is-loading");
    if (refreshButton) refreshButton.disabled = true;

    try {
      const domainsData = await WorkerAPI.get("/sites/domains?includeLinks=1", { force });
      if (window.WorkerShell?.currentView?.() !== "analytics") return;
      const domains = Array.isArray(domainsData.domains) ? domainsData.domains : [];
      state.steamFunnel = domainsData.steamFunnel || {
        logs: Number(domainsData.totalLogs || 0),
        mafiles: Number(domainsData.totalMafiles || 0),
      };
      allRows = [];

      for (const domain of domains) {
        const links = (Array.isArray(domain.links) ? domain.links : []).filter(
          (link) => link && typeof link === "object"
        );
        for (const link of links) {
          const url = linkLabel(link, domain.domain);
          const isPaused = Boolean(link.isPaused || domain.isPaused);
          allRows.push({
            index: allRows.length,
            search: `${url} ${domain.domain} ${link.templateName || ""}`.toLowerCase(),
            url,
            link,
            domain,
            isPaused,
          });
        }
      }
      paint();
    } catch (error) {
      if (window.WorkerToast) WorkerToast.error(error);
      showLoadError(error);
    } finally {
      refreshButton?.classList.remove("is-loading");
      if (refreshButton) refreshButton.disabled = false;
    }
  }

  renderShell();
  bindControls();
  if (!WorkerViews.analyticsState._escBound) {
    WorkerViews.analyticsState._escBound = true;
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      const drawer = document.getElementById("analyticsDrawer");
      if (drawer && !drawer.hidden) closeDrawer();
    });
  }

  if (WorkerViews.analyticsState._pollTimer) {
    clearInterval(WorkerViews.analyticsState._pollTimer);
    WorkerViews.analyticsState._pollTimer = null;
  }
  WorkerViews.analyticsState._pollTimer = setInterval(() => {
    if (document.hidden) return;
    if (window.WorkerShell?.currentView?.() !== "analytics") return;
    const drawer = document.getElementById("analyticsDrawer");
    if (drawer && !drawer.hidden) return;
    load({ force: true }).catch(() => {});
  }, 15000);

  await load({ force: !!ctx.refresh });
};
