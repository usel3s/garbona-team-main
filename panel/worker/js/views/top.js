window.WorkerViews = window.WorkerViews || {};

WorkerViews.topState = { period: "7d" };

function topEmptyIcon(kind) {
  if (kind === "error") {
    return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.25" stroke="currentColor" stroke-width="1.5"/><path d="M12 8v5.2M12 15.8h.01" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7.5 9.5h9l-.8 9.2a1.6 1.6 0 0 1-1.6 1.5H9.9a1.6 1.6 0 0 1-1.6-1.5L7.5 9.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9.2 9.5 10 5.8h4l.8 3.7M6 9.5h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function renderTopEmptyState({ kind = "empty", title, text, actions = [] } = {}) {
  const actionsHtml = actions.length
    ? `<div class="empty-state-actions">${actions.join("")}</div>`
    : "";
  return `
    <div class="empty-state">
      <div class="empty-state-icon">${topEmptyIcon(kind)}</div>
      <h2 class="empty-state-title">${WorkerFormat.escapeHtml(title)}</h2>
      <p class="empty-state-text">${WorkerFormat.escapeHtml(text)}</p>
      ${actionsHtml}
    </div>`;
}

function topProfilePhotoUrls(profile) {
  const candidates = [];
  const photo = String(profile?.photoUrl || "").trim();
  if (/^(?:https?:\/\/|\/)/i.test(photo)) candidates.push(photo);

  const telegramId = String(profile?.telegramId || "").trim();
  if (/^\d+$/.test(telegramId)) {
    candidates.push(`/assets/avatar/${telegramId}`);
  }

  const username = String(profile?.username || "")
    .trim()
    .replace(/^@/, "");
  if (/^[A-Za-z0-9_]{5,32}$/.test(username)) {
    candidates.push(`https://t.me/i/userpic/320/${username}.jpg`);
  }
  candidates.push(WorkerFormat.logoUrl());
  return [...new Set(candidates)];
}

function topProfilePhotoUrl(profile) {
  return topProfilePhotoUrls(profile)[0];
}

function topTelegramProfileUrl(profile) {
  const username = String(profile?.username || "")
    .trim()
    .replace(/^@/, "");
  if (/^[A-Za-z0-9_]{5,32}$/.test(username)) {
    return `https://t.me/${username}`;
  }
  const id = String(profile?.telegramId || "").trim();
  return id ? `tg://user?id=${id}` : "";
}

async function topCopyText(value, toastKey) {
  const text = String(value || "").trim();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    if (window.WorkerToast) {
      WorkerToast.success(WorkerI18n.t(toastKey));
    }
  } catch (_) {
    if (window.WorkerToast) {
      WorkerToast.error(WorkerI18n.t("top.copyFailed"));
    }
  }
}

function topNumber(value) {
  return new Intl.NumberFormat(WorkerI18n.lang() === "en" ? "en-US" : "ru-RU").format(
    Number(value || 0)
  );
}

