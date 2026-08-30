window.WorkerViews = window.WorkerViews || {};

WorkerViews.dashboardPeriodDays = WorkerPrefs.get().defaultPeriod || 7;
WorkerViews.eventsCache = [];
WorkerViews.eventsPage = 1;
WorkerViews.eventsFilters = {
  sort: "date",
  dir: "desc",
};

WorkerViews.dashboard = async function renderDashboard(ctx) {
  const { main, user, refresh } = ctx;
  const days = WorkerViews.dashboardPeriodDays || 7;

  const data = await WorkerAPI.get(`/overview?days=${days}`, { force: !!refresh });
  const k = data.kpi || {};
  const u = data.user || {};
  const name = WorkerFormat.escapeHtml(user.firstName || user.username || user.telegramId);
  const dashboardMeta = WorkerI18n.t("dashboard.subtitle", {
    days: Number(u.daysWithTeam || 0),
    percent: Number(u.profitPercent ?? 0),
  });

  const logsError = data.logsError
    ? `<div class="inline-alert">${WorkerFormat.escapeHtml(WorkerI18n.t("dashboard.logsError"))}</div>`
    : "";

  WorkerViews.eventsCache = buildRecentEvents(data.recentLogs || [], data.recentMafiles || []);
  WorkerViews.eventsPage = 1;
  const events = applyEventsSort(WorkerViews.eventsCache, WorkerViews.eventsFilters);
  const eventsPage = paginateEvents(events, WorkerViews.eventsPage);
  WorkerViews.eventsPage = eventsPage.page;

  const series = data.series || [];
  const sparkProfit = series.map((row) => Number(row.profitUsd || 0));
  const sparkLogs = series.map((row) => Number(row.logsCount || 0));
  const sparkMafile = series.map((row) => Number(row.mafileCount || 0));

  main.innerHTML = `
    <div class="dashboard-page">
    <header class="page-head dashboard-page-head">
      <div>
        <h1 class="page-greeting">${WorkerI18n.t("dashboard.greeting")} <em>${name}</em></h1>
        <p class="page-sub muted">${WorkerFormat.escapeHtml(dashboardMeta)}</p>
      </div>
      <div id="periodSelect" class="custom-select-host dashboard-period-select"></div>
    </header>

    <section class="section section-stats dashboard-stats">
      <div class="section-head">
        <div>
          <h2 class="section-title">${WorkerI18n.t("dashboard.statsTitle")}</h2>
          <p class="dashboard-section-hint muted">${WorkerI18n.t("dashboard.statsHint")}</p>
        </div>
      </div>
      <div class="kpi-grid">
        <div class="kpi-cell dashboard-kpi-primary">
          <div class="kpi-cell-top">
            <span class="kpi-icon kpi-icon-profit" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><path d="M4 16.5 9.2 11l3.3 3.2L20 7.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M15.5 7.5H20V12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
            <div class="kpi-label">${WorkerI18n.t("dashboard.profitTotal")}</div>
          </div>
          <div class="kpi-cell-main">
            <div class="kpi-cell-nums">
              <div class="kpi-value" data-money="${u.profitTotalUsd ?? u.walletUsd ?? 0}">${WorkerFormat.money(u.profitTotalUsd ?? u.walletUsd ?? 0)}</div>
              ${WorkerFormat.kpiDeltaHtml(k.profitTotalDeltaPct)}
            </div>
            ${renderSparkline(sparkProfit, "profit")}
          </div>
        </div>
        <div class="kpi-cell">
          <div class="kpi-cell-top">
            <span class="kpi-icon kpi-icon-period" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><rect x="4" y="5.5" width="16" height="13" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M8 3.5v4M16 3.5v4M4 9.5h16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </span>
            <div class="kpi-label">${WorkerI18n.t("dashboard.profitPeriod")}</div>
          </div>
          <div class="kpi-cell-main">
            <div class="kpi-cell-nums">
              <div class="kpi-value" data-money="${k.profitPeriodUsd || 0}">${WorkerFormat.money(k.profitPeriodUsd || 0)}</div>
              ${WorkerFormat.kpiDeltaHtml(k.profitPeriodDeltaPct)}
            </div>
            ${renderSparkline(sparkProfit, "period")}
          </div>
        </div>
        <div class="kpi-cell">
          <div class="kpi-cell-top">
            <span class="kpi-icon kpi-icon-logs" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><path d="M7 3.5h6.2L17.5 8v11.5A1.5 1.5 0 0 1 16 21H7a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 7 3.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M13.2 3.5V8H17.5M9 12h6M9 15.2h6M9 18.4h3.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
            <div class="kpi-label">${WorkerI18n.t("dashboard.logs")} <span class="kpi-hint">${WorkerI18n.t("dashboard.logsHint")}</span></div>
          </div>
          <div class="kpi-cell-main">
            <div class="kpi-cell-nums">
              <div class="kpi-value">${k.logsPeriod ?? 0} <span class="muted">/ ${k.totalLogs || 0}</span></div>
              ${WorkerFormat.kpiDeltaHtml(k.logsDeltaPct)}
            </div>
            ${renderSparkline(sparkLogs, "logs")}
          </div>
        </div>
        <div class="kpi-cell">
          <div class="kpi-cell-top">
            <span class="kpi-icon kpi-icon-mafile" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><path d="M8 4.5h5l4 4V19a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 19V6A1.5 1.5 0 0 1 8 4.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M13 4.5V9h4.5M9.5 13.5h5M9.5 16.5h3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
            <div class="kpi-label">${WorkerI18n.t("dashboard.mafile")} <span class="kpi-hint">${WorkerI18n.t("dashboard.mafileHint")}</span></div>
          </div>
          <div class="kpi-cell-main">
            <div class="kpi-cell-nums">
              <div class="kpi-value">${k.mafilePeriod ?? 0} <span class="muted">/ ${k.mafileTotal || 0}</span></div>
              ${WorkerFormat.kpiDeltaHtml(k.mafileDeltaPct)}
            </div>
            ${renderSparkline(sparkMafile, "mafile")}
          </div>
        </div>
      </div>
    </section>

    <section class="section section-dynamics dashboard-dynamics">
      <div class="section-head">
        <div>
          <h2 class="section-title">${WorkerI18n.t("dashboard.chartTitle")}</h2>
          <p class="dashboard-section-hint muted">${WorkerI18n.t("dashboard.chartHint")}</p>
        </div>
        <div class="chart-legend">
          <button type="button" class="chart-legend-item" id="legendProfit">
            <span class="chart-legend-dot chart-legend-dot-profit"></span>
            ${WorkerI18n.t("dashboard.chartLegendProfit")}
          </button>
          <button type="button" class="chart-legend-item" id="legendLogs">
            <span class="chart-legend-dot chart-legend-dot-logs"></span>
            ${WorkerI18n.t("dashboard.chartLegendLogs")}
          </button>
          <button type="button" class="chart-legend-item" id="legendMafile">
            <span class="chart-legend-dot chart-legend-dot-mafile"></span>
            ${WorkerI18n.t("dashboard.chartLegendMafile")}
          </button>
        </div>
      </div>
      <div id="dashboardChart" class="chart-area"></div>
    </section>

    <section class="section section-events dashboard-events">
      <div class="section-head">
        <div>
          <h2 class="section-title">${WorkerI18n.t("dashboard.recentEvents")}</h2>
          <p class="dashboard-section-hint muted">${WorkerI18n.t("dashboard.eventsHint", { count: events.length })}</p>
        </div>
        <div id="eventsSortSelect" class="custom-select-host events-sort-host"></div>
      </div>
      ${logsError}
      <div id="eventsTableWrap">${renderEventsFeed(eventsPage.rows, WorkerViews.eventsFilters) + renderEventsPagination(eventsPage)}</div>
    </section>
    </div>
  `;

  WorkerDropdown.mount(document.getElementById("periodSelect"), {
    value: String(days),
    ariaLabel: WorkerI18n.t("dashboard.periodLabel"),
    options: [
      { value: "7", label: WorkerI18n.t("dashboard.period7") },
      { value: "14", label: WorkerI18n.t("dashboard.period14") },
      { value: "30", label: WorkerI18n.t("dashboard.period30") },
    ],
    onChange: (value) => {
      WorkerViews.dashboardPeriodDays = Number(value) || 7;
      WorkerViews.dashboard({ main, user, refresh: true });
    },
  });

  mountEventsSortSelect();
  bindEventsFeedRows();
  bindEventsPagination();

  WorkerCharts.renderDynamicsChart(
    document.getElementById("dashboardChart"),
    (data.series || []).map((row) => ({
      date: row.date,
      label: WorkerFormat.chartDayLabel(row.date),
      profitUsd: row.profitUsd || 0,
      logsCount: row.logsCount || 0,
      mafileCount: row.mafileCount || 0,
      profitDisplay: WorkerFormat.money(row.profitUsd || 0),
    })),
    {
      empty: WorkerI18n.t("dashboard.chartEmpty"),
      profitLabel: WorkerI18n.t("dashboard.chartLegendProfit"),
      logsLabel: WorkerI18n.t("dashboard.chartLegendLogs"),
      mafileLabel: WorkerI18n.t("dashboard.chartLegendMafile"),
      formatAmountTick: (v) => WorkerFormat.moneyTick(v),
      legendProfitEl: document.getElementById("legendProfit"),
      legendLogsEl: document.getElementById("legendLogs"),
      legendMafileEl: document.getElementById("legendMafile"),
    }
  );
};

