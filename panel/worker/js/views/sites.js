window.WorkerViews = window.WorkerViews || {};

WorkerViews.sitesState = {
  selectedId: null,
  filters: { q: "", status: "all" },
};

function showSitesError(error) {
  if (window.WorkerToast) {
    WorkerToast.error(error);
    return;
  }
  alert(error?.message || error || WorkerI18n.t("common.error"));
}

function ensureConfirmDialog() {
  let dialog = document.getElementById("sitesConfirmDialog");
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.id = "sitesConfirmDialog";
  dialog.className = "sites-dialog sites-confirm-dialog";
  dialog.innerHTML = `
    <form method="dialog" class="sites-dialog-body sites-confirm-body">
      <h3 class="sites-dialog-title" id="sitesConfirmTitle"></h3>
      <p class="muted sites-dialog-sub" id="sitesConfirmMessage"></p>
      <div class="sites-dialog-actions sites-confirm-actions">
        <button type="button" class="btn btn-ghost" id="sitesConfirmCancel" value="cancel"></button>
        <button type="submit" class="btn btn-danger" id="sitesConfirmOk" value="ok"></button>
      </div>
    </form>
  `;
  document.body.appendChild(dialog);
  return dialog;
}

function openConfirmDialog({ title, message, confirmLabel, cancelLabel } = {}) {
  const dialog = ensureConfirmDialog();
  const form = dialog.querySelector("form");
  const titleEl = dialog.querySelector("#sitesConfirmTitle");
  const messageEl = dialog.querySelector("#sitesConfirmMessage");
  const cancelBtn = dialog.querySelector("#sitesConfirmCancel");
  const okBtn = dialog.querySelector("#sitesConfirmOk");
  titleEl.textContent = title || WorkerI18n.t("sites.confirmTitle");
  messageEl.textContent = message || "";
  messageEl.hidden = !message;
  cancelBtn.textContent = cancelLabel || WorkerI18n.t("sites.cancel");
  okBtn.textContent = confirmLabel || WorkerI18n.t("sites.actionDelete");
  okBtn.disabled = false;
  cancelBtn.disabled = false;

  return new Promise((resolve) => {
    const finish = (value) => {
      dialog.removeEventListener("close", onClose);
      form.removeEventListener("submit", onSubmit);
      cancelBtn.removeEventListener("click", onCancel);
      if (dialog.open) dialog.close();
      resolve(value);
    };
    const onClose = () => finish(false);
    const onCancel = () => finish(false);
    const onSubmit = (event) => {
      event.preventDefault();
      finish(true);
    };
    dialog.addEventListener("close", onClose);
    form.addEventListener("submit", onSubmit);
    cancelBtn.addEventListener("click", onCancel);
    dialog.showModal();
    cancelBtn.focus();
  });
}

WorkerViews.sites = async function renderSites(ctx) {
  const { main } = ctx;
  if (WorkerViews.sitesState.selectedId) {
    await renderSiteDetail(main, WorkerViews.sitesState.selectedId, ctx);
    return;
  }
  await renderSitesList(main, ctx);
};

async function renderSitesList(main, ctx) {
  const force = !!ctx?.refresh;
  const data = await WorkerAPI.get("/sites/domains", { force });
  const domains = data.domains || [];
  const filters = WorkerViews.sitesState.filters;
  const activeCount = domains.filter((domain) => !domain.isPaused).length;
  const pausedCount = domains.length - activeCount;
  const linksCount = domains.reduce((sum, domain) => sum + Number(domain.linksCount || 0), 0);

  if (WorkerViews.sitesState._pollTimer) {
    clearInterval(WorkerViews.sitesState._pollTimer);
    WorkerViews.sitesState._pollTimer = null;
  }
  WorkerViews.sitesState._pollTimer = setInterval(() => {
    if (document.hidden || WorkerViews.sitesState.selectedId) return;
    if (window.WorkerShell?.currentView?.() !== "sites") return;
    renderSitesList(main, { ...ctx, refresh: true }).catch(() => {});
  }, 15000);

  main.innerHTML = `
    <div class="sites-page">
    <header class="sites-page-head">
      <div class="sites-page-heading">
        <h1 class="page-greeting">${WorkerI18n.t("sites.pageTitle")}</h1>
        <p class="sites-page-subtitle">${WorkerI18n.t("sites.pageSubtitle")}</p>
      </div>
      <button type="button" class="btn btn-primary sites-add-btn" id="sitesAddOpen">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        ${WorkerI18n.t("sites.addDomain")}
      </button>
    </header>
    <section class="sites-overview" aria-label="${WorkerI18n.t("sites.overviewLabel")}">
      ${renderSitesOverviewItem("all", WorkerI18n.t("sites.summaryAll"), domains.length)}
      ${renderSitesOverviewItem("active", WorkerI18n.t("sites.summaryActive"), activeCount)}
      ${renderSitesOverviewItem("paused", WorkerI18n.t("sites.summaryPaused"), pausedCount)}
      ${renderSitesOverviewItem("links", WorkerI18n.t("sites.summaryLinks"), linksCount)}
    </section>
    <section class="sites-list-section">
      <div class="sites-toolbar">
        <label class="sites-search">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.5"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          <input type="search" id="sitesSearch" value="${WorkerFormat.escapeHtml(filters.q)}" placeholder="${WorkerI18n.t("sites.searchPlaceholder")}" autocomplete="off" />
        </label>
        <div id="sitesStatusFilter" class="custom-select-host sites-filter-select"></div>
      </div>
      <div id="sitesGrid" class="sites-grid"></div>
    </section>
    <dialog class="sites-dialog" id="sitesAddDialog">
      <form method="dialog" class="sites-dialog-body sites-add-body" id="sitesAddForm">
        <h3 class="sites-dialog-title">${WorkerI18n.t("sites.addDomain")}</h3>
        <input class="input" id="sitesDomainInput" placeholder="example.com" autocomplete="off" />
        <div class="muted sites-dialog-hint" id="sitesDomainHint" hidden></div>
        <div class="sites-dialog-actions sites-add-actions">
          <button type="button" class="btn btn-ghost" id="sitesAddCancel">${WorkerI18n.t("sites.cancel")}</button>
          <button type="button" class="btn btn-ghost" id="sitesDomainCheck">${WorkerI18n.t("sites.check")}</button>
          <button type="submit" class="btn btn-primary" id="sitesDomainSubmit">${WorkerI18n.t("sites.add")}</button>
        </div>
      </form>
    </dialog>
    </div>
  `;

  WorkerDropdown.mount(document.getElementById("sitesStatusFilter"), {
    value: filters.status,
    ariaLabel: WorkerI18n.t("sites.filterStatus"),
    options: [
      { value: "all", label: WorkerI18n.t("sites.filterAll") },
      { value: "active", label: WorkerI18n.t("sites.filterActive") },
      { value: "paused", label: WorkerI18n.t("sites.filterPaused") },
      { value: "own", label: WorkerI18n.t("sites.filterOwn") },
      { value: "team", label: WorkerI18n.t("sites.filterTeam") },
    ],
    onChange: (value) => {
      WorkerViews.sitesState.filters.status = value;
      paintSitesGrid(domains);
    },
  });

  const searchEl = document.getElementById("sitesSearch");
  searchEl.addEventListener("input", () => {
    WorkerViews.sitesState.filters.q = searchEl.value.trim().toLowerCase();
    paintSitesGrid(domains);
  });

  const dialog = document.getElementById("sitesAddDialog");
  const setDomainHint = (text) => {
    const hint = document.getElementById("sitesDomainHint");
    if (!hint) return;
    const value = String(text || "").trim();
    hint.textContent = value;
    hint.hidden = !value;
  };
  document.getElementById("sitesAddOpen").addEventListener("click", () => {
    setDomainHint("");
    dialog.showModal();
  });
  document.getElementById("sitesAddCancel").addEventListener("click", () => dialog.close());
  document.getElementById("sitesDomainCheck").addEventListener("click", async () => {
    try {
      const preview = await WorkerAPI.post("/sites/domains/check", {
        domain: document.getElementById("sitesDomainInput").value.trim(),
      });
      if (preview.existing) {
        setDomainHint(preview.message || WorkerI18n.t("sites.domainExistsTeam"));
        return;
      }
      setDomainHint(WorkerI18n.t("sites.checkOk", { ip: preview.ip || "—" }));
    } catch (error) {
      setDomainHint(error.message || WorkerI18n.t("common.error"));
    }
  });
  document.getElementById("sitesAddForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const result = await WorkerAPI.post("/sites/domains", {
        domain: document.getElementById("sitesDomainInput").value.trim(),
      });
      dialog.close();
      WorkerAPI.bust("/sites/domains");
      if (result.existing) {
        WorkerToast?.info?.(WorkerI18n.t("sites.domainExistsOpen"));
      }
      WorkerViews.sitesState.selectedId = result.created?.id || null;
      if (WorkerViews.sitesState.selectedId) {
        await WorkerViews.sites({ ...ctx, refresh: true });
      } else {
        await renderSitesList(main, { ...ctx, refresh: true });
      }
    } catch (error) {
      setDomainHint(error.message || WorkerI18n.t("common.error"));
    }
  });

  function openDomain(domainId) {
    const id = Number(domainId);
    if (!Number.isFinite(id) || id <= 0) return;
    WorkerViews.sitesState.selectedId = id;
    WorkerViews.sites(ctx).catch((error) => {
      if (window.WorkerToast) WorkerToast.error(error);
    });
  }

  function paintSitesGrid(allDomains) {
    const grid = document.getElementById("sitesGrid");
    const filtered = filterDomains(allDomains, WorkerViews.sitesState.filters);
    if (!filtered.length) {
      grid.innerHTML = `<div class="sites-empty">${WorkerFormat.escapeHtml(WorkerI18n.t("sites.empty"))}</div>`;
      return;
    }
    grid.innerHTML = filtered.map((d) => renderDomainCard(d)).join("");
    grid.querySelectorAll(".site-card[data-domain-id]").forEach((card) => {
      const open = () => openDomain(card.dataset.domainId);
      card.addEventListener("click", (e) => {
        if (e.target.closest(".site-tool-check")) return;
        open();
      });
      card.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        open();
      });
    });
  }

  paintSitesGrid(domains);
}