function topDisplayName(row) {
  if (row.isAnonymous) {
    const tag = String(row.fakeProfitTag || "")
      .trim()
      .replace(/^#+/, "");
    if (tag) return `#${tag}`;
    const fromApi = String(row.displayName || "").trim();
    if (fromApi && fromApi !== WorkerI18n.t("top.anonymous")) return fromApi;
    return WorkerI18n.t("top.anonymous");
  }
  return row.displayName || "—";
}

function topInitials(name) {
  const parts = String(name || "")
    .trim()
    .replace(/^#+/, "")
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0].charAt(0);
  const second = parts.length > 1 ? parts[1].charAt(0) : "";
  return `${first}${second}`.toUpperCase();
}

function topRowPhotoUrl(row) {
  if (row.isAnonymous) return "";
  const photo = topProfilePhotoUrl({
    photoUrl: row.photoUrl,
    username: row.username,
  });
  return photo === WorkerFormat.logoUrl() ? "" : photo;
}

function topRowAvatar(row) {
  const name = topDisplayName(row);
  const initial = topInitials(name);
  const photo = topRowPhotoUrl(row);
  const telegramId = String(row.telegramId || "").trim();
  const proxy = /^\d+$/.test(telegramId) ? `/assets/avatar/${telegramId}` : "";
  const fallbackClass = `top-avatar${row.isAnonymous ? " is-anon" : ""}${photo ? " is-fallback" : ""}`;
  const fallback = `<span class="${fallbackClass}" aria-hidden="true">${WorkerFormat.escapeHtml(initial)}</span>`;
  if (!photo) return fallback;
  return `
    <span class="top-avatar-wrap">
      ${fallback}
      <img class="top-avatar" src="${WorkerFormat.escapeHtml(photo)}" alt="" loading="lazy" referrerpolicy="no-referrer"${proxy && proxy !== photo ? ` data-avatar-fallback="${WorkerFormat.escapeHtml(proxy)}"` : ""} />
    </span>`;
}

function topHasFakeTag(row) {
  return Boolean(
    row.isAnonymous &&
      String(row.fakeProfitTag || "")
        .trim()
        .replace(/^#+/, ""),
  );
}

function topWhoBlock(row) {
  const name = topDisplayName(row);
  const handle = row.username ? `@${row.username}` : "";
  const secondary = handle || (row.isAnonymous ? WorkerI18n.t("top.anonymousHint") : "");
  const nameClass = `top-name${topHasFakeTag(row) ? " is-tag" : ""}${row.isAnonymous && !topHasFakeTag(row) ? " is-anon" : ""}`;
  return `
    <div class="top-who">
      ${topRowAvatar(row)}
      <div class="top-who-copy">
        <div class="${nameClass}">${WorkerFormat.escapeHtml(name)}${row.isMe ? ` <span class="top-me">${WorkerI18n.t("top.you")}</span>` : ""}</div>
        ${secondary ? `<div class="top-handle muted">${WorkerFormat.escapeHtml(secondary)}</div>` : ""}
      </div>
    </div>`;
}

function topStatsBlock(row) {
  return `
    <div class="top-stats">
      <strong class="top-amount">${WorkerFormat.escapeHtml(WorkerFormat.money(row.totalUsd || 0))}</strong>
      <span class="top-count muted">${WorkerFormat.escapeHtml(WorkerI18n.t("top.profitsCount", { count: topNumber(row.count || 0) }))}</span>
    </div>`;
}

function topRankingRow(row) {
  const clickable = !row.isAnonymous && row.telegramId;
  return `
    <div
      class="top-row${clickable ? " is-clickable" : ""}${row.isMe ? " is-me" : ""}"
      ${clickable ? `data-top-id="${WorkerFormat.escapeHtml(row.telegramId)}" tabindex="0" role="button"` : ""}
    >
      <span class="top-rank muted" aria-label="${WorkerFormat.escapeHtml(WorkerI18n.t("top.place", { rank: row.rank }))}">${topNumber(row.rank)}</span>
      ${topWhoBlock(row)}
      ${topStatsBlock(row)}
      ${clickable ? `<span class="top-row-chevron" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="m9 6 6 6-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>` : `<span class="top-row-chevron is-empty" aria-hidden="true"></span>`}
    </div>`;
}

function renderTopRows(rows) {
  return `
    <div class="top-content">
      <section class="section section-flush top-ranking-section" aria-label="${WorkerFormat.escapeHtml(WorkerI18n.t("top.rankingTitle"))}">
        <div class="top-ranking-head">
          <div>
            <strong>${WorkerFormat.escapeHtml(WorkerI18n.t("top.rankingTitle"))}</strong>
          </div>
          <span class="top-ranking-count">${topNumber(rows.length)}</span>
        </div>
        <div class="top-list">
          ${rows.map((row) => topRankingRow(row)).join("")}
        </div>
      </section>
    </div>`;
}

function ensureTopProfileDrawer() {
  let drawer = document.getElementById("topProfileDrawer");
  if (drawer && drawer.parentElement !== document.body) {
    document.body.appendChild(drawer);
  }
  if (!drawer) {
    drawer = document.createElement("div");
    drawer.id = "topProfileDrawer";
    drawer.className = "top-profile-drawer";
    drawer.hidden = true;
    drawer.innerHTML = `
      <div class="top-profile-drawer-backdrop" id="topProfileBackdrop"></div>
      <aside class="top-profile-drawer-sheet" id="topProfileSheet" role="dialog" aria-modal="true" aria-labelledby="topProfileTitle"></aside>
    `;
    document.body.appendChild(drawer);
  }
  return drawer;
}

function renderTopProfilePanel(profile) {
  const photo = topProfilePhotoUrl(profile);
  const bio = String(profile.bio || "").trim();
  const bioText = bio || WorkerI18n.t("top.bioEmpty");
  const username = String(profile.username || "").trim();
  const tgUrl = topTelegramProfileUrl(profile);

  return `
    <div class="top-profile-panel">
      <button type="button" class="btn btn-ghost top-profile-close" id="topProfileClose" aria-label="${WorkerFormat.escapeHtml(WorkerI18n.t("common.close"))}">✕</button>
      <div class="top-profile-head">
        <button type="button" class="top-profile-avatar-btn" id="topProfileAvatarBtn" ${tgUrl ? `data-tg-url="${WorkerFormat.escapeHtml(tgUrl)}"` : ""}>
          <img class="top-profile-avatar" src="${WorkerFormat.escapeHtml(photo)}" alt="" loading="lazy" referrerpolicy="no-referrer" />
        </button>
        <div class="top-profile-intro">
          <button type="button" class="top-profile-name" id="topProfileTitle" ${tgUrl ? `data-tg-url="${WorkerFormat.escapeHtml(tgUrl)}"` : ""}>
            ${WorkerFormat.escapeHtml(profile.displayName || "—")}
          </button>
          <div class="top-profile-role muted">${WorkerFormat.escapeHtml(profile.role || "")}</div>
          <div class="top-profile-meta">
            <button type="button" class="top-profile-chip" id="topProfileIdBtn" data-copy="${WorkerFormat.escapeHtml(profile.telegramId || "")}">
              <span class="muted">${WorkerI18n.t("top.profileId")}</span>
              <strong>${WorkerFormat.escapeHtml(profile.telegramId || "—")}</strong>
            </button>
            ${
              username
                ? `<button type="button" class="top-profile-chip" id="topProfileUsernameBtn" data-copy="@${WorkerFormat.escapeHtml(username)}">
                    <span class="muted">${WorkerI18n.t("top.profileUsername")}</span>
                    <strong>@${WorkerFormat.escapeHtml(username)}</strong>
                  </button>`
                : `<div class="top-profile-chip is-static muted">${WorkerI18n.t("top.noUsername")}</div>`
            }
          </div>
        </div>
      </div>

      <div class="top-profile-bio">
        <div class="top-profile-bio-label muted">${WorkerI18n.t("top.bioLabel")}</div>
        <p class="top-profile-bio-text${bio ? "" : " is-empty"}">${WorkerFormat.escapeHtml(bioText)}</p>
      </div>

      <div class="top-profile-kpis">
        <div class="top-profile-kpi">
          <span>${WorkerI18n.t("top.daysInTeam")}</span>
          <strong>${WorkerI18n.t("top.daysCount", { count: profile.daysInTeam || 0 })}</strong>
        </div>
        <div class="top-profile-kpi">
          <span>${WorkerI18n.t("top.maxProfit")}</span>
          <strong>${WorkerFormat.escapeHtml(WorkerFormat.money(profile.maxProfitUsd || 0))}</strong>
        </div>
        <div class="top-profile-kpi">
          <span>${WorkerI18n.t("top.totalProfit")}</span>
          <strong>${WorkerFormat.escapeHtml(WorkerFormat.money(profile.totalProfitUsd || 0))}</strong>
        </div>
      </div>

      <section class="top-profile-chart-section">
        <div class="top-profile-chart-head">
          <h3>${WorkerI18n.t("top.chartTitle")}</h3>
          <div id="topProfileChartPeriod" class="custom-select-host top-profile-chart-period"></div>
        </div>
        <div id="topProfileChart" class="chart-area top-profile-chart"></div>
      </section>
    </div>
  `;
}

WorkerViews.top = async function renderTop(ctx) {
  const { main, user } = ctx;
  const state = WorkerViews.topState;
  let profileState = { telegramId: "", chartPeriod: "7d", loading: false };

  ensureTopProfileDrawer();

  main.innerHTML = `
    <header class="page-head top-page-head">
      <div>
        <h1 class="page-greeting">${WorkerI18n.t("top.pageTitle")}</h1>
        <p class="page-sub muted">${WorkerI18n.t("top.subtitle")}</p>
      </div>
      <div id="topPeriodSelect" class="custom-select-host"></div>
    </header>
    <div id="topBody">
      <div class="top-loading" aria-label="${WorkerFormat.escapeHtml(WorkerI18n.t("common.loading"))}">
        ${Array.from({ length: 3 }, () => '<div class="top-loading-card"></div>').join("")}
      </div>
    </div>
  `;

  function closeProfile() {
    const drawer = document.getElementById("topProfileDrawer");
    if (!drawer) return;
    drawer.classList.remove("is-open");
    document.body.classList.remove("top-profile-open");
    window.setTimeout(() => {
      drawer.hidden = true;
      document.getElementById("topProfileSheet").innerHTML = "";
    }, 220);
    profileState.telegramId = "";
  }

  function openTelegram(url) {
    const href = String(url || "").trim();
    if (!href) return;
    if (window.Telegram?.WebApp?.openTelegramLink && href.startsWith("https://t.me/")) {
      window.Telegram.WebApp.openTelegramLink(href);
      return;
    }
    window.open(href, "_blank", "noopener,noreferrer");
  }

  function bindProfileActions(profile) {
    document.getElementById("topProfileClose")?.addEventListener("click", closeProfile);
    document.getElementById("topProfileBackdrop")?.addEventListener("click", closeProfile);

    const onKeyDown = (e) => {
      if (e.key === "Escape") closeProfile();
    };
    document.addEventListener("keydown", onKeyDown, { once: true });

    ["topProfileAvatarBtn", "topProfileTitle"].forEach((id) => {
      document.getElementById(id)?.addEventListener("click", (e) => {
        const url = e.currentTarget?.dataset?.tgUrl;
        if (url) openTelegram(url);
      });
    });

    const avatar = document.querySelector(".top-profile-avatar");
    if (avatar) {
      const sources = topProfilePhotoUrls(profile);
      let nextIndex = 0;
      const loadNext = () => {
        if (nextIndex >= sources.length) {
          avatar.onerror = null;
          return;
        }
        avatar.onerror = loadNext;
        avatar.src = sources[nextIndex];
        nextIndex += 1;
      };
      avatar.referrerPolicy = "no-referrer";
      loadNext();
    }

    document.getElementById("topProfileIdBtn")?.addEventListener("click", (e) => {
      topCopyText(e.currentTarget?.dataset?.copy, "top.idCopied");
    });
    document.getElementById("topProfileUsernameBtn")?.addEventListener("click", (e) => {
      topCopyText(e.currentTarget?.dataset?.copy, "top.usernameCopied");
    });

    WorkerDropdown.mount(document.getElementById("topProfileChartPeriod"), {
      value: profileState.chartPeriod,
      ariaLabel: WorkerI18n.t("top.chartPeriod"),
      options: [
        { value: "7d", label: WorkerI18n.t("top.period7d") },
        { value: "30d", label: WorkerI18n.t("top.period30d") },
        { value: "all", label: WorkerI18n.t("top.periodAll") },
      ],
      onChange: (value) => {
        profileState.chartPeriod = value;
        loadProfile(profile.telegramId, { keepOpen: true });
      },
    });

    WorkerCharts.renderProfitChart(document.getElementById("topProfileChart"), profile.series || [], {
      empty: WorkerI18n.t("top.chartEmpty"),
      profitLabel: WorkerI18n.t("top.chartLegendProfit"),
    });
  }

  async function loadProfile(telegramId, { keepOpen = false } = {}) {
    const drawer = document.getElementById("topProfileDrawer");
    const sheet = document.getElementById("topProfileSheet");
    if (!drawer || !sheet || !telegramId) return;

    profileState.telegramId = telegramId;
    profileState.loading = true;

    if (!keepOpen) {
      sheet.innerHTML = `<div class="top-profile-loading panel-empty">${WorkerFormat.escapeHtml(WorkerI18n.t("common.loading"))}</div>`;
      drawer.hidden = false;
      document.body.classList.add("top-profile-open");
      requestAnimationFrame(() => drawer.classList.add("is-open"));
    } else {
      const chart = document.getElementById("topProfileChart");
      if (chart) {
        chart.innerHTML = `<div class="panel-empty">${WorkerFormat.escapeHtml(WorkerI18n.t("common.loading"))}</div>`;
      }
    }

    try {
      const profile = await WorkerAPI.get(
        `/top/profile/${encodeURIComponent(telegramId)}?chartPeriod=${encodeURIComponent(profileState.chartPeriod)}`,
        { force: true }
      );
      sheet.innerHTML = renderTopProfilePanel(profile);
      bindProfileActions(profile);
    } catch (error) {
      if (window.WorkerToast) WorkerToast.error(error);
      sheet.innerHTML = renderTopEmptyState({
        kind: "error",
        title: WorkerI18n.t("top.profileErrorTitle"),
        text:
          (window.WorkerToast && WorkerToast.friendlyError(error)) ||
          error.message ||
          WorkerI18n.t("common.error"),
        actions: [
          `<button type="button" class="btn btn-ghost" id="topProfileRetry">${WorkerFormat.escapeHtml(WorkerI18n.t("common.retry"))}</button>`,
          `<button type="button" class="btn btn-primary" id="topProfileDismiss">${WorkerFormat.escapeHtml(WorkerI18n.t("common.close"))}</button>`,
        ],
      });
      document.getElementById("topProfileRetry")?.addEventListener("click", () =>
        loadProfile(telegramId, { keepOpen: true })
      );
      document.getElementById("topProfileDismiss")?.addEventListener("click", closeProfile);
    } finally {
      profileState.loading = false;
    }
  }

  function bindTopRowClicks() {
    document.querySelectorAll("[data-top-id]").forEach((node) => {
      const open = () => loadProfile(node.dataset.topId);
      node.addEventListener("click", open);
      node.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      });
    });
    document.querySelectorAll(".top-avatar-wrap img.top-avatar").forEach((img) => {
      img.addEventListener("error", () => {
        const fallback = String(img.dataset.avatarFallback || "");
        if (fallback && img.dataset.avatarFallbackTried !== "1") {
          img.dataset.avatarFallbackTried = "1";
          img.src = fallback;
          return;
        }
        img.remove();
      });
    });
  }

  async function load({ force = false } = {}) {
    const body = document.getElementById("topBody");
    try {
      const data = await WorkerAPI.get(`/top?period=${encodeURIComponent(state.period)}&limit=15`, {
        force,
      });
      if (!body) return;
      const rows = data.rows || [];
      if (!rows.length) {
        body.className = "";
        body.innerHTML = renderTopEmptyState({
          kind: "empty",
          title: WorkerI18n.t("top.emptyTitle"),
          text: WorkerI18n.t("top.emptyText"),
        });
        return;
      }
      body.className = "top-content-host";
      body.innerHTML = renderTopRows(rows);
      bindTopRowClicks();
    } catch (error) {
      if (window.WorkerToast) WorkerToast.error(error);
      if (!body) return;
      const message =
        (window.WorkerToast && WorkerToast.friendlyError(error)) ||
        error.message ||
        WorkerI18n.t("common.error");
      body.className = "";
      body.innerHTML = renderTopEmptyState({
        kind: "error",
        title: WorkerI18n.t("top.errorTitle"),
        text: message,
        actions: [
          `<button type="button" class="btn btn-ghost" id="topRetryBtn">${WorkerFormat.escapeHtml(
            WorkerI18n.t("common.retry")
          )}</button>`,
          `<button type="button" class="btn btn-primary" id="topHomeBtn">${WorkerFormat.escapeHtml(
            WorkerI18n.t("notFound.home")
          )}</button>`,
        ],
      });
      document.getElementById("topRetryBtn")?.addEventListener("click", () => load({ force: true }));
      document.getElementById("topHomeBtn")?.addEventListener("click", () => {
        document.querySelector('.nav-item[data-view="dashboard"]')?.click();
      });
    }
  }

  WorkerDropdown.mount(document.getElementById("topPeriodSelect"), {
    value: state.period,
    ariaLabel: WorkerI18n.t("top.period"),
    options: [
      { value: "24h", label: WorkerI18n.t("top.period24h") },
      { value: "7d", label: WorkerI18n.t("top.period7d") },
      { value: "30d", label: WorkerI18n.t("top.period30d") },
      { value: "all", label: WorkerI18n.t("top.periodAll") },
    ],
    onChange: (value) => {
      state.period = value;
      load({ force: true });
    },
  });

  await load({ force: !!ctx.refresh });
};