function renderSparkline(values, tone = "profit") {
  const nums = (values || []).map((v) => Math.max(0, Number(v) || 0));
  const w = 100;
  const h = 24;
  const data = nums.length >= 2 ? nums : [0, 0];
  const max = Math.max(...data, 1);
  const step = w / (data.length - 1);
  const pts = data
    .map((v, i) => {
      const x = i * step;
      const y = h - (v / max) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return `
    <div class="kpi-spark kpi-spark-${tone}${nums.every((v) => v <= 0) ? " is-empty" : ""}" aria-hidden="true">
      <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" focusable="false">
        <polyline points="${pts}"></polyline>
      </svg>
    </div>
  `;
}

function buildRecentEvents(logs, mafiles) {
  const tagged = [
    ...(logs || []).map((row) => ({ ...row, eventType: "log" })),
    ...(mafiles || []).map((row) => ({ ...row, eventType: "mafile" })),
  ];
  return tagged.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

function normalizeEventStatus(status) {
  const raw = String(status || "");
  if (/mafile/i.test(raw)) return "mafile";
  if (/валид|valid|ok/i.test(raw)) return "valid";
  if (/невалид|invalid/i.test(raw)) return "invalid";
  return "other";
}

function applyEventsSort(rows, filters) {
  const dir = filters.dir === "asc" ? 1 : -1;
  return [...rows]
    .sort((a, b) => compareEvents(a, b, filters.sort) * dir);
}

const EVENTS_PAGE_SIZE = 10;

function paginateEvents(rows, page, pageSize = EVENTS_PAGE_SIZE) {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    page: safePage,
    totalPages,
    total,
  };
}

function compareEvents(a, b, sortKey) {
  switch (sortKey) {
    case "id":
      return String(a.id || "").localeCompare(String(b.id || ""), undefined, {
        numeric: true,
        sensitivity: "base",
      });
    case "type":
      return String(a.eventType || "").localeCompare(String(b.eventType || ""));
    case "account": {
      const av = eventAccountLabel(a);
      const bv = eventAccountLabel(b);
      return av.localeCompare(bv);
    }
    case "price":
      return Number(a.priceUsd || 0) - Number(b.priceUsd || 0);
    case "status":
      return normalizeEventStatus(a.status).localeCompare(normalizeEventStatus(b.status));
    case "date":
    default:
      return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
  }
}

function eventAccountLabel(row) {
  const page = String(row.sourcePage || "").trim();
  return page || "—";
}

function eventsSortValue(filters) {
  return `${filters.sort}:${filters.dir}`;
}

function mountEventsSortSelect() {
  const host = document.getElementById("eventsSortSelect");
  if (!host || !window.WorkerDropdown) return;
  const filters = WorkerViews.eventsFilters;
  WorkerDropdown.mount(host, {
    value: eventsSortValue(filters),
    ariaLabel: WorkerI18n.t("dashboard.eventsSort") || "Сортировка",
    options: [
      { value: "date:desc", label: WorkerI18n.t("dashboard.sortDateDesc") || "Сначала новые" },
      { value: "date:asc", label: WorkerI18n.t("dashboard.sortDateAsc") || "Сначала старые" },
      { value: "price:desc", label: WorkerI18n.t("dashboard.sortPriceDesc") || "Цена ↓" },
      { value: "price:asc", label: WorkerI18n.t("dashboard.sortPriceAsc") || "Цена ↑" },
      { value: "status:asc", label: WorkerI18n.t("dashboard.sortStatus") || "По статусу" },
    ],
    onChange: (value) => {
      const [sort, dir] = String(value || "date:desc").split(":");
      WorkerViews.eventsFilters.sort = sort || "date";
      WorkerViews.eventsFilters.dir = dir === "asc" ? "asc" : "desc";
      WorkerViews.eventsPage = 1;
      refreshEventsTable();
    },
  });
}

function renderEventsFeed(rows, filters = WorkerViews.eventsFilters) {
  if (!rows.length) {
    return `<div class="events-empty">${WorkerFormat.escapeHtml(WorkerI18n.t("dashboard.noEvents"))}</div>`;
  }

  return `
    <div class="events-feed" id="eventsTable">
      ${rows
        .map((row, index) => {
          const badgeClass = WorkerFormat.statusBadgeClass(row.status);
          const status = WorkerFormat.statusLabel(row.status);
          const typeLabel =
            row.eventType === "mafile"
              ? WorkerI18n.t("table.typeMafile")
              : WorkerI18n.t("table.typeLog");
          const account = eventAccountLabel(row);
          const typeClass = row.eventType === "mafile" ? "is-mafile" : "is-log";

          return `
            <button type="button" class="event-row ${typeClass}" data-event-id="${WorkerFormat.escapeHtml(
              String(row.id || "")
            )}" data-event-index="${index}">
              <span class="event-row-accent" aria-hidden="true"></span>
              <span class="event-row-body">
                <span class="event-row-top">
                  <span class="badge type">${WorkerFormat.escapeHtml(typeLabel)}</span>
                  <span class="event-row-account">${WorkerFormat.escapeHtml(account || "—")}</span>
                  <span class="event-row-price">${WorkerFormat.escapeHtml(
                    WorkerFormat.money(row.priceUsd || 0)
                  )}</span>
                </span>
                <span class="event-row-meta">
                  <span>${WorkerFormat.escapeHtml(WorkerFormat.date(row.createdAt))}</span>
                  <span class="event-row-id">#${WorkerFormat.escapeHtml(String(row.id || ""))}</span>
                  <span class="badge ${badgeClass}">${WorkerFormat.escapeHtml(status)}</span>
                  ${row.accountTag ? `<span class="event-row-tag" title="${WorkerFormat.escapeHtml(row.accountTag)}"><span aria-hidden="true">#</span>${WorkerFormat.escapeHtml(row.accountTag)}</span>` : ""}
                </span>
              </span>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderEventsPagination(meta) {
  if (!meta || meta.totalPages <= 1) return "";

  const prevDisabled = meta.page <= 1 ? " disabled" : "";
  const nextDisabled = meta.page >= meta.totalPages ? " disabled" : "";
  const pageInfo = WorkerI18n.t("dashboard.pageInfo", {
    page: meta.page,
    total: meta.totalPages,
  });

  return `
    <nav class="events-pagination" aria-label="${WorkerFormat.escapeHtml(
      WorkerI18n.t("dashboard.pagination") || "Страницы событий"
    )}">
      <button type="button" class="events-page-btn events-page-btn-prev" data-page-action="prev"${prevDisabled}>
        <span aria-hidden="true">←</span>
        <span>${WorkerFormat.escapeHtml(WorkerI18n.t("dashboard.pagePrev") || "Назад")}</span>
      </button>
      <span class="events-page-info">${WorkerFormat.escapeHtml(pageInfo)}</span>
      <button type="button" class="events-page-btn events-page-btn-next" data-page-action="next"${nextDisabled}>
        <span>${WorkerFormat.escapeHtml(WorkerI18n.t("dashboard.pageNext") || "Далее")}</span>
        <span aria-hidden="true">→</span>
      </button>
    </nav>
  `;
}

function renderEventsTable(rows, filters = WorkerViews.eventsFilters) {
  return renderEventsFeed(rows, filters);
}

function refreshEventsTable() {
  const wrap = document.getElementById("eventsTableWrap");
  if (!wrap) return;
  const sorted = applyEventsSort(WorkerViews.eventsCache, WorkerViews.eventsFilters);
  const paged = paginateEvents(sorted, WorkerViews.eventsPage);
  WorkerViews.eventsPage = paged.page;
  wrap.innerHTML =
    renderEventsFeed(paged.rows, WorkerViews.eventsFilters) +
    renderEventsPagination(paged);
  bindEventsFeedRows();
  bindEventsPagination();
}

function bindEventsPagination() {
  const wrap = document.getElementById("eventsTableWrap");
  if (!wrap) return;

  wrap.querySelectorAll("[data-page-action]").forEach((btn) => {
    if (btn.dataset.pageBound === "1") return;
    btn.dataset.pageBound = "1";
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      const action = btn.dataset.pageAction;
      if (action === "prev") {
        WorkerViews.eventsPage = Math.max(1, WorkerViews.eventsPage - 1);
      } else if (action === "next") {
        WorkerViews.eventsPage += 1;
      }
      refreshEventsTable();
    });
  });
}