function renderSitesOverviewItem(tone, label, value) {
  const icons = {
    all: '<svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5" width="17" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 9h17M7 7h.01M9.5 7h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    active: '<svg viewBox="0 0 24 24" fill="none"><path d="m7.5 12.5 3 3 6-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/></svg>',
    paused: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/><path d="M9.5 8.5v7M14.5 8.5v7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    links: SITE_STAT_ICONS.links,
  };
  return `
    <div class="sites-overview-item is-${tone}">
      <span class="sites-overview-icon" aria-hidden="true">${icons[tone]}</span>
      <span class="sites-overview-copy">
        <strong>${Number(value || 0)}</strong>
        <span>${WorkerFormat.escapeHtml(label)}</span>
      </span>
    </div>
  `;
}

function filterDomains(domains, filters) {
  const q = String(filters.q || "").trim().toLowerCase();
  return (domains || []).filter((d) => {
    if (q && !String(d.domain || "").toLowerCase().includes(q)) return false;
    if (filters.status === "active" && d.isPaused) return false;
    if (filters.status === "paused" && !d.isPaused) return false;
    if (filters.status === "own" && !d.isOwn) return false;
    if (filters.status === "team" && !d.isTeamPublic) return false;
    return true;
  });
}

function banStatusText(type, check) {
  if (!check) return WorkerI18n.t("sites.banUnknown");
  if (check.banned) {
    if (type === "google") return WorkerI18n.t("sites.banGoogleBad");
    if (type === "cloudflare") return WorkerI18n.t("sites.banCloudflareBad");
    return WorkerI18n.t("sites.banWhoisBad");
  }
  if (check.clean) {
    if (type === "google") return WorkerI18n.t("sites.banGoogleOk");
    if (type === "cloudflare") return WorkerI18n.t("sites.banCloudflareOk");
    return WorkerI18n.t("sites.banWhoisOk");
  }
  return WorkerI18n.t("sites.banUnknown");
}

function renderBanTooltip(type, banChecks) {
  const check = banChecks?.[type];
  const statusText = banStatusText(type, check);
  const checkedAt = WorkerFormat.checkDateTime(banChecks?.updatedAt);
  return `
    <div class="site-check-tip" role="tooltip">
      <div class="site-check-tip-row">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h2l2-5 4 10 2-5h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span class="site-check-tip-body">
          <span class="site-check-tip-label">${WorkerFormat.escapeHtml(WorkerI18n.t("sites.banStatus"))}</span>
          <span class="site-check-tip-value">${WorkerFormat.escapeHtml(statusText)}</span>
        </span>
      </div>
      <div class="site-check-tip-row">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M8 3v4M16 3v4M4 10h16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <span class="site-check-tip-body">
          <span class="site-check-tip-label">${WorkerFormat.escapeHtml(WorkerI18n.t("sites.banChecked"))}</span>
          <span class="site-check-tip-value">${WorkerFormat.escapeHtml(checkedAt)}</span>
        </span>
      </div>
    </div>
  `;
}

const SITE_STAT_ICONS = {
  views:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="2.8" stroke="currentColor" stroke-width="1.5"/></svg>',
  clicks:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 4.5v6.2M9 10.7 5.8 19.2a1 1 0 0 0 1.3 1.3L10.4 17l2.1 3.4a1 1 0 0 0 1.8-.3L17.2 8.2a1.2 1.2 0 0 0-1.5-1.5L9 10.7Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  auths:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3.5 19 7v5.2c0 4.2-2.8 7.1-7 8.3-4.2-1.2-7-4.1-7-8.3V7l7-3.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="m9.2 12 1.9 1.9 3.7-3.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  logs:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 3.5h6.2L17.5 8v11.5A1.5 1.5 0 0 1 16 21H7a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 7 3.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M13.2 3.5V8H17.5M9 12.2h6M9 15.4h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  online:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5.5 12a6.5 6.5 0 0 1 13 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M8.2 12a3.8 3.8 0 0 1 7.6 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/></svg>',
  links:
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M10 14a5 5 0 0 1 0-7l1-1a5 5 0 0 1 7 7l-1 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M14 10a5 5 0 0 1 0 7l-1 1a5 5 0 0 1-7-7l1-1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
};

function renderTrafficTip(source) {
  const stats = safeSiteStats(source);
  const countries = Array.isArray(source?.countries) ? source.countries : [];
  const devices = Array.isArray(source?.devices) ? source.devices : [];
  const desktopPercent =
    stats.desktopPercent != null && Number.isFinite(Number(stats.desktopPercent))
      ? Number(stats.desktopPercent)
      : null;
  const conversion =
    stats.views > 0 ? Math.min(999, (stats.auths / stats.views) * 100) : null;

  const countryHtml = countries.length
    ? countries
        .slice(0, 8)
        .map((row) => {
          const code = String(row.code || "").toUpperCase();
          const flag =
            code === "CIS" || code === "UN"
              ? "🌐"
              : /^[A-Z]{2}$/.test(code)
                ? String.fromCodePoint(...[...code].map((ch) => 127397 + ch.charCodeAt(0)))
                : "🌐";
          return `<span class="site-traffic-chip"><span class="site-traffic-flag">${flag}</span><strong>${Number(row.count || 0)}</strong></span>`;
        })
        .join("")
    : `<span class="muted">${WorkerFormat.escapeHtml(WorkerI18n.t("analytics.noBreakdown"))}</span>`;

  const deviceHtml = devices.length
    ? devices
        .slice(0, 4)
        .map(
          (row) =>
            `<span class="site-traffic-chip"><span class="site-traffic-device">${WorkerFormat.escapeHtml(row.name)}</span><strong>${Number(row.count || 0)}</strong></span>`
        )
        .join("")
    : "";

  return `
    <div class="site-traffic-tip" role="tooltip">
      <div class="site-traffic-tip-title">${WorkerFormat.escapeHtml(WorkerI18n.t("sites.trafficTitle"))}</div>
      <div class="site-traffic-tip-funnel">
        <span><small>${WorkerFormat.escapeHtml(WorkerI18n.t("sites.views"))}</small><strong>${stats.views}</strong></span>
        <span><small>${WorkerFormat.escapeHtml(WorkerI18n.t("sites.auths"))}</small><strong>${stats.auths}${conversion != null ? ` <em>${conversion < 10 && conversion > 0 ? conversion.toFixed(1) : Math.round(conversion)}%</em>` : ""}</strong></span>
        <span><small>${WorkerFormat.escapeHtml(WorkerI18n.t("sites.validLogs"))}</small><strong>${stats.logs}</strong></span>
        <span><small>MaFile</small><strong>${stats.mafiles}</strong></span>
      </div>
      <div class="site-traffic-tip-section">${countryHtml}</div>
      ${deviceHtml ? `<div class="site-traffic-tip-section">${deviceHtml}</div>` : ""}
      ${
        desktopPercent != null
          ? `<div class="site-traffic-tip-pc">${WorkerFormat.escapeHtml(WorkerI18n.t("sites.pcPercent"))}: <strong>${desktopPercent.toFixed(2)}%</strong></div>`
          : ""
      }
    </div>
  `;
}

