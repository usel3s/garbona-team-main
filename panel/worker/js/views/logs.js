window.WorkerViews = window.WorkerViews || {};

WorkerViews.logsState = {
  q: "",
  status: "all",
  offset: 0,
  limit: 30,
  rows: [],
  loading: false,
  exhausted: false,
};

function mapApiLogToEvent(row) {
  const status = String(row.status || "");
  const isMafile = /mafile/i.test(status) || row.eventType === "mafile";
  return {
    ...row,
    eventType: isMafile ? "mafile" : row.eventType || "log",
    priceUsd: Number(row.priceUsd || 0),
  };
}

function filterLogsClient(rows, status) {
  if (status === "all") return rows;
  return rows.filter((row) => {
    const s = String(row.status || "").toLowerCase();
    if (status === "mafile") return row.eventType === "mafile" || /mafile/.test(s);
    if (status === "valid") return /валид|valid|ok/.test(s) && !/невалид|invalid|mafile/.test(s);
    if (status === "invalid") return /невалид|invalid/.test(s);
    return true;
  });
}

function renderLogsList(rows) {
  if (!rows.length) {
    return `<div class="panel-empty">${WorkerFormat.escapeHtml(WorkerI18n.t("logs.empty"))}</div>`;
  }
  return `
    <div class="logs-feed events-feed">
      ${rows
        .map((row) => {
          const typeLabel =
            row.eventType === "mafile"
              ? WorkerI18n.t("table.typeMafile")
              : WorkerI18n.t("table.typeLog");
          const badgeClass = WorkerFormat.statusBadgeClass(row.status);
          const account = row.username || row.steamId || "—";
          return `
            <button type="button" class="event-row is-${row.eventType === "mafile" ? "mafile" : "log"}" data-log-id="${WorkerFormat.escapeHtml(String(row.id))}">
              <span class="event-row-accent" aria-hidden="true"></span>
              <span class="event-row-body">
                <span class="event-row-top">
                  <span class="badge type">${WorkerFormat.escapeHtml(typeLabel)}</span>
                  <span class="event-row-account">${WorkerFormat.escapeHtml(account)}</span>
                  <span class="event-row-price">${WorkerFormat.escapeHtml(WorkerFormat.money(row.priceUsd || 0))}</span>
                </span>
                <span class="event-row-meta">
                  <span class="badge ${badgeClass}">${WorkerFormat.escapeHtml(WorkerFormat.statusLabel(row.status))}</span>
                  <span class="event-row-id">#${WorkerFormat.escapeHtml(String(row.id || ""))}</span>
                  <span class="muted">${WorkerFormat.escapeHtml(WorkerFormat.date(row.createdAt))}</span>
                  ${row.accountTag ? `<span class="event-row-tag" title="${WorkerFormat.escapeHtml(row.accountTag)}"><span aria-hidden="true">#</span>${WorkerFormat.escapeHtml(row.accountTag)}</span>` : ""}
                </span>
              </span>
            </button>`;
        })
        .join("")}
    </div>
  `;
}