function findEventById(id) {
  const key = String(id || "").trim();
  if (!key) return null;
  const cache = WorkerViews.eventsCache || [];
  return (
    cache.find((row) => String(row.id || "").trim() === key) ||
    cache.find((row) => String(row.sourceId || "").trim() === key) ||
    null
  );
}

function findEventFromButton(btn) {
  if (!btn) return null;
  const id = String(btn.dataset.eventId || "").trim();
  const byId = findEventById(id);
  if (byId) return byId;
  const index = Number(btn.dataset.eventIndex);
  if (Number.isFinite(index) && index >= 0) {
    const sorted = applyEventsSort(WorkerViews.eventsCache, WorkerViews.eventsFilters);
    if (sorted[index]) return sorted[index];
  }
  if (!id) return null;
  return {
    id,
    eventType: btn.classList.contains("is-mafile") ? "mafile" : "log",
    username: btn.querySelector(".event-row-account")?.textContent?.trim() || "",
  };
}

function canSellEvent(row) {
  if (!row || row.eventType !== "log") return false;
  const status = normalizeEventStatus(row.status);
  const saleStatus = String(row.saleStatus || "none");
  return status === "valid" && !["pending", "done"].includes(saleStatus);
}

function canProcessEvent(row) {
  if (!row || row.eventType !== "mafile") return false;
  const status = normalizeEventStatus(row.status);
  const processStatus = String(row.processStatus || "none");
  return status === "mafile" && !["pending", "done"].includes(processStatus);
}