function renderMiniStat(label, value, iconKey) {
  const icon = SITE_STAT_ICONS[iconKey] || SITE_STAT_ICONS.views;
  return `
    <div class="site-mini-stat">
      <span class="site-mini-stat-icon" aria-hidden="true">${icon}</span>
      <div class="site-mini-stat-body">
        <span class="site-mini-stat-val">${value}</span>
        <span class="site-mini-stat-lbl">${WorkerFormat.escapeHtml(label)}</span>
      </div>
    </div>
  `;
}

function safeSiteStats(source) {
  const stats = source && typeof source === "object" ? source.stats : null;
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) {
    return { views: 0, clicks: 0, auths: 0, logs: 0, mafiles: 0 };
  }
  return {
    views: Number(stats.views || 0),
    clicks: Number(stats.clicks || 0),
    auths: Number(stats.auths || 0),
    logs: Number(stats.logs || 0),
    mafiles: Number(stats.mafiles || 0),
  };
}

function pickDomainObject(detail) {
  if (!detail || typeof detail !== "object") return null;
  if (detail.domain && typeof detail.domain === "object") return detail.domain;
  if (detail.id != null && (detail.domain == null || typeof detail.domain === "string")) {
    return detail;
  }
  return null;
}

function renderDomainCard(domain) {
  if (!domain || typeof domain !== "object") return "";
  const stats = safeSiteStats(domain);
  const banChecks = domain.banChecks || {};
  const badges = [];
  if (domain.isPaused) {
    badges.push(`<span class="site-badge site-badge-paused">${WorkerI18n.t("sites.paused")}</span>`);
  } else {
    badges.push(`<span class="site-badge site-badge-active">${WorkerI18n.t("sites.filterActive")}</span>`);
  }
  if (domain.isOwn) badges.push(`<span class="site-badge site-badge-own">${WorkerI18n.t("sites.own")}</span>`);
  if (domain.isTeamPublic) {
    badges.push(`<span class="site-badge site-badge-team">${WorkerI18n.t("sites.team")}</span>`);
  }

  const hasLinks = Number(domain.linksCount || 0) > 0;
  const actionLabel = hasLinks ? WorkerI18n.t("sites.openLinks") : WorkerI18n.t("sites.createLink");
  const googleBanned = banChecks.google?.banned;
  const whoisBanned = banChecks.whois?.banned;
  const cfBanned = banChecks.cloudflare?.banned;

  return `
    <article class="site-card${domain.isPaused ? " is-paused" : ""}" data-domain-id="${domain.id}" tabindex="0" role="button">
      <div class="site-card-head">
        <div class="site-card-id">
          <div class="site-card-title-row">
            <span class="site-card-status${domain.isPaused ? " is-off" : " is-on"}" title="${domain.isPaused ? WorkerI18n.t("sites.paused") : WorkerI18n.t("sites.filterActive")}"></span>
            <h3 class="site-card-title" title="${WorkerFormat.escapeHtml(domain.domain)}">${WorkerFormat.escapeHtml(domain.domain)}</h3>
          </div>
          <span class="site-card-created">${WorkerI18n.t("sites.createdAt")}: ${WorkerFormat.escapeHtml(WorkerFormat.shortDayTime(domain.createdAt))}</span>
        </div>
        <div class="site-card-badges">${badges.join("")}</div>
      </div>
      <div class="site-health">
        <span class="site-health-label">${WorkerI18n.t("sites.healthLabel")}</span>
        <div class="site-card-tools">
          <button type="button" class="site-tool site-tool-check${whoisBanned ? " is-banned" : " is-ok"}" aria-label="Whois">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3.5 19.5 7v5.4c0 4.4-3 7.5-7.5 8.6-4.5-1.1-7.5-4.2-7.5-8.6V7L12 3.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 11v5M12 8.2h.01" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
            <span>Whois</span>
            ${renderBanTooltip("whois", banChecks)}
          </button>
          <button type="button" class="site-tool site-tool-check${cfBanned ? " is-banned" : " is-ok"}" aria-label="Cloudflare">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7.2 16.2h10.4c1.4 0 2.4-1 2.2-2.3-.3-1.8-1.9-3.1-3.8-3.1-.4 0-.8.1-1.2.2A4.4 4.4 0 0 0 10.6 8a4.5 4.5 0 0 0-4.3 3.3A3.3 3.3 0 0 0 4 14.4c0 1 .8 1.8 1.8 1.8h1.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>Cloudflare</span>
            ${renderBanTooltip("cloudflare", banChecks)}
          </button>
          <button type="button" class="site-tool site-tool-check site-tool-google${googleBanned ? " is-banned" : " is-ok"}" aria-label="Google">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12.2 11.2v2.7h4.3c-.2 1.2-1.5 3.5-4.3 3.5A4.9 4.9 0 1 1 12.2 7c1.3 0 2.5.5 3.4 1.3l2.3-2.2A8.2 8.2 0 1 0 12.2 20.2c4.7 0 7.8-3.3 7.8-8 0-.5 0-.9-.1-1.3h-7.7Z" fill="currentColor"/></svg>
            <span>Google</span>
            ${renderBanTooltip("google", banChecks)}
          </button>
        </div>
      </div>
      <div class="site-card-kpi site-card-kpi--traffic">
        ${renderMiniStat(WorkerI18n.t("sites.views"), stats.views || 0, "views")}
        ${renderMiniStat(WorkerI18n.t("sites.auths"), stats.auths || 0, "auths")}
        ${renderMiniStat(WorkerI18n.t("sites.validLogs"), stats.logs || 0, "logs")}
        ${renderMiniStat("MaFile", stats.mafiles || 0, "logs")}
        ${renderTrafficTip(domain)}
      </div>
      <div class="site-card-foot">
        <span class="site-card-links">
          ${SITE_STAT_ICONS.links}
          ${WorkerFormat.escapeHtml(WorkerI18n.t("sites.linksCount"))}: ${Number(domain.linksCount || 0)}
        </span>
        <button type="button" class="site-card-go" data-open-domain="${domain.id}">
          ${WorkerFormat.escapeHtml(actionLabel)}
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </article>
  `;
}

function windowTypeLabel(type) {
  const key = {
    FakeWindow: "sites.windowFakeWindow",
    CurrentWindow: "sites.windowCurrentWindow",
    NewWindow: "sites.windowNewWindow",
    AboutBlank: "sites.windowAboutBlank",
  }[type];
  return key ? WorkerI18n.t(key) : type || "—";
}

function renderDomainBadges(domain) {
  if (!domain || typeof domain !== "object") return "";
  const badges = [];
  if (domain.isPaused) {
    badges.push(`<span class="site-badge site-badge-paused">${WorkerI18n.t("sites.paused")}</span>`);
  }
  return badges.join("");
}

function linkDisplayUrl(link, domainName) {
  const raw = String(link?.url || link?.link || "").trim();
  if (raw) return raw.startsWith("http") ? raw : `https://${raw.replace(/^\/+/, "")}`;
  const path = String(link?.path || "").replace(/^\/+/, "");
  const host = String(domainName || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!host) return path ? `/${path}` : "—";
  return path ? `https://${host}/${path}` : `https://${host}/`;
}

function renderBindMeta(domain) {
  if (!domain || typeof domain !== "object") {
    return `<span class="site-bind-chip"><span class="muted">IP</span> —</span>`;
  }
  if (domain.bindType === "cloudflare" && (domain.bindNs || []).length) {
    return (domain.bindNs || [])
      .slice(0, 2)
      .map(
        (ns, i) =>
          `<span class="site-bind-chip"><span class="muted">NS${i + 1}</span> ${WorkerFormat.escapeHtml(ns)}</span>`
      )
      .join("");
  }
  return `<span class="site-bind-chip"><span class="muted">IP</span> ${WorkerFormat.escapeHtml(domain.ip || "—")}</span>`;
}