async function loadLogsPage(reset = false) {
  const state = WorkerViews.logsState;
  if (state.loading) return;
  if (reset) {
    state.offset = 0;
    state.rows = [];
    state.exhausted = false;
  }
  if (state.exhausted && !reset) return;

  state.loading = true;
  const listEl = document.getElementById("logsList");
  const moreBtn = document.getElementById("logsLoadMore");
  if (moreBtn) moreBtn.disabled = true;
  if (reset && listEl) {
    listEl.innerHTML = `<div class="panel-empty">${WorkerFormat.escapeHtml(WorkerI18n.t("common.loading"))}</div>`;
  }

  try {
    const q = encodeURIComponent(state.q || "");
    const data = await WorkerAPI.get(
      `/logs?offset=${state.offset}&limit=${state.limit}&q=${q}`,
      { force: true }
    );
    const incoming = (data.logs || []).map(mapApiLogToEvent);
    state.rows = reset ? incoming : state.rows.concat(incoming);
    state.offset += incoming.length;
    if (incoming.length < state.limit) state.exhausted = true;

    const filtered = filterLogsClient(state.rows, state.status);
    if (listEl) listEl.innerHTML = renderLogsList(filtered);

    // Keep dashboard cache warm so event card works.
    WorkerViews.eventsCache = filtered.map((row) => ({ ...row }));
    bindLogsRows();

    const summary = document.getElementById("logsSummary");
    if (summary) {
      summary.textContent = WorkerI18n.t("logs.summary", {
        shown: filtered.length,
        total: data.summary?.totalLogs ?? state.rows.length,
      });
    }
  } catch (error) {
    if (window.WorkerToast) WorkerToast.error(error);
    if (listEl) {
      listEl.innerHTML = `<div class="panel-empty">${WorkerFormat.escapeHtml(
        WorkerToast?.friendlyError?.(error) || error.message || WorkerI18n.t("common.error")
      )}</div>`;
    }
  } finally {
    state.loading = false;
    if (moreBtn) {
      moreBtn.hidden = state.exhausted;
      moreBtn.disabled = false;
    }
  }
}

function bindLogsRows() {
  document.querySelectorAll("#logsList [data-log-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.logId;
      const row =
        (WorkerViews.eventsCache || []).find((r) => String(r.id) === String(id)) ||
        WorkerViews.logsState.rows.find((r) => String(r.id) === String(id));
      if (row && typeof WorkerViews.openEventCard === "function") {
        WorkerViews.openEventCard(row);
      }
    });
  });
}

WorkerViews.logs = async function renderLogs(ctx) {
  const { main } = ctx;
  const state = WorkerViews.logsState;

  main.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-greeting">${WorkerI18n.t("logs.pageTitle")}</h1>
        <p class="page-sub muted" id="logsSummary"></p>
      </div>
    </div>

    <div class="panel-toolbar">
      <label class="sites-search">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.5"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <input type="search" id="logsSearch" value="${WorkerFormat.escapeHtml(state.q)}" placeholder="${WorkerI18n.t("logs.searchPlaceholder")}" autocomplete="off" />
      </label>
      <div id="logsStatusFilter" class="custom-select-host sites-filter-select"></div>
      <button type="button" class="btn btn-ghost" id="logsRefresh">${WorkerI18n.t("common.refresh")}</button>
    </div>

    <section class="section section-flush">
      <div id="logsList"></div>
      <div class="panel-more">
        <button type="button" class="btn btn-ghost" id="logsLoadMore">${WorkerI18n.t("logs.loadMore")}</button>
      </div>
    </section>
  `;

  WorkerDropdown.mount(document.getElementById("logsStatusFilter"), {
    value: state.status,
    ariaLabel: WorkerI18n.t("logs.filterStatus"),
    options: [
      { value: "all", label: WorkerI18n.t("logs.filterAll") },
      { value: "valid", label: WorkerI18n.t("logs.filterValid") },
      { value: "mafile", label: WorkerI18n.t("logs.filterMafile") },
      { value: "invalid", label: WorkerI18n.t("logs.filterInvalid") },
    ],
    onChange: (value) => {
      state.status = value;
      const filtered = filterLogsClient(state.rows, state.status);
      WorkerViews.eventsCache = filtered.map((row) => ({ ...row }));
      document.getElementById("logsList").innerHTML = renderLogsList(filtered);
      bindLogsRows();
    },
  });

  let searchTimer = null;
  document.getElementById("logsSearch").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.q = e.target.value.trim();
      loadLogsPage(true);
    }, 280);
  });

  document.getElementById("logsRefresh").addEventListener("click", () => loadLogsPage(true));
  document.getElementById("logsLoadMore").addEventListener("click", () => loadLogsPage(false));

  await loadLogsPage(true);
};