function requestStatusLabel(kind, status) {
  const value = String(status || "none");
  if (value === "pending") {
    return kind === "sell"
      ? WorkerI18n.t("dashboard.salePending") || "Заявка на продажу отправлена"
      : WorkerI18n.t("dashboard.processPending") || "Заявка на отработку отправлена";
  }
  if (value === "done") {
    return kind === "sell"
      ? WorkerI18n.t("dashboard.saleDone") || "Продано"
      : WorkerI18n.t("dashboard.processDone") || "Отработано";
  }
  return "";
}

function ensureEventCardDrawer() {
  document.getElementById("eventCardDialog")?.remove();

  let drawer = document.getElementById("eventCardDrawer");
  const requiredIds = [
    "eventCardSheet",
    "eventCardTitle",
    "eventCardClose",
    "eventCardInventory",
    "eventCardInvTabs",
    "eventCardInvItems",
    "eventCardInvMeta",
  ];
  if (
    drawer &&
    (!requiredIds.every((id) => drawer.querySelector(`#${id}`)) ||
      drawer.querySelector("#eventCardSheet")?.classList.contains("sites-dialog"))
  ) {
    drawer.remove();
    drawer = null;
  }
  if (drawer && drawer.parentElement !== document.body) {
    document.body.appendChild(drawer);
  }
  if (!drawer) {
    drawer = document.createElement("div");
    drawer.id = "eventCardDrawer";
    drawer.className = "event-card-drawer";
    drawer.hidden = true;
    drawer.innerHTML = `
      <div class="event-card-drawer-backdrop" id="eventCardBackdrop"></div>
      <aside class="event-card-drawer-sheet event-card-dialog" id="eventCardSheet" role="dialog" aria-modal="true" aria-labelledby="eventCardTitle">
        <button type="button" class="event-card-close" id="eventCardClose" aria-label="Закрыть">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
        </button>
        <div class="event-card-body">
          <div class="event-card-scroll">
            <header class="event-card-hero">
              <div class="event-card-kind" aria-hidden="true">
                <svg class="event-card-kind-log" viewBox="0 0 24 24" fill="none"><path d="M7.5 3.5h6L18 8v12.5H7.5A1.5 1.5 0 0 1 6 19V5a1.5 1.5 0 0 1 1.5-1.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M13.5 3.5V8H18M9.5 12h5M9.5 15h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                <svg class="event-card-kind-mafile" viewBox="0 0 24 24" fill="none"><path d="M12 3.5 19 7v5c0 4.2-2.5 7-7 8.5C7.5 19 5 16.2 5 12V7l7-3.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="m9 12 2 2 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </div>
              <div class="event-card-head-text">
                <div class="event-card-eyebrow" id="eventCardEyebrow"></div>
                <h3 class="sites-dialog-title" id="eventCardTitle"></h3>
                <p class="muted sites-dialog-sub" id="eventCardSubtitle"></p>
              </div>
              <div class="event-card-badges">
                <span class="badge" id="eventCardStatusBadge"></span>
                <span class="badge badge-vac" id="eventCardVacBadge" hidden></span>
              </div>
            </header>

            <div class="event-card-admin-tag" id="eventCardTag" hidden>
              <span class="event-card-admin-tag-icon" aria-hidden="true">#</span>
              <span><small>Метка администратора</small><strong id="eventCardTagText"></strong></span>
            </div>

            <div class="event-money-grid" id="eventCardMoney"></div>
            <dl class="event-detail-grid" id="eventCardDetails"></dl>

            <section class="event-inv-panel" id="eventCardInventory" hidden>
              <div class="event-inv-head">
                <div>
                  <div class="event-block-title">${WorkerFormat.escapeHtml(WorkerI18n.t("dashboard.inventory") || "Инвентарь")}</div>
                  <div class="event-inv-meta muted" id="eventCardInvMeta"></div>
                </div>
              </div>
              <div class="event-inv-tabs" id="eventCardInvTabs" role="tablist"></div>
              <div class="event-inv-items" id="eventCardInvItems"></div>
            </section>

            <div class="inline-alert" id="eventCardError" style="display:none;"></div>
          </div>

          <div class="event-card-sticky">
            <div class="event-card-tools" id="eventCardTools">
              <button type="button" class="event-tool-btn" id="eventCardRefresh"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M19 8.5A7.5 7.5 0 1 0 20 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M19 4.5v4h-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span></span></button>
              <button type="button" class="event-tool-btn" id="eventCardCheckValid"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3.5 19 7v5c0 4.2-2.5 7-7 8.5C7.5 19 5 16.2 5 12V7l7-3.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="m9 12 2 2 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span></span></button>
              <a class="event-tool-btn" id="eventCardSteam" hidden target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.5"/><circle cx="15.7" cy="8.4" r="2.3" stroke="currentColor" stroke-width="1.5"/><path d="m7.4 14.4 3.7 1.6a2.3 2.3 0 1 0 1.8-4.2l-1.2-.5 2-1.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span></span></a>
            </div>

            <div class="event-card-footer">
              <div class="event-card-action-state" id="eventCardHint"></div>
              <button type="button" class="event-primary-action" id="eventCardAction" hidden><span></span><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14M14 7l5 5-5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
            </div>
          </div>
        </div>
      </aside>
    `;
    document.body.appendChild(drawer);
    drawer.querySelector("#eventCardBackdrop")?.addEventListener("click", closeEventCard);
    drawer.querySelector("#eventCardClose")?.addEventListener("click", closeEventCard);
  }
  return drawer;
}

function eventCardRoot() {
  const drawer = ensureEventCardDrawer();
  return drawer.querySelector("#eventCardSheet") || drawer;
}

function closeEventCard() {
  const drawer = document.getElementById("eventCardDrawer");
  if (!drawer) return;
  WorkerDropdown.close();
  WorkerViews.eventCardActiveKey = "";
  WorkerViews.eventCardDetail = null;
  drawer.classList.remove("is-open");
  document.body.classList.remove("event-card-open");
  window.setTimeout(() => {
    if (!drawer.classList.contains("is-open")) drawer.hidden = true;
  }, 220);
}