function renderSiteLinkRow(link, domainName) {
  if (!link || typeof link !== "object") return "";
  const url = linkDisplayUrl(link, domainName);
  const stats = safeSiteStats(link);
  const flags = [];
  if (link.isPaused) flags.push(`<span class="site-flag site-flag-warn">${WorkerI18n.t("sites.linkPaused")}</span>`);
  if (link.iframe) flags.push(`<span class="site-flag">${WorkerI18n.t("sites.badgeIframe")}</span>`);

  return `
    <tr data-link-id="${link.id}">
      <td>
        <a class="site-link-url" href="${WorkerFormat.escapeHtml(url || "#")}" target="_blank" rel="noopener noreferrer">${WorkerFormat.escapeHtml(url || "—")}</a>
        <div class="site-link-sub muted">${WorkerFormat.escapeHtml(link.templateName || link.template || "—")}${link.id ? ` · #${link.id}` : ""}</div>
        ${flags.length ? `<div class="site-link-flags">${flags.join("")}</div>` : ""}
      </td>
      <td class="muted">${WorkerFormat.escapeHtml(windowTypeLabel(link.windowType))}</td>
      <td class="td-num">${stats.views || 0}</td>
      <td class="td-num">${stats.auths || 0}</td>
      <td class="td-num">${stats.logs || 0}</td>
      <td class="site-link-actions"><div class="link-actions-host"></div></td>
    </tr>
  `;
}

function renderSiteLinkCard(link, domainName) {
  if (!link || typeof link !== "object") return "";
  const url = linkDisplayUrl(link, domainName);
  const stats = safeSiteStats(link);
  const flags = [];
  if (link.isPaused) {
    flags.push(`<span class="site-flag site-flag-warn">${WorkerI18n.t("sites.linkPaused")}</span>`);
  }
  if (link.iframe) flags.push(`<span class="site-flag">${WorkerI18n.t("sites.badgeIframe")}</span>`);

  return `
    <article class="site-link-card" data-link-id="${link.id}">
      <div class="site-link-card-head">
        <div class="site-link-card-title">
          <a class="site-link-url" href="${WorkerFormat.escapeHtml(url || "#")}" target="_blank" rel="noopener noreferrer">${WorkerFormat.escapeHtml(url || "—")}</a>
          <span class="site-link-sub muted">${WorkerFormat.escapeHtml(link.templateName || link.template || "—")}${link.id ? ` · #${link.id}` : ""}</span>
        </div>
        <div class="link-actions-host"></div>
      </div>
      ${flags.length ? `<div class="site-link-flags">${flags.join("")}</div>` : ""}
      <div class="site-link-card-type">
        <span>${WorkerFormat.escapeHtml(WorkerI18n.t("sites.colAuthType"))}</span>
        <strong>${WorkerFormat.escapeHtml(windowTypeLabel(link.windowType))}</strong>
      </div>
      <div class="site-link-card-stats">
        <span><small>${WorkerFormat.escapeHtml(WorkerI18n.t("sites.views"))}</small><strong>${Number(stats.views || 0)}</strong></span>
        <span><small>${WorkerFormat.escapeHtml(WorkerI18n.t("sites.auths"))}</small><strong>${Number(stats.auths || 0)}</strong></span>
        <span><small>${WorkerFormat.escapeHtml(WorkerI18n.t("sites.validLogs"))}</small><strong>${Number(stats.logs || 0)}</strong></span>
      </div>
    </article>
  `;
}

let openLinkActionsMenu = null;

function closeLinkActionsMenu() {
  if (!openLinkActionsMenu) return;
  openLinkActionsMenu.remove();
  openLinkActionsMenu = null;
}

document.addEventListener("click", () => closeLinkActionsMenu());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeLinkActionsMenu();
});

function mountLinkActionsMenu(host, link, handlers, { domainPaused = false } = {}) {
  if (!host) return;
  host.innerHTML = `
    <button type="button" class="link-actions-btn" aria-label="Actions">
      <svg viewBox="0 0 24 24" fill="none"><circle cx="6" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="18" cy="12" r="1.5" fill="currentColor"/></svg>
    </button>
  `;
  host.querySelector(".link-actions-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    closeLinkActionsMenu();
    const btn = e.currentTarget;
    const rect = btn.getBoundingClientRect();
    const menu = document.createElement("div");
    menu.className = "link-actions-menu";
    menu.innerHTML = domainPaused
      ? `<button type="button" data-act="delete" class="is-danger">${WorkerI18n.t("sites.actionDelete")}</button>`
      : `
      <button type="button" data-act="edit">${WorkerI18n.t("sites.actionEdit")}</button>
      <button type="button" data-act="delete" class="is-danger">${WorkerI18n.t("sites.actionDelete")}</button>
    `;
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${Math.max(8, rect.right - 160)}px`;
    document.body.appendChild(menu);
    openLinkActionsMenu = menu;
    menu.addEventListener("click", (ev) => ev.stopPropagation());
    if (!domainPaused) {
      menu.querySelector('[data-act="edit"]').addEventListener("click", () => {
        closeLinkActionsMenu();
        handlers.onEdit(link);
      });
    }
    menu.querySelector('[data-act="delete"]').addEventListener("click", () => {
      closeLinkActionsMenu();
      handlers.onDelete(link);
    });
  });
}

function linkFormDefaults(templates = []) {
  return {
    mode: "create",
    linkId: null,
    tab: "main",
    templateId: templates[0]?.id ? String(templates[0].id) : "",
    templateName: templates[0]?.name || "",
    windowType: "FakeWindow",
    iframe: true,
    cloaking: false,
    logError: true,
    mafileError: false,
    mafileSteamRedirect: true,
    tradeError: true,
    logRedirect: "",
    tradeRedirect: "",
    mafileRedirect: "",
  };
}

function normalizeRedirectInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function applyLinkToFormState(link, state) {
  state.templateId = link.template ? String(link.template) : "";
  state.templateName = link.templateName || "";
  state.windowType = link.windowType || "FakeWindow";
  state.iframe = link.iframe !== false;
  state.cloaking = Boolean(link.cloaking);
  state.logError = link.steam?.logError !== false;
  state.mafileError = Boolean(link.steam?.mafileError);
  state.mafileSteamRedirect = link.steam?.mafileSteamRedirect !== false;
  state.tradeError = link.steam?.tradeError !== false;
  state.logRedirect = String(link.steam?.logRedirect || "").trim();
  state.tradeRedirect = String(link.steam?.tradeRedirect || "").trim();
  state.mafileRedirect = String(link.steam?.mafileRedirect || "").trim();
}

function syncLinkFormUi(state, { windowSelect } = {}) {
  const title = document.getElementById("linkFormTitle");
  const submit = document.getElementById("linkFormSubmit");
  if (title) {
    title.textContent =
      state.mode === "edit"
        ? WorkerI18n.t("sites.linkEditTitle")
        : WorkerI18n.t("sites.linkCreateTitle");
  }
  if (submit) {
    submit.textContent =
      state.mode === "edit" ? WorkerI18n.t("sites.submitSave") : WorkerI18n.t("sites.submitAdd");
  }
  const templateEl = document.getElementById("linkTemplateValue");
  if (templateEl) {
    templateEl.textContent =
      state.templateName ||
      (state.templateId ? `#${state.templateId}` : WorkerI18n.t("sites.templateNotSelected"));
  }
  if (windowSelect?.setValue) windowSelect.setValue(state.windowType);
  const pathEl = document.getElementById("linkPathInput");
  if (pathEl && state._path != null) pathEl.value = state._path;

  const iframeEl = document.getElementById("linkOptIframe");
  const cloakingEl = document.getElementById("linkOptCloaking");
  if (iframeEl) iframeEl.checked = state.iframe;
  if (cloakingEl) cloakingEl.checked = state.cloaking;

  const logVal = state.logError ? "error" : "redirect";
  const mafileVal = state.mafileError ? "error" : "redirect";
  const tradeVal = state.tradeError ? "error" : "redirect";
  document.querySelectorAll('input[name="logAction"]').forEach((el) => {
    el.checked = el.value === logVal;
  });
  document.querySelectorAll('input[name="mafileAction"]').forEach((el) => {
    el.checked = el.value === mafileVal;
  });
  document.querySelectorAll('input[name="tradeAction"]').forEach((el) => {
    el.checked = el.value === tradeVal;
  });

  const logUrl = document.getElementById("linkLogRedirect");
  const tradeUrl = document.getElementById("linkTradeRedirect");
  const mafileUrl = document.getElementById("linkMafileRedirect");
  if (logUrl) logUrl.value = state.logRedirect || "";
  if (tradeUrl) tradeUrl.value = state.tradeRedirect || "";
  if (mafileUrl) mafileUrl.value = state.mafileRedirect || "";

  const logWrap = document.getElementById("linkLogRedirectWrap");
  const tradeWrap = document.getElementById("linkTradeRedirectWrap");
  const mafileWrap = document.getElementById("linkMafileRedirectWrap");
  if (logWrap) logWrap.hidden = state.logError;
  if (tradeWrap) tradeWrap.hidden = state.tradeError;
  if (mafileWrap) mafileWrap.hidden = state.mafileError;
}