function renderVacDetailValue(vac) {
  if (!vac) return "";
  if (Array.isArray(vac.games) && vac.games.length) {
    return `<span class="badge badge-vac">${WorkerFormat.escapeHtml(vac.games.join(", "))}</span>`;
  }
  const count = Number(vac.count) || 1;
  return `<span class="badge badge-vac">${WorkerFormat.escapeHtml(
    WorkerI18n.t("dashboard.vacCount", { count }) || `VAC ×${count}`
  )}</span>`;
}

function renderVacBadgeLabel(vac) {
  if (!vac) return "";
  const count = Number(vac.count) || 1;
  return count > 1
    ? WorkerI18n.t("dashboard.vacShortCount", { count }) || `VAC ×${count}`
    : WorkerI18n.t("dashboard.vacShort") || "VAC";
}

function renderEventDetailItem(label, value) {
  return `
    <div class="event-detail-item">
      <dt>${WorkerFormat.escapeHtml(label)}</dt>
      <dd>${value}</dd>
    </div>
  `;
}

function renderEventMoney(detail) {
  return `
    <div class="event-money-card is-total">
      <div class="event-money-label">${WorkerFormat.escapeHtml(WorkerI18n.t("dashboard.totalValue") || "Итого")}</div>
      <div class="event-money-value">${WorkerFormat.escapeHtml(WorkerFormat.money(detail.priceUsd || 0))}</div>
      <div class="event-money-caption">Общая стоимость аккаунта</div>
    </div>
    <div class="event-money-split">
      <div class="event-money-card">
        <div class="event-money-label">${WorkerFormat.escapeHtml(WorkerI18n.t("dashboard.balance") || "Баланс")}</div>
        <div class="event-money-value">${WorkerFormat.escapeHtml(WorkerFormat.money(detail.balanceUsd || 0))}</div>
      </div>
      <div class="event-money-card">
        <div class="event-money-label">${WorkerFormat.escapeHtml(WorkerI18n.t("dashboard.inventory") || "Инвентарь")}</div>
        <div class="event-money-value">${WorkerFormat.escapeHtml(WorkerFormat.money(detail.inventoryUsd || 0))}</div>
      </div>
    </div>
  `;
}

function inventoryTabKey(entry) {
  if (!entry) return "other";
  if (entry.appid) return String(entry.appid);
  if (entry.key) return String(entry.key);
  return String(entry.name || "other");
}

function shortGameLabel(name) {
  const raw = String(name || "").trim();
  if (!raw) return "Steam";
  if (/counter.?strike/i.test(raw)) return "CS:2";
  if (/pubg|playerunknown/i.test(raw)) return "PUBG";
  if (/^dota/i.test(raw)) return "Dota 2";
  if (/^rust$/i.test(raw)) return "RUST";
  if (/team fortress/i.test(raw)) return "TF2";
  return raw.length > 14 ? `${raw.slice(0, 13)}…` : raw;
}

function buildInventoryTabs(row) {
  const byApp = row?.inventoryByAppid && typeof row.inventoryByAppid === "object" ? row.inventoryByAppid : {};
  const games = Array.isArray(row?.games) ? row.games : [];
  const tabs = [];
  const seen = new Set();

  const pushTab = (raw, { requireItems = false } = {}) => {
    const appid = Number(raw?.appid) || 0;
    const items = Array.isArray(raw?.items) ? raw.items : [];
    const itemCount = Number(raw?.itemCount) || items.length || 0;
    const totalUsd = Number(raw?.totalUsd || raw?.inventoryUsd) || 0;
    if (requireItems && itemCount <= 0 && totalUsd <= 0 && !items.length) return;

    const key = inventoryTabKey({ appid, name: raw?.name, key: raw?.key });
    if (seen.has(key)) {
      const existing = tabs.find((tab) => tab.key === key);
      if (existing) {
        existing.itemCount = Math.max(existing.itemCount, itemCount);
        existing.totalUsd = Math.max(existing.totalUsd, totalUsd);
        if ((!existing.items || !existing.items.length) && items.length) existing.items = items;
        if (raw?.name && (!existing.name || /^App\s+\d+$/i.test(existing.name))) existing.name = raw.name;
      }
      return;
    }
    seen.add(key);
    tabs.push({
      key,
      appid,
      name: String(raw?.name || (appid ? `App ${appid}` : "Steam")),
      itemCount,
      totalUsd,
      items,
      vac: Boolean(raw?.vac),
    });
  };

  for (const [key, group] of Object.entries(byApp)) {
    pushTab({ ...group, key });
  }
  for (const game of games) {
    const appid = Number(game?.appid) || 0;
    const match = (appid && byApp[String(appid)]) || null;
    pushTab(
      {
        appid,
        name: game?.name,
        itemCount: match?.itemCount || game?.itemCount || 0,
        totalUsd: match?.totalUsd || game?.inventoryUsd || 0,
        items: match?.items || [],
        vac: game?.vac,
        key: appid || game?.name,
      },
      { requireItems: Object.keys(byApp).length > 0 }
    );
  }

  if (!tabs.length && games.length) {
    games.slice(0, 8).forEach((game) => pushTab(game));
  }

  tabs.sort((a, b) => {
    if (a.totalUsd !== b.totalUsd) return b.totalUsd - a.totalUsd;
    if (a.itemCount !== b.itemCount) return b.itemCount - a.itemCount;
    return String(a.name).localeCompare(String(b.name));
  });
  return tabs;
}

function itemsForTab(tab, row) {
  if (tab?.items?.length) return tab.items;
  const byApp = row?.inventoryByAppid && typeof row.inventoryByAppid === "object" ? row.inventoryByAppid : {};
  if (tab?.appid && byApp[String(tab.appid)]?.items?.length) return byApp[String(tab.appid)].items;
  if (tab?.key && byApp[String(tab.key)]?.items?.length) return byApp[String(tab.key)].items;
  return [];
}