function mountLinkFormModal({ templates, domainId, domainPaused = false, onSaved }) {
  const state = linkFormDefaults(templates);
  const dialog = document.getElementById("linkFormDialog");
  const templateDialog = document.getElementById("templatePickDialog");
  const createTemplateDialog = document.getElementById("templateCreateDialog");
  let templatesList = Array.isArray(templates) ? templates.slice() : [];
  let windowSelect = null;
  const windowHost = document.getElementById("linkWindowSelect");

  function afterTemplatePicked() {
    syncLinkFormUi(state, { windowSelect });
    templateDialog?.close();
  }

  function openTemplatePicker() {
    if (!templateDialog.open) templateDialog.showModal();
    paintTemplateGrid(templatesList, state, afterTemplatePicked, {
      onAdd: () => {
        const publicInput = document.getElementById("templateCreatePublic");
        if (publicInput) publicInput.checked = false;
        if (!createTemplateDialog?.open) createTemplateDialog?.showModal();
      },
      onDelete: async (id) => {
        const tpl = templatesList.find((row) => String(row.id) === String(id));
        if (!tpl?.mine) return;
        const ok = await openConfirmDialog({
          title: WorkerI18n.t("sites.templateDeleteTitle"),
          message: WorkerI18n.t("sites.templateDeleteConfirm", {
            name: tpl.name || `#${id}`,
          }),
          confirmLabel: WorkerI18n.t("sites.templateDelete"),
        });
        if (!ok) return;
        try {
          await WorkerAPI.del(`/sites/templates/${id}`);
          templatesList = templatesList.filter((row) => String(row.id) !== String(id));
          if (String(state.templateId) === String(id)) {
            state.templateId = "";
            state.templateName = "";
            syncLinkFormUi(state, { windowSelect });
          }
          openTemplatePicker();
        } catch (error) {
          showSitesError(error);
        }
      },
    });
  }

  function ensureWindowSelectMounted() {
    if (!windowHost) return;
    if (windowHost.dataset.mounted === "1") return;
    windowHost.dataset.mounted = "1";
    windowSelect = WorkerDropdown.mount(windowHost, {
      value: state.windowType,
      ariaLabel: WorkerI18n.t("sites.windowLabel"),
      options: [
        { value: "FakeWindow", label: WorkerI18n.t("sites.windowFakeWindow") },
        { value: "CurrentWindow", label: WorkerI18n.t("sites.windowCurrentWindow") },
        { value: "NewWindow", label: WorkerI18n.t("sites.windowNewWindow") },
        { value: "AboutBlank", label: WorkerI18n.t("sites.windowAboutBlank") },
      ],
      onChange: (value) => {
        state.windowType = value;
      },
    });
  }

  function paintTabs() {
    dialog.querySelectorAll("[data-link-tab]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.linkTab === state.tab);
    });
    dialog.querySelectorAll("[data-link-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.linkPanel !== state.tab;
    });
  }

  function openCreate() {
    Object.assign(state, linkFormDefaults(templates));
    state.mode = "create";
    state.linkId = null;
    state._path = "";
    paintTabs();
    syncLinkFormUi(state, { windowSelect });
    dialog.showModal();
    // Dropdown позиционируется через getBoundingClientRect().
    // Монтируем после открытия диалога, чтобы координаты были корректные.
    setTimeout(() => {
      ensureWindowSelectMounted();
      syncLinkFormUi(state, { windowSelect });
    }, 0);
  }

  function openEdit(link) {
    Object.assign(state, linkFormDefaults(templates));
    state.mode = "edit";
    state.linkId = link.id;
    state._path = String(link.path || "").replace(/^\/+/, "");
    applyLinkToFormState(link, state);
    paintTabs();
    syncLinkFormUi(state, { windowSelect });
    dialog.showModal();
    setTimeout(() => {
      ensureWindowSelectMounted();
      syncLinkFormUi(state, { windowSelect });
    }, 0);
  }

  async function submit() {
    if (!state.templateId) {
      alert(WorkerI18n.t("sites.templateNotSelected"));
      return;
    }
    state.logRedirect = normalizeRedirectInput(document.getElementById("linkLogRedirect")?.value);
    state.tradeRedirect = normalizeRedirectInput(document.getElementById("linkTradeRedirect")?.value);
    state.mafileRedirect = normalizeRedirectInput(document.getElementById("linkMafileRedirect")?.value);

    if (!state.logError && !state.logRedirect) {
      alert(WorkerI18n.t("sites.redirectUrlRequired"));
      state.tab = "advanced";
      paintTabs();
      syncLinkFormUi(state, { windowSelect });
      document.getElementById("linkLogRedirect")?.focus();
      return;
    }
    if (!state.tradeError && !state.tradeRedirect) {
      alert(WorkerI18n.t("sites.redirectUrlRequired"));
      state.tab = "advanced";
      paintTabs();
      syncLinkFormUi(state, { windowSelect });
      document.getElementById("linkTradeRedirect")?.focus();
      return;
    }

    const payload = {
      path: document.getElementById("linkPathInput").value.trim(),
      templateId: state.templateId,
      windowType: state.windowType,
      iframe: state.iframe,
      cloaking: state.cloaking,
      logError: state.logError,
      mafileError: state.mafileError,
      tradeError: state.tradeError,
      logRedirect: state.logError ? "" : state.logRedirect,
      tradeRedirect: state.tradeError ? "" : state.tradeRedirect,
      mafileRedirect: state.mafileError ? "" : state.mafileRedirect,
      // Пустой URL для MaFile = редирект на Steam.
      mafileSteamRedirect: state.mafileError ? false : !state.mafileRedirect,
    };
    try {
      if (state.mode === "edit") {
        await WorkerAPI.patch(`/sites/domains/${domainId}/links/${state.linkId}`, payload);
      } else {
        await WorkerAPI.post(`/sites/domains/${domainId}/links`, payload);
      }
      dialog.close();
      await onSaved();
    } catch (error) {
      alert(error.message || WorkerI18n.t("common.error"));
    }
  }

  dialog.querySelectorAll("[data-link-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.tab = btn.dataset.linkTab;
      paintTabs();
    });
  });

  document.getElementById("linkFormCancel")?.addEventListener("click", () => dialog.close());
  document.getElementById("linkFormSubmit")?.addEventListener("click", submit);
  dialog.addEventListener("close", () => WorkerDropdown.close());

  document.getElementById("linkTemplateOpen")?.addEventListener("click", () => {
    openTemplatePicker();
  });

  // windowHost dropdown mounted lazily after dialog.showModal()

  document.getElementById("linkOptIframe")?.addEventListener("change", (e) => {
    state.iframe = e.target.checked;
  });
  document.getElementById("linkOptCloaking")?.addEventListener("change", (e) => {
    state.cloaking = e.target.checked;
  });
  dialog.querySelectorAll('input[name="logAction"]').forEach((input) => {
    input.addEventListener("change", () => {
      state.logError = input.value === "error";
      syncLinkFormUi(state, { windowSelect });
    });
  });
  dialog.querySelectorAll('input[name="mafileAction"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (input.value === "error") {
        state.mafileError = true;
        state.mafileSteamRedirect = false;
      } else {
        state.mafileError = false;
        state.mafileSteamRedirect = !state.mafileRedirect;
      }
      syncLinkFormUi(state, { windowSelect });
    });
  });
  dialog.querySelectorAll('input[name="tradeAction"]').forEach((input) => {
    input.addEventListener("change", () => {
      state.tradeError = input.value === "error";
      syncLinkFormUi(state, { windowSelect });
    });
  });
  document.getElementById("linkLogRedirect")?.addEventListener("input", (e) => {
    state.logRedirect = e.target.value;
  });
  document.getElementById("linkTradeRedirect")?.addEventListener("input", (e) => {
    state.tradeRedirect = e.target.value;
  });
  document.getElementById("linkMafileRedirect")?.addEventListener("input", (e) => {
    state.mafileRedirect = e.target.value;
    state.mafileSteamRedirect = !String(e.target.value || "").trim();
  });

  const createHint = document.getElementById("templateCreateHint");
  const setCreateHint = (text) => {
    if (!createHint) return;
    const value = String(text || "").trim();
    createHint.textContent = value;
    createHint.hidden = !value;
  };
  document.getElementById("templateCreateCancel")?.addEventListener("click", () => {
    const publicInput = document.getElementById("templateCreatePublic");
    if (publicInput) publicInput.checked = false;
    createTemplateDialog?.close();
  });
  const fileNameEl = document.getElementById("templateCreateFileName");
  const fileInput = document.getElementById("templateCreateFile");
  function resetCreateFile() {
    if (fileInput) fileInput.value = "";
    if (fileNameEl) {
      fileNameEl.textContent = "";
      fileNameEl.hidden = true;
    }
  }
  document.getElementById("templateCreateFileBtn")?.addEventListener("click", () => {
    fileInput?.click();
  });
  fileInput?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      resetCreateFile();
      return;
    }
    const textarea = document.getElementById("templateCreateCode");
    const nameInput = document.getElementById("templateCreateName");
    try {
      textarea.value = await file.text();
      if (nameInput && !nameInput.value.trim()) {
        nameInput.value = String(file.name || "").replace(/\.html?$/i, "").slice(0, 80);
      }
      if (fileNameEl) {
        fileNameEl.textContent = file.name;
        fileNameEl.hidden = false;
      }
      setCreateHint("");
    } catch (error) {
      resetCreateFile();
      setCreateHint(error.message || WorkerI18n.t("common.error"));
    }
  });
  document.getElementById("templateCreateForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const nameInput = document.getElementById("templateCreateName");
    const codeInput = document.getElementById("templateCreateCode");
    const submitBtn = document.getElementById("templateCreateSubmit");
    const name = String(nameInput?.value || "").trim();
    const code = String(codeInput?.value || "").trim();
    if (!name) {
      setCreateHint(WorkerI18n.t("sites.templateAddErrorName"));
      nameInput?.focus();
      return;
    }
    if (!code) {
      setCreateHint(WorkerI18n.t("sites.templateAddErrorHtml"));
      codeInput?.focus();
      return;
    }
    submitBtn.disabled = true;
    setCreateHint("");
    try {
      const result = await WorkerAPI.post("/sites/templates", {
        name,
        code,
        isPublic: Boolean(document.getElementById("templateCreatePublic")?.checked),
      });
      const created = result?.template;
      if (created?.id) {
        templatesList = [
          {
            id: created.id,
            name: created.name,
            preview: created.preview || "",
            mine: true,
            isPublic: Boolean(created.isPublic),
          },
          ...templatesList.filter((row) => String(row.id) !== String(created.id)),
        ];
        state.templateId = String(created.id);
        state.templateName = created.name || "";
        syncLinkFormUi(state, { windowSelect });
      }
      createTemplateDialog?.close();
      if (nameInput) nameInput.value = "";
      if (codeInput) codeInput.value = "";
      const publicInput = document.getElementById("templateCreatePublic");
      if (publicInput) publicInput.checked = false;
      resetCreateFile();
      openTemplatePicker();
    } catch (error) {
      setCreateHint(error.message || WorkerI18n.t("common.error"));
    } finally {
      submitBtn.disabled = false;
    }
  });

  return { openCreate, openEdit };
}