function renderInventoryItemCard(item) {
  const amount = Math.max(1, Number(item?.amount || 1) || 1);
  const icon = item?.iconUrl
    ? `<img class="event-inv-item-icon" src="${WorkerFormat.escapeHtml(item.iconUrl)}" alt="" loading="lazy" data-event-media />`
    : "";
  const amountBadge =
    amount > 1
      ? `<span class="event-inv-item-amount">×${WorkerFormat.escapeHtml(String(amount))}</span>`
      : "";
  return `
    <article class="event-inv-item">
      <span class="event-inv-item-thumb">
        <span class="event-inv-item-fallback" aria-hidden="true"></span>
        ${icon}
        ${amountBadge}
      </span>
      <span class="event-inv-item-copy">
        <span class="event-inv-item-name">${WorkerFormat.escapeHtml(item?.name || "Item")}</span>
        <span class="event-inv-item-price">${WorkerFormat.escapeHtml(WorkerFormat.money(item?.priceUsd || 0))}</span>
      </span>
    </article>
  `;
}

function renderInventoryItems(items) {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) {
    return `<div class="event-empty">${WorkerFormat.escapeHtml(
      WorkerI18n.t("dashboard.noGameItems") || "Нет предметов в этой игре"
    )}</div>`;
  }
  return `<div class="event-inv-grid">${rows.map(renderInventoryItemCard).join("")}</div>`;
}

function renderInventoryTabs(tabs, activeKey) {
  if (!tabs.length) return "";
  return tabs
    .map((tab) => {
      const active = tab.key === activeKey ? " is-active" : "";
      const vac = tab.vac ? " has-vac" : "";
      const count = Number(tab.itemCount) || 0;
      const sum = Number(tab.totalUsd) || 0;
      const label = shortGameLabel(tab.name);
      const meta = count
        ? `(${count}) ${WorkerFormat.money(sum)}`
        : WorkerFormat.money(sum);
      return `
        <button type="button" class="event-inv-tab${active}${vac}" role="tab" aria-selected="${
          tab.key === activeKey ? "true" : "false"
        }" data-inv-key="${WorkerFormat.escapeHtml(tab.key)}" title="${WorkerFormat.escapeHtml(tab.name)}">
          <span class="event-inv-tab-name">${WorkerFormat.escapeHtml(label)}</span>
          <span class="event-inv-tab-meta">${WorkerFormat.escapeHtml(meta)}</span>
        </button>`;
    })
    .join("");
}

function pickDefaultInventoryKey(tabs) {
  if (!tabs.length) return "";
  const withItems = tabs.find((tab) => (tab.itemCount || 0) > 0 || (tab.items || []).length);
  return (withItems || tabs[0]).key;
}

function fillInventoryPanel(row) {
  const panel = document.getElementById("eventCardInventory");
  const tabsEl = document.getElementById("eventCardInvTabs");
  const itemsEl = document.getElementById("eventCardInvItems");
  const metaEl = document.getElementById("eventCardInvMeta");
  if (!panel || !tabsEl || !itemsEl) return;

  const tabs = buildInventoryTabs(row);
  WorkerViews.eventCardDetail = row;
  if (!tabs.length) {
    panel.hidden = true;
    tabsEl.innerHTML = "";
    itemsEl.innerHTML = "";
    if (metaEl) metaEl.textContent = "";
    return;
  }

  panel.hidden = false;
  let activeKey = WorkerViews.eventCardActiveKey;
  if (!tabs.some((tab) => tab.key === activeKey)) {
    activeKey = pickDefaultInventoryKey(tabs);
  }
  WorkerViews.eventCardActiveKey = activeKey;
  const active = tabs.find((tab) => tab.key === activeKey) || tabs[0];
  const items = itemsForTab(active, row);
  const totalItems = tabs.reduce((sum, tab) => sum + (Number(tab.itemCount) || (tab.items || []).length || 0), 0);
  const totalUsd = tabs.reduce((sum, tab) => sum + (Number(tab.totalUsd) || 0), 0);

  if (metaEl) {
    metaEl.textContent =
      WorkerI18n.t("dashboard.inventorySummary", {
        count: totalItems,
        total: WorkerFormat.money(totalUsd || row.inventoryUsd || 0),
      }) || `${totalItems} предметов · ${WorkerFormat.money(totalUsd || row.inventoryUsd || 0)}`;
  }

  tabsEl.innerHTML = renderInventoryTabs(tabs, active.key);
  itemsEl.innerHTML = renderInventoryItems(items);
  bindInventoryTabs(row);
  bindEventMediaFallbacks(panel);
}

function bindInventoryTabs(row) {
  const tabsEl = document.getElementById("eventCardInvTabs");
  if (!tabsEl) return;
  tabsEl.querySelectorAll("[data-inv-key]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      WorkerViews.eventCardActiveKey = String(btn.dataset.invKey || "");
      fillInventoryPanel(WorkerViews.eventCardDetail || row);
    });
  });
}

function bindEventMediaFallbacks(root) {
  if (!root) return;
  root.querySelectorAll("img[data-event-media]").forEach((img) => {
    const fail = () => img.classList.add("is-failed");
    img.addEventListener("error", fail, { once: true });
    if (img.complete && img.naturalWidth === 0) fail();
  });
}

function mergeEventCache(detail) {
  if (!detail?.id) return detail;
  const cached = findEventById(detail.id);
  if (cached) {
    Object.assign(cached, {
      username: detail.username || cached.username,
      status: detail.status || cached.status,
      steamId: detail.steamId || cached.steamId,
      priceUsd: detail.priceUsd ?? cached.priceUsd,
      balanceUsd: detail.balanceUsd,
      inventoryUsd: detail.inventoryUsd,
      saleStatus: detail.saleStatus || cached.saleStatus,
      processStatus: detail.processStatus || cached.processStatus,
      eventType: detail.eventType || cached.eventType,
      gamesCount: detail.gamesCount ?? cached.gamesCount,
      games: detail.games || cached.games,
      topItems: detail.topItems || cached.topItems,
      inventoryBreakdown: detail.inventoryBreakdown || cached.inventoryBreakdown,
      inventoryByAppid: detail.inventoryByAppid || cached.inventoryByAppid,
      steamProfileUrl: detail.steamProfileUrl || cached.steamProfileUrl,
      level: detail.level ?? cached.level,
      country: detail.country || cached.country,
      lastPlayed: detail.lastPlayed || cached.lastPlayed,
      vac: detail.vac ?? cached.vac,
      accountTag: detail.accountTag ?? cached.accountTag,
    });
    return cached;
  }
  WorkerViews.eventsCache.unshift(detail);
  return detail;
}

async function openEventCard(row) {
  if (!row) return;
  let drawer;
  try {
    drawer = ensureEventCardDrawer();
    drawer.dataset.eventId = String(row.id || "");
    WorkerViews.eventCardActiveKey = "";
    fillEventCard(row, { loading: true });
    drawer.hidden = false;
    WorkerDropdown.close();
    requestAnimationFrame(() => {
      drawer.classList.add("is-open");
      document.body.classList.add("event-card-open");
    });
  } catch (error) {
    if (window.WorkerToast) WorkerToast.error(error);
    return;
  }

  const onKeyDown = (e) => {
    if (e.key === "Escape") closeEventCard();
  };
  document.addEventListener("keydown", onKeyDown, { once: true });

  if (!row.id) {
    fillEventCard(row, { loading: false });
    return;
  }

  try {
    const detail = await WorkerAPI.get(`/logs/${encodeURIComponent(String(row.id))}`, {
      force: true,
    });
    const merged = mergeEventCache({ ...row, ...detail });
    fillEventCard(merged, { loading: false });
    refreshEventsTable();
  } catch (error) {
    fillEventCard(row, { loading: false });
    if (window.WorkerToast) WorkerToast.error(error);
  }
}

function fillEventCard(row, { loading = false, error = "" } = {}) {
  const root = eventCardRoot();
  const $ = (id) => root.querySelector(`#${id}`);
  const typeLabel =
    row.eventType === "mafile"
      ? WorkerI18n.t("table.typeMafile")
      : WorkerI18n.t("table.typeLog");
  const badgeClass = WorkerFormat.statusBadgeClass(row.status);
  const status = WorkerFormat.statusLabel(row.status);
  const account = eventAccountLabel(row);
  const canSell = canSellEvent(row);
  const canProcess = canProcessEvent(row);
  const saleStatus = String(row.saleStatus || "none");
  const processStatus = String(row.processStatus || "none");
  const breakdown = row.inventoryBreakdown && typeof row.inventoryBreakdown === "object" ? row.inventoryBreakdown : {};
  root.dataset.eventKind = row.eventType === "mafile" ? "mafile" : "log";

  const eyebrowEl = $("eventCardEyebrow");
  if (eyebrowEl) {
    eyebrowEl.textContent = `${typeLabel} · #${String(row.id || "—")}`;
  }

  const titleEl = $("eventCardTitle");
  if (titleEl) {
    titleEl.textContent = row.username || row.steamId || "Steam аккаунт";
  }
  const subtitleEl = $("eventCardSubtitle");
  if (subtitleEl) {
    subtitleEl.textContent = loading
      ? WorkerI18n.t("common.loading")
      : [row.steamId ? `Steam ID ${row.steamId}` : "", WorkerFormat.date(row.createdAt)]
          .filter(Boolean)
          .join(" · ");
  }

  const tagEl = $("eventCardTag");
  const tagTextEl = $("eventCardTagText");
  if (tagEl && tagTextEl) {
    const tag = String(row.accountTag || "").trim();
    tagEl.hidden = !tag;
    tagTextEl.textContent = tag;
  }

  const statusBadge = $("eventCardStatusBadge");
  if (statusBadge) {
    statusBadge.className = `badge ${badgeClass}`;
    statusBadge.textContent = status;
  }

  const vacBadge = $("eventCardVacBadge");
  if (vacBadge) {
    if (row.vac) {
      vacBadge.hidden = false;
      vacBadge.textContent = renderVacBadgeLabel(row.vac);
    } else {
      vacBadge.hidden = true;
      vacBadge.textContent = "";
    }
  }

  const moneyEl = $("eventCardMoney");
  if (moneyEl) moneyEl.innerHTML = renderEventMoney(row);

  const detailsEl = $("eventCardDetails");
  if (detailsEl) {
    detailsEl.innerHTML = [
      renderEventDetailItem(WorkerI18n.t("table.id"), `<code>${WorkerFormat.escapeHtml(String(row.id || "—"))}</code>`),
      renderEventDetailItem(
        WorkerI18n.t("table.type"),
        `<span class="badge type">${WorkerFormat.escapeHtml(typeLabel)}</span>`
      ),
      renderEventDetailItem(
        WorkerI18n.t("table.account") || "Login",
        `<strong>${WorkerFormat.escapeHtml(account || "—")}</strong>`
      ),
      row.steamId
        ? renderEventDetailItem("Steam ID", `<code>${WorkerFormat.escapeHtml(String(row.steamId))}</code>`)
        : "",
      row.level != null
        ? renderEventDetailItem("LVL", WorkerFormat.escapeHtml(String(row.level)))
        : "",
      row.country
        ? renderEventDetailItem(
            WorkerI18n.t("dashboard.country") || "Страна",
            WorkerFormat.escapeHtml(String(row.country))
          )
        : "",
      row.lastPlayed
        ? renderEventDetailItem(
            WorkerI18n.t("dashboard.lastPlayed") || "Последний вход",
            WorkerFormat.escapeHtml(WorkerFormat.date(row.lastPlayed) || String(row.lastPlayed))
          )
        : "",
      row.gamesCount
        ? renderEventDetailItem(
            WorkerI18n.t("dashboard.gamesCount") || "Игры",
            WorkerFormat.escapeHtml(String(row.gamesCount))
          )
        : "",
      breakdown.tradable > 0
        ? renderEventDetailItem(
            WorkerI18n.t("dashboard.tradable") || "Tradable",
            WorkerFormat.escapeHtml(WorkerFormat.money(breakdown.tradable))
          )
        : "",
      breakdown.marketable > 0
        ? renderEventDetailItem(
            WorkerI18n.t("dashboard.marketable") || "Marketable",
            WorkerFormat.escapeHtml(WorkerFormat.money(breakdown.marketable))
          )
        : "",
      row.vac
        ? renderEventDetailItem(
            WorkerI18n.t("dashboard.vac") || "VAC",
            renderVacDetailValue(row.vac)
          )
        : "",
    ]
      .filter(Boolean)
      .join("");
  }

  fillInventoryPanel(row);
  bindEventMediaFallbacks(root);

  const errorEl = $("eventCardError");
  if (errorEl) {
    errorEl.style.display = error ? "" : "none";
    errorEl.textContent = error || "";
  }

  const hintEl = $("eventCardHint");
  if (hintEl) {
    hintEl.textContent =
      requestStatusLabel("sell", saleStatus) || requestStatusLabel("process", processStatus);
  }

  const refreshBtn = $("eventCardRefresh");
  if (refreshBtn) {
    refreshBtn.disabled = loading;
    const label = refreshBtn.querySelector("span");
    if (label) label.textContent = WorkerI18n.t("dashboard.actionRefresh") || "Обновить";
    refreshBtn.onclick = () => runEventCardRefresh(row);
  }

  const checkBtn = $("eventCardCheckValid");
  if (checkBtn) {
    checkBtn.disabled = loading;
    const label = checkBtn.querySelector("span");
    if (label) label.textContent = WorkerI18n.t("dashboard.actionCheckValid") || "Проверить на валид";
    checkBtn.onclick = () => runEventCardCheckValid(row);
  }

  const steamLink = $("eventCardSteam");
  if (steamLink) {
    if (row.steamProfileUrl || row.steamId) {
      steamLink.hidden = false;
      steamLink.href =
        row.steamProfileUrl || `https://steamcommunity.com/profiles/${row.steamId}`;
      const label = steamLink.querySelector("span");
      if (label) label.textContent = WorkerI18n.t("dashboard.actionSteam") || "Steam профиль";
    } else {
      steamLink.hidden = true;
    }
  }

  const actionBtn = $("eventCardAction");
  if (actionBtn) {
    actionBtn.hidden = true;
    actionBtn.disabled = loading;
    actionBtn.onclick = null;
    if (canSell) {
      actionBtn.hidden = false;
      const label = actionBtn.querySelector("span");
      if (label) label.textContent = WorkerI18n.t("dashboard.actionSell") || "Продать";
      actionBtn.onclick = () => runEventCardAction(row, "sell");
    } else if (canProcess) {
      actionBtn.hidden = false;
      const label = actionBtn.querySelector("span");
      if (label) label.textContent = WorkerI18n.t("dashboard.actionProcess") || "Отправить на отработку";
      actionBtn.onclick = () => runEventCardAction(row, "process");
    }
  }
}