function paintTemplateGrid(templates, state, onSelect, { onAdd, onDelete } = {}) {
  const grid = document.getElementById("templatePickGrid");
  const search = document.getElementById("templatePickSearch");
  const selectBtn = document.getElementById("templatePickSelect");
  const backBtn = document.getElementById("templatePickBack");
  if (!grid) return;

  let selectedId = state.templateId;

  function addCardHtml() {
    return `
      <button type="button" class="template-card template-card-add" data-template-add>
        <span class="template-card-preview template-card-preview-add" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </span>
        <span class="template-card-meta">
          <span class="template-row-id">+</span>
          <span class="template-row-name">${WorkerFormat.escapeHtml(WorkerI18n.t("sites.templateAdd"))}</span>
        </span>
      </button>`;
  }

  function render(filter = "") {
    const q = filter.trim().toLowerCase();
    const rows = (templates || []).filter((t) => {
      const name = String(t.name || "").toLowerCase();
      const id = String(t.id || "");
      return !q || name.includes(q) || id.includes(q);
    });
    const cards = rows
      .map((t) => {
        const preview = String(t.preview || "").trim();
        const previewHtml = preview
          ? `<img class="template-card-img" src="${WorkerFormat.escapeHtml(preview)}" alt="" loading="lazy" decoding="async" />`
          : `<div class="template-card-placeholder">${WorkerFormat.escapeHtml(WorkerI18n.t("sites.templateNoPreview"))}</div>`;
        const canDelete = Boolean(t.mine);
        const deleteBtn = canDelete
          ? `<button type="button" class="template-card-delete" data-template-delete="${t.id}" aria-label="${WorkerFormat.escapeHtml(
              WorkerI18n.t("sites.templateDelete")
            )}" title="${WorkerFormat.escapeHtml(WorkerI18n.t("sites.templateDelete"))}">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M5 7h14M9 7V5h6v2M10 11v6M14 11v6M7 7l1 12h8l1-12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>`
          : "";
        return `
          <div class="template-card-wrap${canDelete ? " has-delete" : ""}">
            <button type="button" class="template-card${String(selectedId) === String(t.id) ? " is-selected" : ""}" data-template-id="${t.id}">
              <span class="template-card-preview">${previewHtml}</span>
              <span class="template-card-meta">
                <span class="template-row-id">${t.id}</span>
                <span class="template-row-name">${WorkerFormat.escapeHtml(t.name || `Template #${t.id}`)}</span>
              </span>
            </button>
            ${deleteBtn}
          </div>`;
      })
      .join("");
    grid.innerHTML = `${addCardHtml()}${
      cards || (q ? `<div class="sites-empty">${WorkerFormat.escapeHtml(WorkerI18n.t("sites.noTemplates"))}</div>` : "")
    }`;

    grid.querySelectorAll(".template-card-img").forEach((img) => {
      img.addEventListener("error", () => {
        const wrap = img.closest(".template-card-preview");
        if (!wrap) return;
        wrap.innerHTML = `<div class="template-card-placeholder">${WorkerFormat.escapeHtml(WorkerI18n.t("sites.templateNoPreview"))}</div>`;
      });
    });

    grid.querySelector("[data-template-add]")?.addEventListener("click", () => {
      if (typeof onAdd === "function") onAdd();
    });

    grid.querySelectorAll("[data-template-delete]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof onDelete === "function") onDelete(btn.dataset.templateDelete);
      });
    });

    grid.querySelectorAll("[data-template-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedId = btn.dataset.templateId;
        grid.querySelectorAll(".template-card").forEach((row) => {
          row.classList.toggle("is-selected", row.dataset.templateId === selectedId);
        });
      });
      btn.addEventListener("dblclick", () => {
        selectedId = btn.dataset.templateId;
        const picked = (templates || []).find((t) => String(t.id) === String(selectedId));
        if (!picked) return;
        state.templateId = String(picked.id);
        state.templateName = picked.name || "";
        onSelect();
      });
    });
  }

  if (search) {
    search.value = "";
    search.oninput = () => render(search.value);
  }

  selectBtn.onclick = () => {
    const picked = (templates || []).find((t) => String(t.id) === String(selectedId));
    if (!picked) return;
    state.templateId = String(picked.id);
    state.templateName = picked.name || "";
    onSelect();
  };

  backBtn.onclick = () => document.getElementById("templatePickDialog")?.close();

  render("");
}

async function renderSiteDetail(main, domainId, ctx) {
  const force = !!ctx?.refresh;
  let detail;
  let templatesData = { templates: [] };
  try {
    [detail, templatesData] = await Promise.all([
      WorkerAPI.get(`/sites/domains/${domainId}`, { force }),
      WorkerAPI.get("/sites/templates", { force: true }).catch(() => ({ templates: [] })),
    ]);
  } catch (error) {
    if (window.WorkerToast) WorkerToast.error(error);
    WorkerViews.sitesState.selectedId = null;
    await renderSitesList(main, ctx);
    return;
  }
  const d = pickDomainObject(detail);
  if (!d) {
    if (window.WorkerToast) {
      WorkerToast.error(WorkerI18n.t("toast.notFound"));
    }
    WorkerViews.sitesState.selectedId = null;
    await renderSitesList(main, ctx);
    return;
  }
  const domainPaused = Boolean(d.isPaused);
  const templates = templatesData?.templates || [];
  const links = (Array.isArray(detail.links) ? detail.links : []).filter(
    (link) => link && typeof link === "object"
  );
  const stats = safeSiteStats(d);
  const banChecks = d.banChecks && typeof d.banChecks === "object" ? d.banChecks : {};
  const googleBanned = banChecks.google?.banned;

  try {
    main.innerHTML = `
    <div class="sites-detail-page">
    <header class="sites-detail-page-head">
      <nav class="sites-breadcrumb-line" aria-label="${WorkerFormat.escapeHtml(WorkerI18n.t("sites.breadcrumbSites"))}">
        <button type="button" class="sites-crumb-btn" id="sitesBack">${WorkerI18n.t("sites.breadcrumbSites")}</button>
        <span class="sites-crumb-sep" aria-hidden="true">›</span>
        <span class="sites-crumb-current" aria-current="page">${WorkerFormat.escapeHtml(d.domain)}</span>
      </nav>
      <h1 class="page-greeting"><em>${WorkerFormat.escapeHtml(d.domain)}</em></h1>
    </header>

    <section class="section sites-detail-overview">
      <div class="section-head">
        <h2 class="section-title">${WorkerI18n.t("sites.domainOverview")}</h2>
        <div class="site-head-badges">
          ${renderDomainBadges(d)}
          <div class="site-card-tools site-head-tools">
            <button type="button" class="site-tool site-tool-check${banChecks.whois?.banned ? " is-banned" : ""}" aria-label="Whois">
              <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.5"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" stroke="currentColor" stroke-width="1.5"/></svg>
              ${renderBanTooltip("whois", banChecks)}
            </button>
            <button type="button" class="site-tool site-tool-check${banChecks.cloudflare?.banned ? " is-banned" : ""}" aria-label="Cloudflare">
              <svg viewBox="0 0 24 24" fill="none"><path d="M7 16h10l1-2.5H6.5L7 16Z" fill="currentColor" opacity=".35"/><path d="M8 13.5h9.5c.5-2.5-1-4.5-3.5-4.5-1.5 0-2.8.8-3.5 2.1C10.2 9.8 8.5 9 7 9.5 5.2 10.1 4 11.7 4 13.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
              ${renderBanTooltip("cloudflare", banChecks)}
            </button>
            <button type="button" class="site-tool site-tool-check site-tool-google${googleBanned ? " is-banned" : ""}" aria-label="Google">
              <span class="site-tool-g">G</span>
              ${renderBanTooltip("google", banChecks)}
            </button>
          </div>
        </div>
      </div>
      <div class="site-domain-kpi">
        ${renderMiniStat(WorkerI18n.t("sites.onlineLabel"), d.online || 0, "online")}
        ${renderMiniStat(WorkerI18n.t("sites.linksCount"), links.length, "links")}
        ${renderMiniStat(WorkerI18n.t("sites.views"), stats.views || 0, "views")}
        ${renderMiniStat(WorkerI18n.t("sites.validLogs"), stats.logs || 0, "logs")}
      </div>
      <div class="site-domain-meta">
        <span class="muted">${WorkerI18n.t("sites.createdAt")}:</span> ${WorkerFormat.escapeHtml(WorkerFormat.shortDayTime(d.createdAt))}
        <span class="site-domain-meta-sep">·</span>
        ${renderBindMeta(d)}
      </div>
    </section>

    <section class="section sites-links-section">
      <div class="section-head">
        <h2 class="section-title">${WorkerI18n.t("sites.linksTitle")}</h2>
        ${domainPaused ? "" : `<button type="button" class="btn btn-primary" id="siteAddLink">${WorkerI18n.t("sites.createLink")}</button>`}
      </div>
      ${
        domainPaused
          ? `<div class="sites-paused-banner" role="status">${WorkerFormat.escapeHtml(
              WorkerI18n.t("sites.linksPausedHint")
            )}</div>`
          : ""
      }
      ${
        links.length
          ? `<div class="table-wrap">
              <table class="data">
                <thead>
                  <tr>
                    <th>${WorkerI18n.t("sites.colLink")}</th>
                    <th>${WorkerI18n.t("sites.colAuthType")}</th>
                    <th class="col-num">${WorkerI18n.t("sites.views")}</th>
                    <th class="col-num">${WorkerI18n.t("sites.auths")}</th>
                    <th class="col-num">${WorkerI18n.t("sites.validLogs")}</th>
                    <th class="col-actions"></th>
                  </tr>
                </thead>
                <tbody>${links.map((link) => renderSiteLinkRow(link, d.domain)).join("")}</tbody>
              </table>
            </div>
            <div class="site-links-mobile">${links.map((link) => renderSiteLinkCard(link, d.domain)).join("")}</div>`
          : `<div class="empty-state sites-links-empty">
              <div class="empty-state-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M10.2 13.8a3.6 3.6 0 0 1 0-5.1l2.1-2.1a3.6 3.6 0 0 1 5.1 5.1l-1.2 1.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  <path d="M13.8 10.2a3.6 3.6 0 0 1 0 5.1l-2.1 2.1a3.6 3.6 0 0 1-5.1-5.1l1.2-1.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              </div>
              <h2 class="empty-state-title">${WorkerFormat.escapeHtml(WorkerI18n.t("sites.linksEmptyTitle"))}</h2>
              <p class="empty-state-text">${WorkerFormat.escapeHtml(WorkerI18n.t("sites.linksEmptyHint"))}</p>
              ${
                domainPaused
                  ? ""
                  : `<div class="empty-state-actions">
                      <button type="button" class="btn btn-primary" id="siteEmptyAdd">${WorkerI18n.t("sites.createLink")}</button>
                    </div>`
              }
            </div>`
      }
    </section>

    ${d.isOwn ? `<div class="sites-detail-danger"><button type="button" class="btn btn-danger" id="domainDelete">${WorkerI18n.t("sites.deleteDomain")}</button></div>` : ""}

    <dialog class="sites-dialog sites-dialog-wide" id="linkFormDialog">
      <div class="sites-dialog-body link-create-body">
        <h3 class="sites-dialog-title" id="linkFormTitle">${WorkerI18n.t("sites.linkCreateTitle")}</h3>
        <div class="link-segments">
          <button type="button" class="link-segment is-active" data-link-tab="main">${WorkerI18n.t("sites.tabMain")}</button>
          <button type="button" class="link-segment" data-link-tab="advanced">${WorkerI18n.t("sites.tabAdvanced")}</button>
        </div>
        <div class="link-create-panel" data-link-panel="main">
          <div class="link-field">
            <div class="link-field-label">
              <span>${WorkerI18n.t("sites.pathLabel")}</span>
              <span class="muted">${WorkerI18n.t("sites.optional")}</span>
            </div>
            <div class="link-path-input">
              <span class="link-path-prefix">${WorkerFormat.escapeHtml(d.domain)}/</span>
              <input class="input link-path-field" id="linkPathInput" autocomplete="off" />
            </div>
          </div>
          <div class="link-field">
            <div class="link-field-label"><span>${WorkerI18n.t("sites.templateLabel")}</span></div>
            <button type="button" class="link-template-btn" id="linkTemplateOpen">
              <span id="linkTemplateValue">${WorkerI18n.t("sites.templateNotSelected")}</span>
              <svg viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </button>
          </div>
          <div class="link-field">
            <div class="link-field-label"><span>${WorkerI18n.t("sites.windowLabel")}</span></div>
            <div id="linkWindowSelect" class="custom-select-host"></div>
          </div>
        </div>
        <div class="link-create-panel" data-link-panel="advanced" hidden>
          <div class="link-advanced-block">
            <div class="link-advanced-title">${WorkerI18n.t("sites.advancedProtection")}</div>
            <label class="link-check"><input type="checkbox" id="linkOptIframe" checked /> ${WorkerI18n.t("sites.useIframe")}</label>
            <label class="link-check"><input type="checkbox" id="linkOptCloaking" /> ${WorkerI18n.t("sites.cloaking")}</label>
          </div>
          <div class="link-advanced-block">
            <div class="link-advanced-title">${WorkerI18n.t("sites.afterLog")}</div>
            <label class="link-radio"><input type="radio" name="logAction" value="error" checked /> ${WorkerI18n.t("sites.actionError")}</label>
            <label class="link-radio"><input type="radio" name="logAction" value="redirect" /> ${WorkerI18n.t("sites.actionRedirect")}</label>
            <div class="link-redirect-wrap" id="linkLogRedirectWrap" hidden>
              <input class="input link-redirect-input" id="linkLogRedirect" type="url" inputmode="url" autocomplete="off" placeholder="${WorkerI18n.t("sites.redirectUrlPlaceholder")}" />
            </div>
          </div>
          <div class="link-advanced-block">
            <div class="link-advanced-title">${WorkerI18n.t("sites.afterMafile")}</div>
            <label class="link-radio"><input type="radio" name="mafileAction" value="error" /> ${WorkerI18n.t("sites.actionError")}</label>
            <label class="link-radio"><input type="radio" name="mafileAction" value="redirect" checked /> ${WorkerI18n.t("sites.actionRedirect")}</label>
            <div class="link-redirect-wrap" id="linkMafileRedirectWrap">
              <input class="input link-redirect-input" id="linkMafileRedirect" type="url" inputmode="url" autocomplete="off" placeholder="${WorkerI18n.t("sites.redirectUrlPlaceholderMafile")}" />
            </div>
          </div>
          <div class="link-advanced-block">
            <div class="link-advanced-title">${WorkerI18n.t("sites.afterTrade")}</div>
            <label class="link-radio"><input type="radio" name="tradeAction" value="error" checked /> ${WorkerI18n.t("sites.actionError")}</label>
            <label class="link-radio"><input type="radio" name="tradeAction" value="redirect" /> ${WorkerI18n.t("sites.actionRedirect")}</label>
            <div class="link-redirect-wrap" id="linkTradeRedirectWrap" hidden>
              <input class="input link-redirect-input" id="linkTradeRedirect" type="url" inputmode="url" autocomplete="off" placeholder="${WorkerI18n.t("sites.redirectUrlPlaceholder")}" />
            </div>
          </div>
        </div>
        <div class="sites-dialog-actions sites-dialog-actions-stack">
          <button type="button" class="btn btn-primary" id="linkFormSubmit">${WorkerI18n.t("sites.submitAdd")}</button>
          <button type="button" class="btn btn-ghost" id="linkFormCancel">${WorkerI18n.t("sites.cancel")}</button>
        </div>
      </div>
    </dialog>

    <dialog class="sites-dialog sites-dialog-wide sites-dialog-templates" id="templatePickDialog">
      <div class="sites-dialog-body">
        <h3 class="sites-dialog-title">${WorkerI18n.t("sites.templatePickTitle")}</h3>
        <p class="muted sites-dialog-sub">${WorkerI18n.t("sites.templatePickHint")}</p>
        <label class="sites-search sites-search-compact">
          <svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.5"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          <input type="search" id="templatePickSearch" placeholder="${WorkerI18n.t("sites.templateSearch")}" autocomplete="off" />
        </label>
        <div class="template-pick-grid" id="templatePickGrid"></div>
        <div class="sites-dialog-actions">
          <button type="button" class="btn btn-primary" id="templatePickSelect">${WorkerI18n.t("sites.templateSelect")}</button>
          <button type="button" class="btn btn-ghost" id="templatePickBack">${WorkerI18n.t("sites.templateBack")}</button>
        </div>
      </div>
    </dialog>

    <dialog class="sites-dialog" id="templateCreateDialog">
      <form method="dialog" class="sites-dialog-body" id="templateCreateForm" novalidate>
        <h3 class="sites-dialog-title">${WorkerI18n.t("sites.templateAdd")}</h3>
        <p class="muted sites-dialog-sub">${WorkerI18n.t("sites.templateAddHint")}</p>
        <label class="link-field">
          <span class="link-field-label"><span>${WorkerI18n.t("sites.templateNameLabel")}</span></span>
          <input class="input" id="templateCreateName" autocomplete="off" maxlength="80" placeholder="${WorkerI18n.t(
            "sites.templateNamePlaceholder"
          )}" />
        </label>
        <label class="link-check template-public-check">
          <input type="checkbox" id="templateCreatePublic" />
          <span>
            <span>${WorkerI18n.t("sites.templatePublic")}</span>
            <small class="muted">${WorkerI18n.t("sites.templatePublicHint")}</small>
          </span>
        </label>
        <label class="link-field">
          <span class="link-field-label"><span>${WorkerI18n.t("sites.templateHtmlFile")}</span></span>
          <div class="template-file-pick">
            <input id="templateCreateFile" type="file" accept=".html,text/html" hidden />
            <button type="button" class="btn btn-ghost template-file-btn" id="templateCreateFileBtn">
              ${WorkerI18n.t("sites.templateHtmlPick")}
            </button>
            <span class="template-file-name" id="templateCreateFileName" hidden></span>
          </div>
        </label>
        <label class="link-field">
          <span class="link-field-label"><span>${WorkerI18n.t("sites.templateHtmlLabel")}</span></span>
          <textarea class="input template-html-input" id="templateCreateCode" rows="8" spellcheck="false"></textarea>
        </label>
        <div class="muted sites-dialog-hint" id="templateCreateHint" hidden></div>
        <div class="sites-dialog-actions sites-confirm-actions">
          <button type="button" class="btn btn-ghost" id="templateCreateCancel">${WorkerI18n.t("sites.cancel")}</button>
          <button type="submit" class="btn btn-primary" id="templateCreateSubmit">${WorkerI18n.t("sites.templateAddSubmit")}</button>
        </div>
      </form>
    </dialog>
    </div>
  `;

    document.getElementById("sitesBack").addEventListener("click", () => {
      WorkerViews.sitesState.selectedId = null;
      WorkerViews.sites(ctx);
    });

    const refreshDetail = () => renderSiteDetail(main, domainId, { ...ctx, refresh: true });
    const linkModal = mountLinkFormModal({
      templates,
      domainId,
      domainPaused,
      onSaved: refreshDetail,
    });

    ["siteAddLink", "siteEmptyAdd"].forEach((id) => {
      document.getElementById(id)?.addEventListener("click", () => linkModal.openCreate());
    });

    main.querySelectorAll("[data-link-id]").forEach((row) => {
      const linkId = Number(row.dataset.linkId);
      const link = links.find((item) => Number(item.id) === linkId);
      if (!link) return;
      mountLinkActionsMenu(
        row.querySelector(".link-actions-host"),
        link,
        {
          onEdit: (item) => linkModal.openEdit(item),
          onDelete: async (item) => {
            const ok = await openConfirmDialog({
              title: WorkerI18n.t("sites.deleteLinkTitle"),
              message: WorkerI18n.t("sites.deleteLinkConfirm"),
              confirmLabel: WorkerI18n.t("sites.actionDelete"),
            });
            if (!ok) return;
            try {
              await WorkerAPI.del(`/sites/domains/${domainId}/links/${item.id}`);
              await refreshDetail();
            } catch (error) {
              showSitesError(error);
            }
          },
        },
        { domainPaused }
      );
    });

    document.getElementById("domainDelete")?.addEventListener("click", async () => {
      const ok = await openConfirmDialog({
        title: WorkerI18n.t("sites.deleteDomain"),
        message: WorkerI18n.t("sites.deleteConfirm", { domain: d.domain }),
        confirmLabel: WorkerI18n.t("sites.actionDelete"),
      });
      if (!ok) return;
      try {
        await WorkerAPI.del(`/sites/domains/${domainId}`);
        WorkerViews.sitesState.selectedId = null;
        await WorkerViews.sites(ctx);
      } catch (error) {
        showSitesError(error);
      }
    });
  } catch (error) {
    if (window.WorkerToast) WorkerToast.error(error);
    WorkerViews.sitesState.selectedId = null;
    await renderSitesList(main, ctx);
  }
}