async function runEventCardRefresh(row) {
  const refreshBtn = eventCardRoot().querySelector("#eventCardRefresh");
  if (refreshBtn) refreshBtn.disabled = true;
  try {
    const detail = await WorkerAPI.post(`/logs/${encodeURIComponent(String(row.id))}/refresh`);
    const merged = mergeEventCache({ ...row, ...detail });
    fillEventCard(merged);
    refreshEventsTable();
    if (window.WorkerToast) {
      WorkerToast.success(WorkerI18n.t("toast.refreshed") || "Данные обновлены");
    }
  } catch (error) {
    if (window.WorkerToast) WorkerToast.error(error);
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

async function runEventCardCheckValid(row) {
  const hintEl = eventCardRoot().querySelector("#eventCardHint");
  const checkBtn = eventCardRoot().querySelector("#eventCardCheckValid");
  if (checkBtn) checkBtn.disabled = true;
  try {
    const result = await WorkerAPI.post(
      `/logs/${encodeURIComponent(String(row.id))}/check-valid`
    );
    if (hintEl) {
      hintEl.textContent =
        WorkerI18n.t("dashboard.checkValidStarted", {
          id: result.taskId || "—",
        }) || `Проверка запущена${result.taskId ? ` · задача #${result.taskId}` : ""}`;
    }
    if (window.WorkerToast) {
      WorkerToast.success(WorkerI18n.t("toast.checkValid") || "Проверка на валид запущена");
    }
    setTimeout(async () => {
      try {
        const detail = await WorkerAPI.post(
          `/logs/${encodeURIComponent(String(row.id))}/refresh`
        );
        fillEventCard(mergeEventCache({ ...row, ...detail }));
        refreshEventsTable();
      } catch (_) {
        if (checkBtn) checkBtn.disabled = false;
      }
    }, 2500);
  } catch (error) {
    if (window.WorkerToast) WorkerToast.error(error);
    if (checkBtn) checkBtn.disabled = false;
  }
}

async function runEventCardAction(row, action) {
  const actionBtn = eventCardRoot().querySelector("#eventCardAction");
  const sourceId = encodeURIComponent(String(row.id || ""));

  if (actionBtn) actionBtn.disabled = true;

  try {
    const result =
      action === "sell"
        ? await WorkerAPI.post(`/logs/${sourceId}/sell`)
        : await WorkerAPI.post(`/logs/${sourceId}/process`);

    const cached = findEventById(row.id);
    if (cached) {
      if (action === "sell") cached.saleStatus = result.saleStatus || "pending";
      else cached.processStatus = result.processStatus || "pending";
    }

    fillEventCard(findEventById(row.id) || row);
    refreshEventsTable();
    if (window.WorkerToast) {
      WorkerToast.success(
        action === "sell"
          ? WorkerI18n.t("toast.sellSent") || "Заявка на продажу отправлена"
          : WorkerI18n.t("toast.processSent") || "Заявка на отработку отправлена"
      );
    }
  } catch (error) {
    if (window.WorkerToast) WorkerToast.error(error);
    if (actionBtn) actionBtn.disabled = false;
  }
}

function bindEventsFeedRows() {
  const wrap = document.getElementById("eventsTableWrap");
  if (wrap && wrap.dataset.eventsBound !== "1") {
    wrap.dataset.eventsBound = "1";
    wrap.addEventListener("click", (e) => {
      const btn = e.target.closest(".event-row, [data-event-id]");
      if (!btn || !wrap.contains(btn)) return;
      e.preventDefault();
      const row = findEventFromButton(btn);
      if (row) openEventCard(row);
    });
  }
  document.querySelectorAll("#eventsTable .event-row").forEach((btn) => {
    if (btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const row = findEventFromButton(btn);
      if (row) openEventCard(row);
    });
  });
}

function bindEventsTableRows() {
  bindEventsFeedRows();
}

function bindEventsTableSort() {
  /* sorting moved to dropdown */
}

WorkerViews.dashboard.refreshMoney = function refreshDashboardMoney() {
  document.querySelectorAll("[data-money]").forEach((el) => {
    el.textContent = WorkerFormat.money(el.dataset.money);
  });
  refreshEventsTable();
};

WorkerViews.openEventCard = openEventCard;
