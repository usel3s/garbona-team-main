(async function () {
  const user = await GarbonaPanelAuth.requireAuth();
  if (!user) return;

  PanelMember.mount();

  const main = document.getElementById("main");
  const pageTitle = document.getElementById("pageTitle");
  const nav = document.getElementById("nav");
  const mobileNav = document.getElementById("mobileNav");
  const mobileMore = document.getElementById("mobileMore");
  const mobileMoreSheet = document.getElementById("mobileMoreSheet");
  const SIDEBAR_STORAGE_KEY = "garbona-admin-sidebar-collapsed";
  let statsPeriod = "all";
  let adsPeriod = "all";
  let adsSelectedId = "";
  let adsPollTimer = null;
  const ADS_POLL_MS = 5000;
  let appsKind = "pending";
  let appsPage = 0;
  let payoutFilter = "open";
  let payoutOpenId = "";
  let memberAttrFilters = new Set();
  let currentView = "overview";

  const MEMBER_ATTR_FILTERS = {
    withBalance: {
      label: "С балансом",
      group: "balance",
      test: (m) => Number(m.walletUsd || 0) > 0,
    },
    noBalance: {
      label: "Без баланса",
      group: "balance",
      test: (m) => Number(m.walletUsd || 0) <= 0,
    },
    banned: {
      label: "Заблокированные",
      group: "status",
      test: (m) => Boolean(m.isBanned),
    },
    frozen: {
      label: "С заморозкой",
      test: (m) => Number(m.frozenSaleUsd || 0) > 0,
    },
    withPanel: {
      label: "С UProject",
      group: "panel",
      test: (m) => Boolean(m.panelUsername),
    },
    noPanel: {
      label: "Без UProject",
      group: "panel",
      test: (m) => !m.panelUsername,
    },
    admins: {
      label: "Админы",
      test: (m) => m.role === "admin",
    },
    moderators: {
      label: "Модераторы",
      test: (m) => Boolean(m.isModerator),
    },
  };

  function applyMemberAttrFilters(members) {
    if (!memberAttrFilters.size) return members;
    const active = [...memberAttrFilters]
      .map((key) => MEMBER_ATTR_FILTERS[key])
      .filter(Boolean);
    return members.filter((member) => active.every((def) => def.test(member)));
  }

  function toggleMemberAttrFilter(key) {
    const def = MEMBER_ATTR_FILTERS[key];
    if (!def) return;
    if (memberAttrFilters.has(key)) {
      memberAttrFilters.delete(key);
      return;
    }
    if (def.group) {
      Object.entries(MEMBER_ATTR_FILTERS).forEach(([id, item]) => {
        if (item.group === def.group) memberAttrFilters.delete(id);
      });
    }
    memberAttrFilters.add(key);
  }

  function displayName() {
    return user.firstName || user.username || user.telegramId || "Администратор";
  }

  const BRAND_ICON_URL = "/assets/logo-mark.png?v=gb4";

  function avatarUrls() {
    const candidates = [];
    const photo = String(user.photoUrl || "").trim();
    if (/^(?:https?:\/\/|\/)/i.test(photo)) candidates.push(photo);

    const username = String(user.username || "")
      .trim()
      .replace(/^@/, "");
    const telegramId = String(user.telegramId || "").trim();
    if (/^\d+$/.test(telegramId)) {
      const query = username ? `?u=${encodeURIComponent(username)}` : "";
      candidates.push(`/assets/avatar/${telegramId}${query}`);
    }

    if (/^[A-Za-z0-9_]{5,32}$/.test(username)) {
      candidates.push(`https://t.me/i/userpic/320/${username}.jpg`);
    }
    return [...new Set(candidates)];
  }

  function loadAvatar(img, candidates) {
    let nextIndex = 0;
    const loadNext = () => {
      if (nextIndex >= candidates.length) {
        img.onerror = null;
        img.removeAttribute("src");
        img.alt = "";
        return;
      }
      img.onerror = loadNext;
      img.src = candidates[nextIndex];
      nextIndex += 1;
    };
    img.referrerPolicy = "no-referrer";
    loadNext();
  }

  function applyUserIdentity() {
    const name = displayName();
    const role = user.roleLabel || "Администратор";
    const avatars = avatarUrls();
    ["userName", "mobileUserName"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = name;
    });
    ["userRole", "mobileUserRole"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = role;
    });
    ["userAvatar", "mobileUserAvatar"].forEach((id) => {
      const img = document.getElementById(id);
      if (!img) return;
      loadAvatar(img, avatars);
    });
  }

  async function logout() {
    await GarbonaPanelAuth.logout();
    location.replace("login.html");
  }

  applyUserIdentity();
  document.getElementById("logoutBtn").addEventListener("click", logout);
  document.getElementById("mobileMoreLogoutBtn")?.addEventListener("click", logout);

  GarbonaSidebar.renderSidebarNav(nav, {
    groups: AdminNav.GROUPS,
    items: AdminNav.ITEMS,
    resolveLabel: AdminNav.label,
  });
  GarbonaSidebar.renderMobileBar(mobileNav, {
    items: AdminNav.ITEMS,
    resolveLabel: AdminNav.label,
    more: {
      id: "mobileMoreBtn",
      controls: "mobileMore",
      label: "Ещё",
      icon: AdminNav.MORE_ICON,
    },
  });
  GarbonaSidebar.renderMoreSheet(document.getElementById("mobileMoreBody"), {
    groups: AdminNav.GROUPS,
    items: AdminNav.ITEMS,
    resolveLabel: AdminNav.label,
  });

  const mobileMoreBtn = document.getElementById("mobileMoreBtn");

  let sidebarCollapsed = false;
  try {
    sidebarCollapsed = localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
  } catch (_) {}

  GarbonaSidebar.createController({
    sidebar: document.getElementById("sidebar"),
    rail: document.getElementById("sidebarRail"),
    toggleButton: document.getElementById("sidebarCollapse"),
    isCollapsed: () => sidebarCollapsed,
    setCollapsed(next) {
      sidebarCollapsed = next;
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "1" : "0");
      } catch (_) {}
    },
    labels: { collapse: "Свернуть меню", expand: "Развернуть меню" },
  });

  const workspaceSwitcher = GarbonaSidebar.createWorkspaceSwitcher({
    mount: document.getElementById("workspaceSwitcher"),
    iconUrl: BRAND_ICON_URL,
    currentId: "admin",
    labels: { switcher: "Вид панели", development: "В разработке" },
  });
  workspaceSwitcher.setWorkspaces(GarbonaPanelAuth.session()?.workspaces || []);

  const moreSheet = GarbonaSidebar.createMobileSheet({
    root: mobileMore,
    sheet: mobileMoreSheet,
    trigger: mobileMoreBtn,
  });

  function syncNav(viewId) {
    GarbonaSidebar.syncActive(viewId, {
      primaryIds: AdminNav.primaryIds,
      moreButton: mobileMoreBtn,
    });
  }

  nav.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-view]");
    if (btn) showView(btn.dataset.view, { historyMode: "push" });
  });

  mobileNav.addEventListener("click", (e) => {
    const btn = e.target.closest(".mobile-nav-item");
    if (!btn) return;
    if (btn.dataset.menu === "more") {
      moreSheet.setOpen(!moreSheet.isOpen());
      return;
    }
    if (btn.dataset.view) showView(btn.dataset.view, { historyMode: "push" });
  });

  mobileMoreSheet.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-view]");
    if (btn) showView(btn.dataset.view, { historyMode: "push" });
  });
  document.getElementById("mobileMoreBackdrop").addEventListener("click", () => {
    moreSheet.setOpen(false);
  });
  document.getElementById("mobileMoreClose").addEventListener("click", () => {
    moreSheet.setOpen(false);
  });

  function toast(msg, type) {
    PanelMember.toast(msg, type);
  }

  function downloadText(filename, text, type = "text/plain;charset=utf-8") {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function debounce(fn, ms) {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  }

  function enhanceClickableRows(root = main) {
    root.querySelectorAll(".clickable-row").forEach((row) => {
      if (row.dataset.keyboardReady === "true") return;
      row.dataset.keyboardReady = "true";
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (event.target.closest("button, a, input, select, textarea")) return;
        event.preventDefault();
        row.click();
      });
    });
  }

  function askMafileAmountDialog({
    sourceId = "",
    title,
    hint,
    submitLabel,
    defaultAmount = 0,
  }) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "mafile-dialog-backdrop";
      overlay.innerHTML = `<form class="mafile-dialog">
        <div class="mafile-dialog-kicker">MaFile #${escapeHtml(sourceId)}</div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(hint)}</p>
        <label>Сумма, USD<input class="settings-input" name="amount" type="number" min="0.01" step="0.01" value="${Number(defaultAmount || 0).toFixed(2)}" required /></label>
        <label class="mafile-dialog-check">
          <input type="checkbox" name="skipCredit" />
          <span>Не начислять профит — уже начислен через карточку</span>
        </label>
        <div class="mafile-dialog-actions"><button type="button" class="btn-ghost" data-cancel>Отмена</button><button type="submit" class="btn-primary">${escapeHtml(submitLabel)}</button></div>
      </form>`;
      document.body.appendChild(overlay);
      const input = overlay.querySelector("[name=amount]");
      const skipInput = overlay.querySelector("[name=skipCredit]");
      setTimeout(() => { input.focus(); input.select(); }, 0);
      const finish = (value) => { overlay.remove(); resolve(value); };
      overlay.querySelector("[data-cancel]").addEventListener("click", () => finish(null));
      overlay.addEventListener("click", (event) => { if (event.target === overlay) finish(null); });
      overlay.querySelector("form").addEventListener("submit", (event) => {
        event.preventDefault();
        const amount = Number(input.value);
        if (!Number.isFinite(amount) || amount <= 0) return;
        finish({ amount, skipCredit: Boolean(skipInput?.checked) });
      });
    });
  }

  const mainObserver = new MutationObserver(() => enhanceClickableRows());
  mainObserver.observe(main, { childList: true, subtree: true });
  main.setAttribute("aria-live", "polite");

  async function showView(id, { historyMode = "replace", payoutId } = {}) {
    const viewId = AdminNav.byId.has(id) ? id : "overview";
    if (viewId !== "ads") stopAdsLiveRefresh();
    currentView = viewId;
    if (viewId === "payouts") {
      if (payoutId !== undefined) payoutOpenId = String(payoutId || "");
      else if (historyMode === "push") payoutOpenId = "";
    } else {
      payoutOpenId = "";
    }
    const title = AdminNav.title(viewId);

    syncNav(viewId);
    pageTitle.textContent = title;
    document.title = `${title} — Garbona Admin`;
    moreSheet.setOpen(false, { restoreFocus: false });
    closeAllLotMenus();

    const hash = viewId === "payouts" && /^[a-f0-9]{24}$/i.test(payoutOpenId)
      ? `#payouts/${payoutOpenId}`
      : `#${viewId}`;
    if (historyMode === "push" && location.hash !== hash) {
      history.pushState({ view: viewId }, "", hash);
    } else if (historyMode === "replace" && location.hash !== hash) {
      history.replaceState({ view: viewId }, "", hash);
    }
    main.setAttribute("aria-busy", "true");
    main.innerHTML = `
      <div class="loading-state" role="status">
        <div class="loading-state-inner">
          <span class="loading-spinner" aria-hidden="true"></span>
          <span>Загрузка раздела…</span>
        </div>
      </div>`;
    main.scrollTop = 0;
    window.scrollTo({ top: 0, behavior: "auto" });
    try {
      if (viewId === "overview") await renderOverview();
      else if (viewId === "logs") await renderOverview({ logsOnly: true });
      else if (viewId === "users") await renderUsers();
      else if (viewId === "admins") await renderAdmins();
      else if (viewId === "stats") await renderStats();
      else if (viewId === "ads") await renderAds();
      else if (viewId === "economy") await renderEconomy();
      else if (viewId === "sites") await renderSites();
      else if (viewId === "templates") await renderTemplates();
      else if (viewId === "apps") await renderApps();
      else if (viewId === "comms") await renderComms();
      else if (viewId === "payouts") await renderPayouts();
      else if (viewId === "steam") await renderSteam();
      else if (viewId === "autosales") await renderAutoSales();
      else if (viewId === "botlogs") await renderBotLogs();
    } catch (e) {
      main.innerHTML = `
        <div class="panel-card">
          <div class="empty" role="alert">
            <div class="empty-title">Не удалось загрузить раздел</div>
            <div class="empty-sub">${escapeHtml(e.message || "Неизвестная ошибка")}</div>
          </div>
        </div>`;
    } finally {
      main.setAttribute("aria-busy", "false");
      enhanceClickableRows();
    }
  }

  async function openMember(telegramId) {
    const data = await PanelAPI.get(`/admin/members/${telegramId}`);
    PanelMember.open(data.member, {
      onUpdated: () => {
        if (location.hash === "#users") renderUsers();
        if (location.hash === "#stats") renderStats();
      },
    });
  }

  async function renderOverviewLegacy() {
    const [data, mafileData] = await Promise.all([
      PanelAPI.get("/admin/overview"),
      PanelAPI.get("/admin/mafiles?limit=50"),
    ]);
    const k = data.kpi;
    const mf = data.mafiles || { statuses: {}, total: 0, inventoryDisplay: "$0.00", withdrawnDisplay: "$0.00" };
    main.innerHTML = `
      <div class="greeting">
        <div>
          <h1 class="greeting-title">Добро пожаловать, <em>${escapeHtml(
            user.firstName || user.username || "admin"
          )}</em></h1>
          <p class="greeting-sub">Сводка Garbona · глобальный % ${data.globalPercent}</p>
        </div>
        <button type="button" class="btn-primary" data-goto="users">Участники</button>
      </div>
      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-label">В команде</div>
          <div class="stat-value">${k.teamCount}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Заявки в очереди</div>
          <div class="stat-value">${k.pendingApps}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Поступления за 24ч</div>
          <div class="stat-value">${escapeHtml(k.arrivals24hDisplay || "$0.00")} · ${Number(k.arrivals24hCount || 0)}</div>
          <div class="stat-hint ${k.arrivalsValueDeltaPct > 0 ? "up" : k.arrivalsValueDeltaPct < 0 ? "down" : ""}">
            ${escapeHtml(k.arrivals24hSummary || "0 поступлений")}${k.arrivalsYesterdayCount != null ? ` · вчера ${Number(k.arrivalsYesterdayCount || 0)} · ${escapeHtml(k.arrivalsYesterdayDisplay || "$0.00")}` : ""}
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Выводы</div>
          <div class="stat-value">${k.pendingPayouts}</div>
          <div class="stat-hint">на модерации</div>
        </div>
      </div>
      <div class="mafile-overview-grid">
        <div class="kpi-chart-card mafile-donut-card">
          <div class="kpi-chart-head">
            <div>
              <div class="kpi-chart-label">Статусы MaFile</div>
              <div class="mafile-chart-sub">Наведите на сектор для подробностей</div>
            </div>
            <div class="kpi-chart-value">${mf.total || 0}</div>
          </div>
          <div id="mafileDonut"></div>
        </div>
        <div class="mafile-summary-card">
          <div class="mafile-summary-label">Инвентарь MaFile</div>
          <div class="mafile-summary-value">${escapeHtml(mf.inventoryDisplay || "$0.00")}</div>
          <div class="mafile-summary-divider"></div>
          <div class="mafile-summary-row"><span>Успешно снято</span><strong>${escapeHtml(mf.withdrawnDisplay || "$0.00")}</strong></div>
          <div class="mafile-summary-row"><span>Продано</span><strong>${escapeHtml(mf.soldDisplay || "$0.00")}</strong></div>
          <div class="mafile-summary-row"><span>Ожидают решения</span><strong>${Number(mf.statuses?.pending || 0)}</strong></div>
        </div>
      </div>
      <div class="panel-card mafile-table-card">
        <div class="panel-card-head mafile-table-head">
          <div>
            <h2 class="panel-card-title">Логи MaFile</h2>
            <p class="mafile-chart-sub">Управление статусами и суммой снятия</p>
          </div>
          <div class="mafile-table-tools">
            <input class="search-input" id="mafileSearch" type="search" placeholder="ID, аккаунт или воркер" />
            <select class="settings-input mafile-status-filter" id="mafileStatusFilter">
              <option value="">Все статусы</option>
              <option value="pending">В ожидании</option>
              <option value="withdrawn">Снят</option>
              <option value="sold">Продан</option>
              <option value="invalid">Невалид</option>
            </select>
          </div>
        </div>
        <div class="panel-card-body mafile-table-body">
          <div class="table-wrap">
            <table class="data mafile-data-table">
              <thead><tr><th>ID</th><th>Дата</th><th>Аккаунт</th><th>Стоимость</th><th>Статус</th><th aria-label="Действия"></th></tr></thead>
              <tbody id="mafileRows"></tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    main.querySelector("[data-goto]")?.addEventListener("click", () => showView("users", { historyMode: "push" }));
    PanelCharts.renderDonutChart(document.getElementById("mafileDonut"), [
      { label: "В ожидании", value: Number(mf.statuses?.pending || 0), color: "#f2b84b", detail: `${Number(mf.statuses?.pending || 0)} ожидают снятия` },
      { label: "Успешно снят", value: Number(mf.statuses?.withdrawn || 0), color: "#48c78e", detail: `${Number(mf.statuses?.withdrawn || 0)} успешно обработано · ${mf.withdrawnDisplay || "$0.00"}` },
      { label: "Продан", value: Number(mf.statuses?.sold || 0), color: "#7aa2f7", detail: `${Number(mf.statuses?.sold || 0)} продано · ${mf.soldDisplay || "$0.00"}` },
      { label: "Невалид", value: Number(mf.statuses?.invalid || 0), color: "#ee6677", detail: `${Number(mf.statuses?.invalid || 0)} не удалось снять` },
    ], { centerLabel: "MaFile", ariaLabel: "Распределение MaFile по статусам" });

    const rowsBody = document.getElementById("mafileRows");
    let currentRows = Array.isArray(mafileData?.rows) ? mafileData.rows : [];

    function statusBadge(row) {
      const cls = row.status === "withdrawn" || row.status === "sold" ? "ok" : row.status === "invalid" ? "bad" : "wait";
      return `<span class="badge ${cls}">${escapeHtml(row.statusLabel || "В ожидании снятия")}</span>`;
    }

    function dateTime(value) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "—";
      return date.toLocaleString("ru-RU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    }

    function renderMafileRows(rows) {
      rowsBody.innerHTML = "";
      if (!rows.length) {
        rowsBody.innerHTML = `<tr><td colspan="6" class="muted">MaFile не найдены</td></tr>`;
        return;
      }
      rows.forEach((row) => {
        const tr = document.createElement("tr");
        const ownerName = row.fakeTag
          ? `#${escapeHtml(row.fakeTag)}`
          : (row.owner?.firstName || (row.owner?.username ? `@${row.owner.username}` : row.ownerTelegramId || "—"));
        const account = row.accountUsername || row.steamId || "—";
        tr.innerHTML = `
          <td><strong>#${escapeHtml(row.sourceId)}</strong>${row.isFake ? '<small class="badge wait">фейк</small>' : ""}<small>${escapeHtml(row.fakeTag ? `#${row.fakeTag}` : (row.owner?.username ? `@${row.owner.username}` : ""))}</small></td>
          <td class="muted">${escapeHtml(dateTime(row.createdAt))}</td>
          <td><strong>${escapeHtml(account)}</strong><small>${escapeHtml(ownerName)} · ID ${escapeHtml(row.fakeTag ? "Аноним" : (row.ownerTelegramId || "—"))}</small></td>
          <td><strong>$${Number(row.totalProfit || 0).toFixed(2)}</strong><small>инв. $${Number(row.inventoryUsd || 0).toFixed(2)}</small></td>
          <td>${statusBadge(row)}</td>
          <td class="mafile-action-cell">
            <button type="button" class="mafile-menu-btn" data-menu-id="${escapeHtml(row.sourceId)}" aria-label="Управление MaFile">•••</button>
            <div class="mafile-status-menu" data-status-menu="${escapeHtml(row.sourceId)}" hidden>
              <div class="mafile-status-menu-title">Статус</div>
              <button type="button" data-set-status="pending">В ожидании снятия</button>
              <button type="button" data-set-status="withdrawn">Успешно снят</button>
              <button type="button" data-set-status="sold">Продан</button>
              <button type="button" data-set-status="invalid">Невалид</button>
            </div>
          </td>`;
        rowsBody.appendChild(tr);
      });
    }

    function askWithdrawnAmount(row) {
      return askMafileAmountDialog({
        sourceId: row.sourceId,
        title: "Сумма успешного снятия",
        hint: "Укажите сумму, которую фактически получил воркер.",
        submitLabel: "Сохранить",
        defaultAmount: Number(row.withdrawnAmount || 0),
      });
    }

    function askSoldAmount(row) {
      return askMafileAmountDialog({
        sourceId: row.sourceId || row.id || "",
        title: "Сумма продажи",
        hint: "Воркеру начислится его процент от этой суммы, если не отметить «уже начислен».",
        submitLabel: "Продать и начислить",
        defaultAmount: Number(row.withdrawnAmount || row.localMafile?.withdrawnAmount || row.totalProfit || row.totalUsd || 0),
      });
    }

    async function setMafileStatus(row, status) {
      let amount = 0;
      let skipCredit = false;
      if (status === "withdrawn") {
        const picked = await askWithdrawnAmount(row);
        if (!picked) return;
        amount = picked.amount;
        skipCredit = picked.skipCredit;
      }
      if (status === "sold") {
        const picked = await askSoldAmount(row);
        if (!picked) return;
        amount = picked.amount;
        skipCredit = picked.skipCredit;
      }
      try {
        const result = await PanelAPI.patch(`/admin/mafiles/${encodeURIComponent(row.sourceId)}/status`, { status, amount, skipCredit });
        const soldHint = !skipCredit && (status === "sold" || status === "withdrawn") && Number(result.workerShare || 0) > 0
          ? ` · воркеру ${Number(result.workerPercent || 70)}% $${Number(result.workerShare).toFixed(2)}`
          : skipCredit && (status === "sold" || status === "withdrawn")
            ? " · без начисления"
            : "";
        toast(result.telegramUpdated ? `Статус сохранён, пост в Telegram обновлён${soldHint}` : `Статус сохранён${soldHint}`, "success");
        PanelAPI.bust("/admin/overview");
        PanelAPI.bust("/admin/mafiles");
        await renderOverview();
      } catch (error) {
        toast(error.message, "error");
      }
    }

    rowsBody.addEventListener("click", async (event) => {
      const menuBtn = event.target.closest("[data-menu-id]");
      if (menuBtn) {
        const menu = rowsBody.querySelector(`[data-status-menu="${CSS.escape(menuBtn.dataset.menuId)}"]`);
        rowsBody.querySelectorAll("[data-status-menu]").forEach((item) => { if (item !== menu) item.hidden = true; });
        menu.hidden = !menu.hidden;
        return;
      }
      const statusBtn = event.target.closest("[data-set-status]");
      if (!statusBtn) return;
      const menu = statusBtn.closest("[data-status-menu]");
      const row = currentRows.find((item) => String(item.sourceId) === String(menu.dataset.statusMenu));
      if (row) await setMafileStatus(row, statusBtn.dataset.setStatus);
    });

    async function loadMafileRows() {
      const q = document.getElementById("mafileSearch").value.trim();
      const status = document.getElementById("mafileStatusFilter").value;
      const path = `/admin/mafiles?limit=50${q ? `&q=${encodeURIComponent(q)}` : ""}${status ? `&status=${encodeURIComponent(status)}` : ""}`;
      const result = await PanelAPI.get(path, { force: true });
      currentRows = Array.isArray(result?.rows) ? result.rows : [];
      renderMafileRows(currentRows);
    }
    renderMafileRows(currentRows);
    document.getElementById("mafileSearch").addEventListener("input", () => {
      clearTimeout(renderOverview._mafileSearchTimer);
      renderOverview._mafileSearchTimer = setTimeout(loadMafileRows, 250);
    });
    document.getElementById("mafileStatusFilter").addEventListener("change", loadMafileRows);
  }

  async function renderOverview(options = {}) {
    const logsOnly = options.logsOnly === true;
    const state = {
      page: 0,
      rows: [],
      selected: new Set(),
      filters: {
        search: "", status: [], period: "all", mafile: "", prime: "", unlocked: "", mafileUnlocked: "", steamLimit: "",
        levelFrom: "", levelTo: "", balanceFrom: "", balanceTo: "", invFrom: "", invTo: "",
        eloFrom: "", eloTo: "", games: "", workers: "",
      },
      pageCount: 1,
      totalCount: 0,
      availableStatuses: [],
    };

    const STATUS_META = {
      Ok: ["Валид", "valid"], Invalid: ["Невалид", "invalid"], InvalidSession: ["Сессия невалидна", "invalid"],
      Processing: ["На снятии", "processing"], OnProcessing: ["В обработке", "processing"], Empty: ["Пустой", "muted"],
      MaFile: ["MaFile", "mafile"], Sold: ["Продан", "sold"], OnHandle: ["Обрабатывается", "processing"],
      OnSell: ["На продаже", "sell"], OnHold: ["На удержании", "wait"], Processed: ["Обработан", "valid"],
      InvalidRCode: ["Неверный RCode", "invalid"], Locked: ["Заблокирован", "invalid"], Restored: ["Восстановлен", "valid"],
      Converted: ["Конвертирован", "converted"], RedLocked: ["КТ", "locked"],
    };
    const TASK_META = {
      CheckValid: ["Проверить на валид", "Проверка на валид"],
      UnlockRed: ["Снять КТ", "Снятие КТ"],
      GetMail: ["Письмо с почты", "Получение письма"],
      SellLZT: ["Продать", "Продажа на маркет"],
      MaFileLock: ["Отправить запрос на КТ", "Запрос на КТ"],
      MaFileToLog: ["Конвертировать в лог", "MaFile в лог"],
    };

    function statusBadge(status) {
      const meta = STATUS_META[status] || [status || "—", "muted"];
      return `<span class="sc-status sc-status--${meta[1]}"><i></i>${escapeHtml(meta[0])}</span>`;
    }

    function money(value) {
      return `$${Math.max(0, Number(value) || 0).toFixed(2)}`;
    }

    function dateParts(value) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return ["—", ""];
      return [
        date.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).replace(" г.", ""),
        date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      ];
    }

    function icon(name) {
      const paths = {
        logs: '<path d="M4 5h16M4 12h16M4 19h10"/>',
        search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
        filter: '<path d="M4 5h16l-6 7v6l-4 2v-8z"/>',
        refresh: '<path d="M20 6v5h-5M4 18v-5h5"/><path d="M18 9a7 7 0 0 0-12-2M6 15a7 7 0 0 0 12 2"/>',
        copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
      };
      return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.logs}</svg>`;
    }

    function filterValuesEmpty(key, value) {
      if (key === "period") return !value || value === "all";
      if (key === "status") return !Array.isArray(value) || value.length === 0;
      return value === "";
    }

    function getChoiceValues(field) {
      const value = state.filters[field];
      return Array.isArray(value) ? value : (value ? [value] : []);
    }

    function queryPath() {
      const params = new URLSearchParams({ page: String(state.page), limit: "50" });
      const f = state.filters;
      if (f.search) params.set("search", f.search);
      const statuses = getChoiceValues("status");
      if (statuses.length) params.set("statuses", statuses.join(","));
      if (f.period && f.period !== "all") params.set("period", f.period);
      if (f.mafile !== "") params.set("mafile_only", f.mafile);
      if (f.prime !== "") params.set("is_prime", f.prime);
      if (f.unlocked !== "") params.set("unlocked", f.unlocked);
      if (f.mafileUnlocked !== "") params.set("mafile_unlocked", f.mafileUnlocked);
      if (f.steamLimit !== "") params.set("steam_limit", f.steamLimit);
      if (f.levelFrom !== "") params.set("level_from", f.levelFrom);
      if (f.levelTo !== "") params.set("level_to", f.levelTo);
      if (f.balanceFrom !== "") params.set("balance_from", f.balanceFrom);
      if (f.balanceTo !== "") params.set("balance_to", f.balanceTo);
      if (f.invFrom !== "") params.set("inv_from", f.invFrom);
      if (f.invTo !== "") params.set("inv_to", f.invTo);
      if (f.eloFrom !== "") params.set("elo_from", f.eloFrom);
      if (f.eloTo !== "") params.set("elo_to", f.eloTo);
      if (f.games) params.set("games", f.games);
      if (f.workers) params.set("workers", f.workers);
      return `/admin/steam-control/accounts?${params}`;
    }

    function gamesHtml(row) {
      const games = Array.isArray(row.gamesInfo) ? row.gamesInfo.slice(0, 5) : [];
      const vacs = Array.isArray(row.steamInfo?.vacBans) ? row.steamInfo.vacBans.map(Number) : [];
      if (!games.length && !Number(row.gamesCount || 0)) return '<span class="sc-empty">—</span>';
      const icons = games.map((game) => {
        const src = game.icon ? `https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/${encodeURIComponent(game.appid)}/${encodeURIComponent(game.icon)}.jpg` : "";
        const vac = vacs.includes(Number(game.appid));
        const title = `${game.name || "Игра"}${vac ? " [VAC]" : ""}`;
        return src
          ? `<img src="${src}" alt="" title="${escapeHtml(title)}" loading="lazy" class="${vac ? "is-vac" : ""}" />`
          : "";
      }).join("");
      return `<button type="button" class="sc-entity sc-games" data-entity="games" aria-label="Игры">${icons || '<span class="sc-empty">игры</span>'}</button>`;
    }

    function moneyParts(row) {
      const inv = row.inventory?.price || {};
      const tradable = Number(inv.tradable ?? inv.total ?? row.inventoryUsd ?? 0) || 0;
      const marketable = Number(inv.marketable ?? tradable) || 0;
      const locked = Number(inv.locked ?? inv.hold ?? 0) || 0;
      const balanceUsd = Number(row.steamInfo?.balanceUsd || 0) || 0;
      const balance = Number(row.steamInfo?.balance || balanceUsd) || 0;
      const currency = String(row.steamInfo?.balanceCurrency || "USD");
      return { tradable, marketable, locked, balanceUsd, balance, currency, total: Number(row.totalUsd || tradable + balanceUsd) || 0 };
    }

    function rowMenu(row) {
      const invalid = row.status === "Invalid";
      return `<div class="sc-menu" data-sc-menu="${escapeHtml(row.id)}" hidden>
        <div class="sc-menu-title">Управление логом</div>
        <button data-task="CheckValid" ${invalid ? "disabled" : ""}>Проверить на валид</button>
        <button data-task="UnlockRed" ${row.isMaFile ? "disabled" : ""}>Снять КТ</button>
        <button data-task="GetMail" ${row.isMaFile ? "disabled" : ""}>Письмо с почты</button>
        <div class="sc-menu-sep"></div>
        <button data-task="SellLZT" ${invalid || row.isMaFile ? "disabled" : ""}>Продать</button>
        <button data-action="export">Экспорт</button>
        ${row.isMaFile ? `<div class="sc-menu-sep"></div>
          <button data-task="MaFileLock">Отправить запрос на КТ</button>
          <button data-action="download-mafile">Скачать .maFile</button>
          <button data-action="two-factor">Steam Authenticator</button>
          <button data-task="MaFileToLog">Конвертировать в лог</button>` : ""}
        <div class="sc-menu-sep"></div>
        <details class="sc-menu-status sc-menu-telegram"><summary>Telegram <span>›</span></summary><div>
          <button data-telegram-target="profit">Отправить в профит</button>
          <button data-telegram-target="worker">Отправить воркеру</button>
          <button data-telegram-target="chat">Отправить в чат</button>
        </div></details>
        ${row.localMafile ? `<div class="sc-menu-sep"></div>
        <details class="sc-menu-status" open><summary>Статус снятия Garbona <span>›</span></summary><div>
          <button data-garbona-status="pending" class="${(row.localMafile.status || "pending") === "pending" ? "is-current" : ""}">В ожидании снятия${(row.localMafile.status || "pending") === "pending" ? " · текущий" : ""}</button>
          <button data-garbona-status="withdrawn" class="${row.localMafile.status === "withdrawn" ? "is-current" : ""}">Успешно снят${row.localMafile.status === "withdrawn" ? " · текущий" : ""}</button>
          <button data-garbona-status="sold" class="${row.localMafile.status === "sold" ? "is-current" : ""}">Продан${row.localMafile.status === "sold" ? " · текущий" : ""}</button>
          <button data-garbona-status="invalid" class="${row.localMafile.status === "invalid" ? "is-current" : ""}">Невалид${row.localMafile.status === "invalid" ? " · текущий" : ""}</button>
        </div></details>` : ""}
        <div class="sc-menu-sep"></div>
        <details class="sc-menu-status"><summary>Статус UProject <span>›</span></summary><div>
          ${Object.entries(STATUS_META).map(([value, meta]) => `<button data-set-status="${value}" class="${row.status === value ? "is-current" : ""}">${escapeHtml(meta[0])}${row.status === value ? " · текущий" : ""}</button>`).join("")}
        </div></details>
        <div class="sc-menu-sep"></div>
        <button data-action="details">Полная карточка</button>
      </div>`;
    }

    function renderRows() {
      const body = document.getElementById("scRows");
      if (!body) return;
      if (!state.rows.length) {
        body.innerHTML = '<tr><td colspan="10"><div class="sc-zero">По выбранным фильтрам логов нет</div></td></tr>';
        return;
      }
      body.innerHTML = state.rows.map((row) => {
        const [day, time] = dateParts(row.createdAt);
        const steam = row.steamInfo || {};
        const worker = row.owner?.username || "—";
        const credentials = `${row.username || "—"}${row.password ? `:${row.password}` : ""}`;
        const checked = state.selected.has(String(row.id));
        const local = row.localMafile ? `<small class="sc-local-state">Garbona: ${escapeHtml(row.localMafile.status === "withdrawn" ? `снят ${money(row.localMafile.withdrawnAmount)}` : row.localMafile.status === "sold" ? `продан ${money(row.localMafile.withdrawnAmount)} · воркеру ${money(row.localMafile.workerShare || 0)}` : row.localMafile.status === "invalid" ? "невалид" : "ожидает снятия")}</small>` : "";
        const session = row.mafileSessionLabel
          ? `<small class="sc-mafile-session ${row.mafileSessionUnlocked ? "is-ready" : "is-wait"}">Сессия: ${escapeHtml(row.mafileSessionLabel)}</small>`
          : "";
        return `<tr data-row-id="${escapeHtml(row.id)}">
          <td class="sc-check"><input type="checkbox" data-select-row value="${escapeHtml(row.id)}" ${checked ? "checked" : ""} aria-label="Выбрать лог ${escapeHtml(row.id)}" /></td>
          <td><button class="sc-id" data-action="details">${escapeHtml(row.id)}</button>${worker !== "—" ? `<button type="button" class="sc-entity sc-worker" data-entity="worker">${escapeHtml(worker)}</button>` : `<small>${escapeHtml(worker)}</small>`}</td>
          <td><span>${escapeHtml(day)}</span><small>${escapeHtml(time)}</small></td>
          <td><div class="sc-account">
            ${row.avatarUrl ? `<a href="${escapeHtml(row.profileUrl)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(row.avatarUrl)}" alt="" /></a>` : '<span class="sc-avatar-fallback">S</span>'}
            <div><b>${escapeHtml(steam.country || "—")} · ${escapeHtml(steam.level ?? "—")} LVL</b><small>${escapeHtml(steam.nickname || row.steamId || "—")}</small>
            <button class="sc-account-tag ${row.accountTag ? "has-tag" : "is-empty"}" data-account-tag title="${row.accountTag ? "Изменить метку аккаунта" : "Добавить метку аккаунта"}">${escapeHtml(row.accountTag || "+")}</button></div>
          </div></td>
          <td>${gamesHtml(row)}</td>
          <td><button type="button" class="sc-entity sc-price-btn" data-entity="price" aria-label="Цена"><b class="sc-price">${money(row.totalUsd)}</b><small data-entity="inventory">инв. ${money(row.inventoryUsd)}</small></button></td>
          <td>${row.CS2Info?.elo ? `<b>${Number(row.CS2Info.elo).toLocaleString("ru-RU")}</b>` : '<span class="sc-empty">—</span>'}</td>
          <td><button class="sc-credentials" data-copy="${escapeHtml(credentials)}" title="Скопировать">${escapeHtml(credentials)} ${icon("copy")}</button></td>
          <td>${statusBadge(row.status)}${session}${local}</td>
          <td class="sc-actions"><button class="sc-more" data-toggle-menu aria-label="Управление логом">•••</button>${rowMenu(row)}</td>
        </tr>`;
      }).join("");
      syncBulkBar();
    }

    function renderPagination() {
      const box = document.getElementById("scPagination");
      if (!box) return;
      box.innerHTML = `<button data-page="${state.page - 1}" ${state.page <= 0 ? "disabled" : ""}>‹</button>
        <span>Страница <b>${state.page + 1}</b> из <b>${Math.max(1, state.pageCount)}</b></span>
        <button data-page="${state.page + 1}" ${state.page + 1 >= state.pageCount ? "disabled" : ""}>›</button>`;
    }

    function syncBulkBar() {
      const bar = document.getElementById("scBulkBar");
      const count = document.getElementById("scSelectedCount");
      if (!bar || !count) return;
      count.textContent = state.selected.size;
      bar.hidden = state.selected.size === 0;
      const all = document.getElementById("scSelectAll");
      if (all) all.checked = state.rows.length > 0 && state.rows.every((row) => state.selected.has(String(row.id)));
    }

    function closeMenus() {
      document.querySelectorAll("[data-sc-menu]").forEach((menu) => {
        menu.hidden = true;
        menu.classList.remove("is-fixed");
        menu.style.top = "";
        menu.style.left = "";
        menu.style.right = "";
        menu.style.bottom = "";
        menu.style.maxHeight = "";
        menu.style.zIndex = "";
        menu.onclick = null;
        const hostId = String(menu.dataset.scMenu || "");
        const host = hostId
          ? document.querySelector(`[data-row-id="${CSS.escape(hostId)}"] .sc-actions`)
          : null;
        if (host && menu.parentElement !== host) host.appendChild(menu);
      });
    }

    function openRowMenu(toggle, menu) {
      closeMenus();
      const rowId = String(menu.dataset.scMenu || "");
      // Portal to body: .shell overflow-x:clip / .admin-logs isolation clip fixed menus inside the table.
      document.body.appendChild(menu);
      menu.hidden = false;
      menu.classList.add("is-fixed");
      menu.style.zIndex = "10000";

      const btn = toggle.getBoundingClientRect();
      const pad = 10;
      const mw = Math.max(menu.offsetWidth || 238, 220);
      let mh = menu.offsetHeight || 360;
      const spaceBelow = window.innerHeight - btn.bottom - pad;
      const spaceAbove = btn.top - pad;
      const openUp = spaceBelow < Math.min(mh, 280) && spaceAbove > spaceBelow;
      const maxH = Math.max(160, openUp ? spaceAbove - 6 : spaceBelow - 6);
      menu.style.maxHeight = `${Math.min(mh, maxH)}px`;
      mh = Math.min(menu.offsetHeight || mh, maxH);

      let top = openUp ? btn.top - mh - 6 : btn.bottom + 6;
      let left = btn.right - mw;
      left = Math.min(Math.max(pad, left), window.innerWidth - mw - pad);
      top = Math.min(Math.max(pad, top), window.innerHeight - Math.min(mh, maxH) - pad);

      menu.style.top = `${Math.round(top)}px`;
      menu.style.left = `${Math.round(left)}px`;
      menu.style.right = "auto";
      menu.style.bottom = "auto";

      // Clicks no longer bubble through the table row once the menu is portaled.
      menu.onclick = async (event) => {
        const row = state.rows.find((item) => String(item.id) === rowId);
        if (!row) return;
        if (event.target.closest("summary, details.sc-menu-status")) {
          // Allow native <details> expand/collapse without closing.
          if (!event.target.closest("[data-action], [data-task], [data-set-status], [data-telegram-target], [data-garbona-status]")) {
            return;
          }
        }
        const garbonaStatusBtn = event.target.closest("[data-garbona-status]");
        if (garbonaStatusBtn) {
          closeMenus();
          await setLocalMafileStatus(row, garbonaStatusBtn.dataset.garbonaStatus);
          return;
        }
        const actionEl = event.target.closest(
          "[data-action], [data-task], [data-set-status], [data-telegram-target]"
        );
        if (!actionEl) return;
        closeMenus();
        await handleRowAction(
          row,
          actionEl.dataset.action,
          actionEl.dataset.task,
          actionEl.dataset.setStatus,
          actionEl.dataset.telegramTarget
        );
      };
    }

    function downloadText(filename, text, type = "text/plain;charset=utf-8") {
      const url = URL.createObjectURL(new Blob([text], { type }));
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function showDialog(content, className = "") {
      const overlay = document.createElement("div");
      overlay.className = "sc-dialog-backdrop";
      overlay.innerHTML = `<section class="sc-dialog ${className}" role="dialog" aria-modal="true">${content}<button class="sc-dialog-close" data-dialog-close aria-label="Закрыть">×</button></section>`;
      document.body.appendChild(overlay);
      const onKey = (event) => { if (event.key === "Escape") close(); };
      const close = () => {
        document.removeEventListener("keydown", onKey);
        overlay.remove();
      };
      overlay.addEventListener("click", (event) => { if (event.target === overlay || event.target.closest("[data-dialog-close]")) close(); });
      document.addEventListener("keydown", onKey);
      return { overlay, close };
    }

    function gameIconSrc(game) {
      const appid = Number(game?.appid || 0);
      const icon = String(game?.icon || game?.img_icon_url || "").trim();
      if (appid && icon) return `https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/${appid}/${icon}.jpg`;
      if (appid) return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/capsule_231x87.jpg`;
      return "";
    }

    function itemIconSrc(item) {
      const raw = String(item?.icon || item?.iconUrl || item?.icon_url || item?.image || "").trim();
      if (/^https?:\/\//i.test(raw)) return raw;
      if (raw) return `https://community.cloudflare.steamstatic.com/economy/image/${raw}`;
      return "";
    }

    function playtimeLabel(minutes) {
      const n = Number(minutes) || 0;
      if (n <= 0) return "нет наигранного";
      if (n < 60) return `${n} мин`;
      return `${(n / 60).toFixed(n >= 600 ? 0 : 1)} ч`;
    }

    function flattenInventory(inventory) {
      const groups = Array.isArray(inventory?.inventories) ? inventory.inventories : [];
      if (groups.length) {
        return groups.map((group) => ({
          appid: Number(group.appid || group.appId || 0) || 0,
          name: String(group.name || group.gameName || (group.appid ? `App ${group.appid}` : "Steam")),
          items: Array.isArray(group.items) ? group.items : [],
          totalUsd: Number(group.price?.tradable ?? group.total ?? group.totalUsd ?? 0) || 0,
        }));
      }
      const items = Array.isArray(inventory?.items) ? inventory.items : [];
      return items.length ? [{ appid: 0, name: "Steam", items, totalUsd: Number(inventory?.price?.tradable || 0) || 0 }] : [];
    }

    async function openGamesModal(row) {
      const steam = row.steamInfo || {};
      const dialog = showDialog('<div class="sc-loading">Загружаю игры…</div>', "sc-dialog--entity");
      try {
        const data = await PanelAPI.get(`/admin/steam-control/accounts/${encodeURIComponent(row.id)}/games`, { force: true });
        const games = Array.isArray(data?.gamesInfo) ? data.gamesInfo : Array.isArray(data?.games) ? data.games : Array.isArray(row.gamesInfo) ? row.gamesInfo : [];
        games.sort((a, b) => Number(b.playtime || b.playtimeForever || 0) - Number(a.playtime || a.playtimeForever || 0));
        const vacs = Array.isArray(steam.vacBans) ? steam.vacBans.map(Number) : [];
        dialog.overlay.querySelector(".sc-dialog").innerHTML = `
          <div class="sc-dialog-kicker">Игры · #${escapeHtml(row.id)}</div>
          <button class="sc-dialog-close" data-dialog-close aria-label="Закрыть">×</button>
          <div class="sc-entity-hero">
            ${row.avatarUrl ? `<img src="${escapeHtml(row.avatarUrl)}" alt="" />` : '<span class="sc-avatar-fallback">S</span>'}
            <div>
              <h2>${escapeHtml(steam.nickname || row.username || "Steam")}</h2>
              <p class="sc-dialog-muted">Steam ID ${escapeHtml(steam.steamid || row.steamId || "—")}</p>
            </div>
            <div class="sc-entity-stats">
              <b>${games.length || Number(row.gamesCount || 0)}</b><span>игр</span>
              <b>${vacs.length}</b><span>VAC</span>
            </div>
          </div>
          <div class="sc-game-grid">${games.length ? games.map((game) => {
            const vac = vacs.includes(Number(game.appid));
            const src = gameIconSrc(game);
            const last = Number(game.lastPlayed || game.rtime_last_played || 0);
            const lastMs = last > 0 && last < 1e12 ? last * 1000 : last;
            const lastText = lastMs ? dateParts(lastMs).join(" ") : "не запускалась";
            return `<article class="sc-game-card ${vac ? "is-vac" : ""}">
              ${src ? `<img src="${escapeHtml(src)}" alt="" />` : ""}
              <div><b>${escapeHtml(game.name || `App ${game.appid}`)}</b><small>${playtimeLabel(game.playtime || game.playtimeForever)} · ${escapeHtml(lastText)}</small></div>
              ${vac ? '<span class="sc-vac-pill">VAC</span>' : ""}
            </article>`;
          }).join("") : '<div class="sc-zero">Игр нет</div>'}</div>`;
      } catch (error) {
        dialog.overlay.querySelector(".sc-dialog").innerHTML = `<div class="sc-error">${escapeHtml(error.message)}</div><button class="sc-dialog-close" data-dialog-close>×</button>`;
      }
    }

    async function openInventoryModal(row) {
      const steam = row.steamInfo || {};
      const parts = moneyParts(row);
      const dialog = showDialog('<div class="sc-loading">Загружаю инвентарь…</div>', "sc-dialog--entity sc-dialog--inv");
      try {
        const data = await PanelAPI.get(`/admin/steam-control/accounts/${encodeURIComponent(row.id)}/inventory`, { force: true });
        const inventory = data.inventory || row.inventory || {};
        const tabs = flattenInventory(inventory);
        const price = inventory.price || {};
        const tradable = Number(price.tradable ?? parts.tradable) || 0;
        const marketable = Number(price.marketable ?? parts.marketable) || 0;
        const renderItems = (tabKey) => {
          const tab = tabs.find((item) => String(item.appid || item.name) === tabKey) || tabs[0];
          const items = Array.isArray(tab?.items) ? tab.items : [];
          if (!items.length) return '<div class="sc-zero">Предметов нет</div>';
          return items.map((item, index) => {
            const name = item.itemHashName || item.market_hash_name || item.name || "Item";
            const amount = Number(item.amount || item.count || 1) || 1;
            const itemPrice = Number(item.price ?? item.priceUsd ?? 0) || 0;
            const src = itemIconSrc(item);
            const tradableItem = item.tradable !== false && !item.ban;
            return `<button type="button" class="sc-inv-item ${tradableItem ? "" : "is-hold"}" data-item-index="${index}" data-tab-key="${escapeHtml(String(tab?.appid || tab?.name || ""))}">
              ${src ? `<img src="${escapeHtml(src)}" alt="" />` : ""}
              <span><b>${escapeHtml(name)}</b><small>${tradableItem ? "Трейдится" : "Не трейдится"}${amount > 1 ? ` · ×${amount}` : ""}</small></span>
              <strong>${money(itemPrice)}</strong>
            </button>`;
          }).join("");
        };
        const firstKey = String(tabs[0]?.appid || tabs[0]?.name || "");
        dialog.overlay.querySelector(".sc-dialog").innerHTML = `
          <div class="sc-dialog-kicker">Инвентарь · #${escapeHtml(row.id)}</div>
          <button class="sc-dialog-close" data-dialog-close aria-label="Закрыть">×</button>
          <div class="sc-entity-hero">
            ${row.avatarUrl ? `<img src="${escapeHtml(row.avatarUrl)}" alt="" />` : '<span class="sc-avatar-fallback">S</span>'}
            <div>
              <h2>${escapeHtml(steam.nickname || row.username || "Steam")}</h2>
              <p class="sc-dialog-muted">Steam ID ${escapeHtml(steam.steamid || row.steamId || "—")}</p>
            </div>
          </div>
          <div class="sc-price-breakdown">
            <div><span>Баланс</span><b>${parts.balanceUsd ? `${money(parts.balanceUsd)}${parts.currency !== "USD" ? ` (${parts.balance.toFixed(2)} ${escapeHtml(parts.currency)})` : ""}` : money(parts.balance)}</b></div>
            <div><span>Инвентарь</span><b>${money(tradable)}</b></div>
            <div><span>Трейдятся</span><b>${money(marketable || tradable)}</b></div>
            <div><span>Итого</span><b>${money(tradable + parts.balanceUsd)}</b></div>
          </div>
          <div class="sc-inv-tabs" role="tablist">${tabs.map((tab, index) => `<button type="button" class="sc-inv-tab ${index === 0 ? "is-active" : ""}" data-inv-tab="${escapeHtml(String(tab.appid || tab.name))}">${escapeHtml(tab.name)}<small>${money(tab.totalUsd || tab.items.reduce((sum, item) => sum + Number(item.price || item.priceUsd || 0), 0))}</small></button>`).join("")}</div>
          <div class="sc-inv-list" id="scInvList">${renderItems(firstKey)}</div>
          <div class="sc-inv-item-detail" id="scInvDetail" hidden></div>`;
        const tabsEl = dialog.overlay.querySelector(".sc-inv-tabs");
        const listEl = dialog.overlay.querySelector("#scInvList");
        const detailEl = dialog.overlay.querySelector("#scInvDetail");
        tabsEl?.addEventListener("click", (event) => {
          const btn = event.target.closest("[data-inv-tab]");
          if (!btn) return;
          tabsEl.querySelectorAll(".sc-inv-tab").forEach((el) => el.classList.toggle("is-active", el === btn));
          listEl.innerHTML = renderItems(btn.dataset.invTab);
          detailEl.hidden = true;
        });
        listEl?.addEventListener("click", (event) => {
          const btn = event.target.closest("[data-item-index]");
          if (!btn) return;
          const tab = tabs.find((item) => String(item.appid || item.name) === btn.dataset.tabKey) || tabs[0];
          const item = tab?.items?.[Number(btn.dataset.itemIndex)];
          if (!item) return;
          const name = item.itemHashName || item.market_hash_name || item.name || "Item";
          const src = itemIconSrc(item);
          detailEl.hidden = false;
          detailEl.innerHTML = `${src ? `<img src="${escapeHtml(src)}" alt="" />` : ""}<div><b>${escapeHtml(name)}</b><small>${item.tradable === false ? "Не трейдится" : "Трейдится"} · ${money(item.price ?? item.priceUsd ?? 0)}</small></div>`;
        });
      } catch (error) {
        dialog.overlay.querySelector(".sc-dialog").innerHTML = `<div class="sc-error">${escapeHtml(error.message)}</div><button class="sc-dialog-close" data-dialog-close>×</button>`;
      }
    }

    function openWorkerPopover(row) {
      const owner = row.owner || {};
      const dialog = showDialog(`
        <div class="sc-dialog-kicker">Участник</div>
        <h2>${escapeHtml(owner.username || "—")}</h2>
        <p class="sc-dialog-muted">${owner.telegram ? `Telegram ID ${escapeHtml(owner.telegram)}` : "ID участника в UProject"}</p>
        <dl class="sc-detail-grid sc-worker-dl">
          <section><h3>Владелец лога</h3>
            <dl><dt>Логин</dt><dd>${escapeHtml(owner.username || "—")}</dd><dt>UProject ID</dt><dd>${escapeHtml(owner.id ?? "—")}</dd><dt>Telegram</dt><dd>${escapeHtml(owner.telegram || "—")}</dd></dl>
          </section>
        </dl>
        <div class="sc-detail-actions">
          <button class="btn-primary" data-filter-worker="${escapeHtml(String(owner.id || owner.username || ""))}">Показать логи участника</button>
        </div>`, "sc-dialog--tag");
      dialog.overlay.addEventListener("click", (event) => {
        const btn = event.target.closest("[data-filter-worker]");
        if (!btn) return;
        state.filters.workers = btn.dataset.filterWorker;
        dialog.close();
        applyFilters();
      });
    }

    async function runTask(task, ids) {
      const meta = TASK_META[task];
      if (!meta || !ids.length) return;
      if (!(await GarbonaAdminConfirm.open(`${meta[0]} для ${ids.length} лог(ов)?`, { confirmLabel: meta[0] }))) return;
      try {
        const result = await PanelAPI.post("/admin/steam-control/tasks", { task, ids, name: meta[1] });
        toast(`Задача #${result.task?.id || "—"} создана`, "success");
        state.selected.clear();
        syncBulkBar();
        setTimeout(loadRows, 1200);
      } catch (error) { toast(error.message, "error"); }
    }

    async function exportRows(ids) {
      try {
        const data = await PanelAPI.post("/admin/steam-control/export", { ids });
        const rows = Array.isArray(data.rows) ? data.rows : [];
        const header = "ID:Login:Password:Email:EmailPass:LockCode:Limit:SteamID:LztLink:InventoryPrice";
        const lines = rows.map((row) => [
          row.id, row.username, row.password, row.steamInfo?.email, row.steamInfo?.emailPassword,
          row.steamInfo?.lockCode || row.rcode, row.steamInfo?.limited ? "Limited" : "No limit",
          row.steamInfo?.steamid, row.lztLinkId ? `https://lzt.market/${row.lztLinkId}` : "-", row.inventory?.price?.total || 0,
        ].map((value) => String(value ?? "").replaceAll("\n", " ")).join(":"));
        downloadText(`garbona-logs-${Date.now()}.txt`, [header, ...lines].join("\n"));
        toast(`Экспортировано: ${rows.length}`, "success");
      } catch (error) { toast(error.message, "error"); }
    }

    function makeMaFile(data) {
      return {
        shared_secret: data.shared_secret, serial_number: data.serial_number, revocation_code: data.revocation_code,
        uri: data.uri, server_time: data.server_time, account_name: data.account_name, token_gid: data.token_gid,
        identity_secret: data.identity_secret, secret_1: data.secret_1, status: 1,
        device_id: `android:${Math.random().toString(16).substring(2, 10)}-bbdf-c44b-07f0-91582107d977`, fully_enrolled: true,
        Session: { SessionID: "", SteamLogin: "", SteamLoginSecure: "", WebCookie: "", OAuthToken: "", SteamID: data.steamid },
      };
    }

    async function downloadMaFile(row) {
      try {
        const data = await PanelAPI.get(`/admin/steam-control/accounts/${encodeURIComponent(row.id)}/mafile`, { force: true });
        downloadText(`${row.steamId || row.id}-garbona.maFile`, JSON.stringify(makeMaFile(data), null, 2), "application/json");
      } catch (error) { toast(error.message, "error"); }
    }

    async function setLocalMafileStatus(row, status) {
      const labels = { pending: "В ожидании снятия", withdrawn: "Успешно снят", sold: "Продан", invalid: "Невалид" };
      let amount = 0;
      let skipCredit = false;
      if (status === "withdrawn") {
        const picked = await askMafileAmountDialog({
          sourceId: row.id,
          title: "Сумма успешного снятия",
          hint: "Укажите сумму снятия. Профит начислится, если не отметить «уже начислен».",
          submitLabel: "Сохранить",
          defaultAmount: Number(row.localMafile?.withdrawnAmount || row.totalUsd || 0),
        });
        if (!picked) return;
        amount = picked.amount;
        skipCredit = picked.skipCredit;
      }
      if (status === "sold") {
        const picked = await askMafileAmountDialog({
          sourceId: row.id,
          title: "Сумма продажи",
          hint: "Воркеру начислится его процент от этой суммы, если не отметить «уже начислен».",
          submitLabel: "Продать",
          defaultAmount: Number(row.localMafile?.withdrawnAmount || row.totalUsd || 0),
        });
        if (!picked) return;
        amount = picked.amount;
        skipCredit = picked.skipCredit;
      }
      try {
        const result = await PanelAPI.patch(`/admin/mafiles/${encodeURIComponent(row.id)}/status`, { status, amount, skipCredit });
        PanelAPI.bust("/admin/overview");
        PanelAPI.bust("/admin/mafiles");
        const creditHint = !skipCredit && (status === "withdrawn" || status === "sold") && Number(result.workerShare || 0) > 0
          ? ` · воркеру ${Number(result.workerPercent || 70)}% $${Number(result.workerShare).toFixed(2)}`
          : skipCredit && (status === "withdrawn" || status === "sold")
            ? " · без начисления"
            : "";
        toast(
          result?.telegramUpdated
            ? `Статус в профитах: ${labels[status] || status}${creditHint}`
            : `Статус Garbona: ${labels[status] || status}${creditHint}`,
          "success"
        );
        await loadRows();
      } catch (error) { toast(error.message, "error"); }
    }

    async function openTwoFactor(row) {
      const dialog = showDialog(`<div class="sc-dialog-kicker">Steam Guard · #${escapeHtml(row.id)}</div><h2>Steam Authenticator</h2><div class="sc-guard-code" id="scGuardCode">•••••</div><p class="sc-dialog-muted">Актуальный код и список подтверждений аккаунта.</p><div id="scConfirmations" class="sc-confirmations"><div class="sc-loading">Загрузка…</div></div>`, "sc-dialog--guard");
      async function refresh() {
        try {
          const [code, conf] = await Promise.all([
            PanelAPI.get(`/admin/steam-control/accounts/${encodeURIComponent(row.id)}/2fa/code`, { force: true }),
            PanelAPI.get(`/admin/steam-control/accounts/${encodeURIComponent(row.id)}/2fa/confirmations`, { force: true }),
          ]);
          dialog.overlay.querySelector("#scGuardCode").textContent = code?.code || "—";
          const items = Array.isArray(conf?.conf) ? conf.conf : [];
          dialog.overlay.querySelector("#scConfirmations").innerHTML = items.length ? items.map((item) => `<article class="sc-confirmation" data-conf-id="${escapeHtml(item.id)}" data-nonce="${escapeHtml(item.nonce)}"><div><b>${escapeHtml(item.headline || item.summary?.[0] || "Подтверждение")}</b><small>${escapeHtml(item.summary?.slice?.(1)?.join(" · ") || item.type_name || "Steam")}</small></div><div><button class="btn-ghost" data-conf-action="reject">Отклонить</button><button class="btn-primary" data-conf-action="accept">Подтвердить</button></div></article>`).join("") : '<div class="sc-zero">Подтверждений нет</div>';
        } catch (error) { dialog.overlay.querySelector("#scConfirmations").innerHTML = `<div class="sc-error">${escapeHtml(error.message)}</div>`; }
      }
      dialog.overlay.addEventListener("click", async (event) => {
        const btn = event.target.closest("[data-conf-action]");
        if (!btn) return;
        const item = btn.closest("[data-conf-id]");
        const accept = btn.dataset.confAction === "accept";
        if (!(await GarbonaAdminConfirm.open(accept ? "Подтвердить действие в Steam?" : "Отклонить действие в Steam?", { confirmLabel: accept ? "Подтвердить" : "Отклонить" }))) return;
        try {
          await PanelAPI.post(`/admin/steam-control/accounts/${encodeURIComponent(row.id)}/2fa/confirmations`, { confId: item.dataset.confId, nonce: item.dataset.nonce, accept });
          toast(accept ? "Подтверждено" : "Отклонено", "success");
          await refresh();
        } catch (error) { toast(error.message, "error"); }
      });
      await refresh();
    }

    async function openDetails(row) {
      const dialog = showDialog('<div class="sc-loading">Загружаю полную карточку…</div>', "sc-dialog--details");
      try {
        const data = await PanelAPI.get(`/admin/steam-control/accounts/${encodeURIComponent(row.id)}`, { force: true });
        const account = data.account || row;
        const steam = account.steamInfo || {};
        const statuses = Object.keys(STATUS_META);
        dialog.overlay.querySelector(".sc-dialog").innerHTML = `<div class="sc-dialog-kicker">Лог #${escapeHtml(account.id)}</div><h2>${escapeHtml(account.username || steam.nickname || "Steam аккаунт")}</h2>
          <button class="sc-dialog-close" data-dialog-close aria-label="Закрыть">×</button>
          <div class="sc-detail-grid">
            <section><h3>Аккаунт</h3><dl><dt>Логин</dt><dd>${escapeHtml(account.username || "—")}</dd><dt>Пароль</dt><dd>${escapeHtml(account.password || "—")}</dd><dt>Steam ID</dt><dd>${escapeHtml(steam.steamid || "—")}</dd><dt>Страна / уровень</dt><dd>${escapeHtml(steam.country || "—")} · ${escapeHtml(steam.level ?? "—")} LVL</dd><dt>Баланс</dt><dd>${money(steam.balanceUsd)}</dd><dt>Инвентарь</dt><dd>${money(account.inventoryUsd)}</dd></dl></section>
            <section><h3>Управление</h3><label>Статус аккаунта<select class="settings-input" id="scDetailStatus">${statuses.map((status) => `<option value="${status}" ${status === account.status ? "selected" : ""}>${escapeHtml(STATUS_META[status][0])}</option>`).join("")}</select></label><label>Личная метка<input class="settings-input" id="scCustomTag" value="${escapeHtml(account.customTag || "")}" maxlength="80" /></label><label>Метка команды<input class="settings-input" id="scTeamTag" value="${escapeHtml(account.customTeamTag || "")}" maxlength="80" /></label><button class="btn-primary" id="scSaveAccount">Сохранить</button></section>
          </div>
          <div class="sc-detail-actions"><button class="btn-ghost" data-detail-action="export">Экспорт</button>${account.isMaFile ? '<button class="btn-ghost" data-detail-action="mafile">Скачать .maFile</button><button class="btn-ghost" data-detail-action="guard">Steam Guard</button>' : ""}</div>
          ${account.isMaFile ? `<div class="sc-local-control"><h3>Статус снятия Garbona</h3><button data-local-status="pending">В ожидании</button><button data-local-status="withdrawn">Успешно снят</button><button data-local-status="sold">Продан</button><button data-local-status="invalid">Невалид</button></div>` : ""}`;
        dialog.overlay.querySelector("#scSaveAccount").addEventListener("click", async () => {
          try {
            const status = dialog.overlay.querySelector("#scDetailStatus").value;
            await Promise.all([
              status !== account.status ? PanelAPI.post(`/admin/steam-control/accounts/${encodeURIComponent(account.id)}/status`, { status }) : Promise.resolve(),
              PanelAPI.post(`/admin/steam-control/accounts/${encodeURIComponent(account.id)}/tags`, { customTag: dialog.overlay.querySelector("#scCustomTag").value, customTeamTag: dialog.overlay.querySelector("#scTeamTag").value }),
            ]);
            toast("Аккаунт обновлён", "success"); dialog.close(); await loadRows();
          } catch (error) { toast(error.message, "error"); }
        });
        dialog.overlay.addEventListener("click", async (event) => {
          const local = event.target.closest("[data-local-status]");
          if (local) { dialog.close(); await setLocalMafileStatus(account, local.dataset.localStatus); return; }
          const action = event.target.closest("[data-detail-action]")?.dataset.detailAction;
          if (action === "export") await exportRows([Number(account.id)]);
          if (action === "mafile") await downloadMaFile(account);
          if (action === "guard") { dialog.close(); await openTwoFactor(account); }
        });
      } catch (error) { dialog.overlay.querySelector(".sc-dialog").innerHTML = `<div class="sc-error">${escapeHtml(error.message)}</div><button class="sc-dialog-close" data-dialog-close>×</button>`; }
    }

    function openAccountTag(row) {
      const dialog = showDialog(`<div class="sc-dialog-kicker">АККАУНТ #${escapeHtml(row.id)}</div><h2>Метка для воркера</h2><p class="sc-dialog-muted">Метка появится рядом с аккаунтом в панели воркера.</p><label class="sc-tag-field">Название метки<input id="scQuickTag" type="text" maxlength="80" value="${escapeHtml(row.accountTag || "")}" placeholder="Например: высокий приоритет"></label><div class="sc-detail-actions"><button class="btn-ghost" data-tag-clear>Удалить метку</button><button class="btn-primary" data-tag-save>Сохранить</button></div>`, "sc-dialog--tag");
      const save = async (value) => {
        try {
          const saved = await PanelAPI.post(`/admin/steam-control/accounts/${encodeURIComponent(row.id)}/tags`, {
            customTag: row.customTag || "",
            customTeamTag: String(value || "").trim(),
          });
          const remoteSynced = saved?.result?.synced !== false;
          toast(remoteSynced ? (value ? "Метка сохранена" : "Метка удалена") : "Метка сохранена в Garbona", "success");
          dialog.close(); await loadRows();
        } catch (error) { toast(error.message, "error"); }
      };
      dialog.overlay.addEventListener("click", (event) => {
        if (event.target.closest("[data-tag-save]")) save(dialog.overlay.querySelector("#scQuickTag").value);
        if (event.target.closest("[data-tag-clear]")) save("");
      });
      dialog.overlay.querySelector("#scQuickTag").focus();
    }

    async function sendToTelegram(row, target) {
      const labels = { profit: "канал с профитами", worker: "личные сообщения воркера", chat: "чат команды" };
      if (!labels[target] || !(await GarbonaAdminConfirm.open(`Отправить карточку #${row.id} в ${labels[target]}?`, { confirmLabel: "Отправить" }))) return;
      try {
        await PanelAPI.post(`/admin/steam-control/accounts/${encodeURIComponent(row.id)}/telegram`, { target });
        toast(`Карточка отправлена в ${labels[target]}`, "success");
      } catch (error) {
        const msg = String(error.message || "");
        const friendly =
          /Telegram временно недоступен/i.test(msg)
            ? msg
            : /UProject временно недоступен/i.test(msg)
              ? "UProject временно недоступен. Повторите отправку через минуту"
              : /HTTP 502|HTTP 503|HTTP 504|времено недоступен|временно недоступен/i.test(msg)
                ? "Сервер временно недоступен. Подождите ~30 сек и повторите"
                : msg;
        toast(
          friendly,
          "error"
        );
      }
    }

    async function openTasks() {
      const dialog = showDialog('<div class="sc-loading">Загружаю задачи…</div>', "sc-dialog--tasks");
      try {
        const data = await PanelAPI.get("/admin/steam-control/tasks?page=0&limit=30", { force: true });
        const tasks = Array.isArray(data.rows) ? data.rows : [];
        dialog.overlay.querySelector(".sc-dialog").innerHTML = `<div class="sc-dialog-kicker">ЗАДАЧИ КОМАНДЫ</div><h2>Задачи обработки</h2><button class="sc-dialog-close" data-dialog-close aria-label="Закрыть">×</button><div class="sc-task-list">${tasks.length ? tasks.map((task) => {
          const operations = Array.isArray(task.steam?.tasks) ? task.steam.tasks : [];
          const done = operations.filter((item) => item.state === "Done").length;
          const failed = operations.filter((item) => item.state === "Error").length;
          return `<article class="sc-task"><div><b>#${escapeHtml(task.id)} · ${escapeHtml(task.name || "Без названия")}</b><small>${escapeHtml(dateParts(task.createdAt).join(" · "))}</small></div><div><span class="sc-task-state sc-task-state--${String(task.state || "").toLowerCase()}">${escapeHtml(task.state || "—")}</span><small>${done} выполнено · ${failed} ошибок · ${operations.length} всего</small></div>${task.state === "InProcess" ? `<button class="btn-ghost" data-cancel-task="${escapeHtml(task.id)}">Отменить</button>` : ""}</article>`;
        }).join("") : '<div class="sc-zero">Задач пока нет</div>'}</div>`;
        dialog.overlay.addEventListener("click", async (event) => {
          const button = event.target.closest("[data-cancel-task]");
          if (!button || !(await GarbonaAdminConfirm.open(`Отменить задачу #${button.dataset.cancelTask}?`, { confirmLabel: "Отменить задачу" }))) return;
          try {
            await PanelAPI.post(`/admin/steam-control/tasks/${encodeURIComponent(button.dataset.cancelTask)}/cancel`, {});
            toast("Задача отменена", "success"); dialog.close(); await openTasks();
          } catch (error) { toast(error.message, "error"); }
        });
      } catch (error) {
        dialog.overlay.querySelector(".sc-dialog").innerHTML = `<div class="sc-error">${escapeHtml(error.message)}</div><button class="sc-dialog-close" data-dialog-close>×</button>`;
      }
    }

    async function handleRowAction(row, action, task, nextStatus, telegramTarget) {
      if (task) return runTask(task, [Number(row.id)]);
      if (telegramTarget) return sendToTelegram(row, telegramTarget);
      if (nextStatus) {
        const label = STATUS_META[nextStatus]?.[0] || nextStatus;
        if (!(await GarbonaAdminConfirm.open(`Сменить статус UProject на «${label}»?\nЭто не меняет подпись в канале профитов.`, { confirmLabel: "Сменить UProject" }))) return;
        try {
          await PanelAPI.post(`/admin/steam-control/accounts/${encodeURIComponent(row.id)}/status`, { status: nextStatus });
          toast(`UProject: ${label}`, "success");
          await loadRows();
        } catch (error) {
          const msg = String(error.message || "");
          toast(/bad request/i.test(msg) ? "UProject отклонил смену статуса для этого аккаунта" : msg, "error");
        }
        return;
      }
      if (action === "export") return exportRows([Number(row.id)]);
      if (action === "download-mafile") return downloadMaFile(row);
      if (action === "two-factor") return openTwoFactor(row);
      if (action === "details") return openDetails(row);
    }

    async function loadRows(prefetched = null) {
      const body = document.getElementById("scRows");
      if (body) body.innerHTML = '<tr><td colspan="10"><div class="sc-loading">Обновляю список логов…</div></td></tr>';
      try {
        const data = prefetched ? await prefetched : await PanelAPI.get(queryPath(), { force: true });
        if (data?.__error) throw data.__error;
        state.rows = Array.isArray(data.rows) ? data.rows : [];
        state.totalCount = Number(data.totalCount || 0);
        state.pageCount = Number(data.pageCount || 1);
        state.availableStatuses = Array.isArray(data.statuses) ? data.statuses : [];
        document.getElementById("scTableCount").textContent = state.totalCount;
        const isUnfiltered = Object.entries(state.filters).every(([key, value]) => filterValuesEmpty(key, value));
        if (isUnfiltered && document.getElementById("scLogCount")) {
          document.getElementById("scLogCount").textContent = state.totalCount;
        }
        if (state.pageCount === 1 && isUnfiltered) {
          const visibleCounts = state.rows.reduce((acc, row) => { acc[row.status] = (acc[row.status] || 0) + 1; return acc; }, {});
          if (document.getElementById("scValidCount")) document.getElementById("scValidCount").textContent = visibleCounts.Ok || 0;
          if (document.getElementById("scMafileCount")) document.getElementById("scMafileCount").textContent = visibleCounts.MaFile || 0;
          if (document.getElementById("scInvalidCount")) document.getElementById("scInvalidCount").textContent = visibleCounts.Invalid || 0;
        }
        renderRows(); renderPagination();
      } catch (error) {
        if (body) body.innerHTML = `<tr><td colspan="10"><div class="sc-error">${escapeHtml(error.message)}</div></td></tr>`;
      }
    }

    const initialRowsPromise = PanelAPI.get(queryPath(), { force: true }).catch((error) => ({ __error: error }));
    const remoteStatsPromise = PanelAPI.get("/admin/steam-control/stats", { force: true }).catch(() => ({ statuses: [] }));
    const overview = logsOnly ? { kpi: {}, series: [] } : await PanelAPI.get("/admin/overview");
    const remoteStatuses = {};
    const remoteTotal = Object.values(remoteStatuses).reduce((sum, value) => sum + value, 0);
    const teamKpi = overview.kpi || {};
    const FILTER_DEFS = {
      level: { label: "Уровень Steam", kind: "range", from: "levelFrom", to: "levelTo", suffix: " LVL" },
      balance: { label: "Баланс Steam", kind: "range", from: "balanceFrom", to: "balanceTo", suffix: " $" },
      inventory: { label: "Инвентарь", kind: "range", from: "invFrom", to: "invTo", suffix: " $" },
      mafile: { label: "MaFile", kind: "choice", field: "mafile", options: [["true", "Только MaFile"], ["false", "Без MaFile"]] },
      mafileUnlocked: {
        label: "MaFile анлок",
        kind: "choice",
        field: "mafileUnlocked",
        options: [
          ["true", "Уже анлок (таймер прошёл)"],
          ["false", "Ещё ждёт (~48ч)"],
        ],
      },
      prime: { label: "Prime", kind: "choice", field: "prime", options: [["true", "С праймом"], ["false", "Без прайма"]] },
      elo: { label: "Рейтинг CS2", kind: "range", from: "eloFrom", to: "eloTo", suffix: " ELO" },
      limit: { label: "Лимит", kind: "choice", field: "steamLimit", options: [["true", "Есть лимит"], ["false", "Без лимита"]] },
      unlocked: { label: "КТ", kind: "choice", field: "unlocked", options: [["true", "КТ снято"], ["false", "КТ не снято"]] },
      games: { label: "Игры", kind: "text", field: "games", placeholder: "App ID через запятую" },
      status: {
        label: "Статус",
        kind: "choice",
        field: "status",
        multi: true,
        options: Object.entries(STATUS_META).map(([value, meta]) => [value, meta[0]]),
      },
      workers: { label: "Участник команды", kind: "text", field: "workers", placeholder: "ID участника" },
    };
    const dashboardHead = logsOnly ? `
      <header class="sc-page-head"><div><span class="sc-eyebrow">GARБONA STEAM</span><h1>Логи</h1><p>Аккаунты команды, фильтры и детали по играм, цене и инвентарю.</p></div><button class="sc-refresh" id="scRefresh" aria-label="Обновить данные">${icon("refresh")}<span>Обновить</span></button></header>` : `
      <header class="sc-page-head"><div><span class="sc-eyebrow">GARБONA TEAM</span><h1>Статистика команды</h1><p>Главные показатели, динамика и управление логами в одном месте.</p></div><button class="sc-refresh" id="scRefresh" aria-label="Обновить данные">${icon("refresh")}<span>Обновить</span></button></header>
      <section class="sc-team-section"><div class="sc-section-head"><div><h2>Обзор команды</h2><p>Текущие показатели всей команды</p></div></div>
      <div class="sc-kpis">
        <article class="sc-kpi-accent"><span>Поступления за 24ч</span><b>${escapeHtml(teamKpi.arrivals24hDisplay || "$0.00")} · ${Number(teamKpi.arrivals24hCount || 0)} ID</b><small>${escapeHtml(teamKpi.arrivals24hSummary || "0 поступлений")} · баланс+инвентарь · без дублей${teamKpi.arrivalsYesterdayCount != null ? ` · вчера ${Number(teamKpi.arrivalsYesterdayCount || 0)} · ${escapeHtml(teamKpi.arrivalsYesterdayDisplay || "$0.00")}` : ""}${teamKpi.arrivalsValueDeltaPct == null ? "" : ` · ${teamKpi.arrivalsValueDeltaPct >= 0 ? "+" : ""}${teamKpi.arrivalsValueDeltaPct}% к вчера`}</small></article>
        <article><span>Участники команды</span><b>${Number(teamKpi.teamCount || 0)}</b><small>${Number(teamKpi.pendingApps || 0)} заявок ожидают</small></article>
        <article><span>Все логи</span><b id="scLogCount">${remoteTotal}</b><small><i class="sc-mini-dot is-valid"></i><span id="scValidCount">${remoteStatuses.Ok || 0}</span> валидных</small></article>
        <article><span>MaFile</span><b id="scMafileCount">${remoteStatuses.MaFile || 0}</b><small>${overview.mafiles?.statuses?.pending || 0} ожидают снятия</small></article>
        <article><span>Ожидают выплаты</span><b>${Number(teamKpi.pendingPayouts || 0)}</b><small><span id="scInvalidCount">${remoteStatuses.Invalid || 0}</span> невалидных аккаунтов</small></article>
      </div>
      </section>
      <section class="sc-chart-card"><div class="sc-section-head"><div><h2>Динамика команды</h2><p>Уникальные поступления логов и MaFile · сумма = баланс + инвентарь</p></div><div class="sc-chart-legend"><span><i class="is-amount"></i>Сумма</span><span><i class="is-count"></i>Логи + MaFile</span></div></div><div id="scTeamChart"></div></section>`;
    main.innerHTML = `<div class="sc-dashboard${logsOnly ? " admin-logs" : ""}">
      ${dashboardHead}
      <section class="sc-workspace">
        <div class="sc-workspace-head"><div><div class="sc-title-row">${icon("logs")}<h2>Список логов</h2><span id="scTableCount">live</span></div><p>Аккаунты команды, их состояние и быстрые действия</p></div></div>
        <div class="sc-toolbar">
          <label class="sc-search">${icon("search")}<input id="scSearch" type="search" placeholder="ID, SteamID, логин, пароль или ссылка" /></label>
          <div class="sc-filter-host"><button class="sc-filter-toggle" id="scFilterToggle">${icon("filter")} Добавить фильтр <span id="scFilterCount">0</span></button><div class="sc-filter-popover" id="scFilterPopover" hidden><div id="scFilterPicker" class="sc-filter-picker">${Object.entries(FILTER_DEFS).map(([key, def]) => `<button data-filter-open="${key}"><span>${escapeHtml(def.label)}</span><b>›</b></button>`).join("")}</div><div id="scFilterEditor" class="sc-filter-editor" hidden></div></div></div>
          <button class="btn-ghost" id="scTasksButton">Задачи</button><button class="btn-ghost" id="scExportVisible">Экспорт страницы</button>
        </div>
        <div class="sc-filters-meta">
          <div class="sc-period-bar">
            <span class="sc-period-label">Период</span>
            <div class="sc-period-pills period-pills" id="scPeriodPills" role="group" aria-label="Период отображения логов">
              ${["all", "24h", "7d", "30d"].map((p) => `<button type="button" class="period-pill${state.filters.period === p ? " is-active" : ""}" data-period="${p}">${periodLabel(p)}</button>`).join("")}
            </div>
          </div>
          <div class="sc-active-filters" id="scActiveFilters" hidden></div>
        </div>
        <div class="sc-bulk" id="scBulkBar" hidden><b>Выбрано: <span id="scSelectedCount">0</span></b><button data-bulk-task="CheckValid">Проверить</button><button data-bulk-task="UnlockRed">Снять КТ</button><button data-bulk-task="MaFileToLog">В лог</button><button data-bulk-task="SellLZT">Продать</button><button data-bulk-export>Экспорт</button><button data-bulk-clear>Отменить</button></div>
        <div class="sc-table-wrap"><table class="sc-table"><thead><tr><th><input id="scSelectAll" type="checkbox" aria-label="Выбрать страницу" /></th><th>ID</th><th>Дата</th><th>Аккаунт</th><th>Игры</th><th>Цена</th><th>CS2</th><th>Данные</th><th>Статус</th><th></th></tr></thead><tbody id="scRows"></tbody></table></div>
        <footer class="sc-pagination" id="scPagination"></footer>
      </section>
    </div>`;

    function filterIsActive(def) {
      if (def.kind === "range") return state.filters[def.from] !== "" || state.filters[def.to] !== "";
      if (def.multi) return getChoiceValues(def.field).length > 0;
      return state.filters[def.field] !== "";
    }

    function filterSummary(def) {
      if (def.kind === "range") {
        const from = state.filters[def.from]; const to = state.filters[def.to];
        if (from !== "" && to !== "") return `${from}–${to}${def.suffix || ""}`;
        if (from !== "") return `от ${from}${def.suffix || ""}`;
        return `до ${to}${def.suffix || ""}`;
      }
      if (def.multi) {
        return getChoiceValues(def.field)
          .map((value) => def.options.find(([optionValue]) => optionValue === value)?.[1] || value)
          .join(" + ");
      }
      if (def.kind === "choice") return def.options.find(([value]) => value === state.filters[def.field])?.[1] || state.filters[def.field];
      return state.filters[def.field];
    }

    function renderActiveFilters() {
      const host = document.getElementById("scActiveFilters");
      const active = Object.entries(FILTER_DEFS).filter(([, def]) => filterIsActive(def));
      const periodActive = state.filters.period && state.filters.period !== "all";
      const totalActive = active.length + (periodActive ? 1 : 0);
      document.getElementById("scFilterCount").textContent = totalActive;
      host.hidden = totalActive === 0;
      const periodChip = periodActive
        ? `<button data-clear-period><span>Период:</span> ${escapeHtml(periodLabel(state.filters.period))}<b>×</b></button>`
        : "";
      host.innerHTML = periodChip + active.map(([key, def]) => `<button data-remove-filter="${key}"><span>${escapeHtml(def.label)}:</span> ${escapeHtml(filterSummary(def))}<b>×</b></button>`).join("") + (totalActive ? '<button class="sc-clear-filters" data-clear-filters>Сбросить всё</button>' : "");
    }

    function applyFilters() {
      renderActiveFilters();
      state.page = 0; state.selected.clear(); loadRows();
    }

    function clearFilter(key) {
      const def = FILTER_DEFS[key]; if (!def) return;
      if (def.kind === "range") { state.filters[def.from] = ""; state.filters[def.to] = ""; }
      else if (def.multi) state.filters[def.field] = [];
      else state.filters[def.field] = "";
    }

    function openFilterEditor(key) {
      const def = FILTER_DEFS[key]; if (!def) return;
      const editor = document.getElementById("scFilterEditor");
      document.getElementById("scFilterPicker").hidden = true; editor.hidden = false;
      let body = "";
      if (def.kind === "choice") {
        const selected = def.multi ? getChoiceValues(def.field) : [state.filters[def.field]].filter(Boolean);
        body = `<div class="sc-filter-options">${def.options.map(([value, label]) => {
          const isSelected = def.multi ? selected.includes(value) : state.filters[def.field] === value;
          return `<button type="button" data-filter-choice="${escapeHtml(value)}" class="${isSelected ? "is-selected" : ""}">${escapeHtml(label)}<i></i></button>`;
        }).join("")}</div><div class="sc-filter-actions"><button type="button" class="sc-filter-clear" data-filter-clear>Очистить</button><button type="button" data-filter-apply>Применить</button></div>`;
        if (def.multi) {
          body += `<p class="sc-filter-hint">Можно выбрать несколько значений, например «MaFile» и «Валид»</p>`;
        }
      }
      if (def.kind === "range") body = `<div class="sc-filter-range"><label>От<input id="scFilterFrom" type="number" min="0" value="${escapeHtml(state.filters[def.from])}" placeholder="0"></label><label>До<input id="scFilterTo" type="number" min="0" value="${escapeHtml(state.filters[def.to])}" placeholder="∞"></label><button data-filter-apply>Применить</button></div>`;
      if (def.kind === "text") body = `<div class="sc-filter-range"><label>${escapeHtml(def.label)}<input id="scFilterText" type="text" value="${escapeHtml(state.filters[def.field])}" placeholder="${escapeHtml(def.placeholder || "Введите значение")}"></label><button data-filter-apply>Применить</button></div>`;
      editor.dataset.filterKey = key;
      editor.innerHTML = `<button class="sc-filter-back" data-filter-back>‹ Все фильтры</button><h3>${escapeHtml(def.label)}</h3>${body}`;
    }

    const searchFilters = debounce(() => { state.filters.search = document.getElementById("scSearch").value.trim(); state.page = 0; loadRows(); }, 350);
    document.getElementById("scSearch").addEventListener("input", searchFilters);
    document.getElementById("scPeriodPills").addEventListener("click", (event) => {
      const btn = event.target.closest("[data-period]");
      if (!btn) return;
      state.filters.period = btn.dataset.period;
      document.querySelectorAll("#scPeriodPills .period-pill").forEach((el) => {
        el.classList.toggle("is-active", el.dataset.period === state.filters.period);
      });
      applyFilters();
    });
    document.getElementById("scFilterToggle").addEventListener("click", (event) => {
      event.stopPropagation();
      const popover = document.getElementById("scFilterPopover"); popover.hidden = !popover.hidden;
      document.getElementById("scFilterPicker").hidden = false; document.getElementById("scFilterEditor").hidden = true;
    });
    document.getElementById("scFilterPopover").addEventListener("click", (event) => {
      event.stopPropagation();
      const open = event.target.closest("[data-filter-open]"); if (open) return openFilterEditor(open.dataset.filterOpen);
      if (event.target.closest("[data-filter-back]")) { document.getElementById("scFilterPicker").hidden = false; document.getElementById("scFilterEditor").hidden = true; return; }
      const editor = document.getElementById("scFilterEditor"); const def = FILTER_DEFS[editor.dataset.filterKey]; if (!def) return;
      const choice = event.target.closest("[data-filter-choice]");
      if (choice) {
        if (def.multi) {
          const value = choice.dataset.filterChoice;
          const selected = getChoiceValues(def.field);
          const index = selected.indexOf(value);
          if (index >= 0) selected.splice(index, 1);
          else selected.push(value);
          state.filters[def.field] = selected;
          choice.classList.toggle("is-selected");
          return;
        }
        state.filters[def.field] = choice.dataset.filterChoice;
        document.getElementById("scFilterPopover").hidden = true;
        applyFilters();
        return;
      }
      if (event.target.closest("[data-filter-clear]")) {
        if (def.multi) state.filters[def.field] = [];
        else state.filters[def.field] = "";
        openFilterEditor(editor.dataset.filterKey);
        return;
      }
      if (event.target.closest("[data-filter-apply]")) {
        if (def.kind === "range") {
          state.filters[def.from] = editor.querySelector("#scFilterFrom").value;
          state.filters[def.to] = editor.querySelector("#scFilterTo").value;
        } else if (def.kind === "text") {
          state.filters[def.field] = editor.querySelector("#scFilterText").value.trim();
        }
        document.getElementById("scFilterPopover").hidden = true;
        applyFilters();
      }
    });
    document.getElementById("scActiveFilters").addEventListener("click", (event) => {
      const remove = event.target.closest("[data-remove-filter]");
      if (remove) { clearFilter(remove.dataset.removeFilter); applyFilters(); return; }
      if (event.target.closest("[data-clear-period]")) {
        state.filters.period = "all";
        document.querySelectorAll("#scPeriodPills .period-pill").forEach((el) => {
          el.classList.toggle("is-active", el.dataset.period === "all");
        });
        applyFilters();
        return;
      }
      if (event.target.closest("[data-clear-filters]")) {
        Object.keys(FILTER_DEFS).forEach(clearFilter);
        state.filters.period = "all";
        document.querySelectorAll("#scPeriodPills .period-pill").forEach((el) => {
          el.classList.toggle("is-active", el.dataset.period === "all");
        });
        applyFilters();
      }
    });
    main.addEventListener("click", (event) => { if (!event.target.closest(".sc-filter-host")) document.getElementById("scFilterPopover").hidden = true; });
    document.getElementById("scRefresh").addEventListener("click", loadRows);
    document.getElementById("scTasksButton").addEventListener("click", openTasks);
    document.getElementById("scExportVisible").addEventListener("click", () => exportRows(state.rows.map((row) => Number(row.id))));
    document.getElementById("scPagination").addEventListener("click", (event) => { const btn = event.target.closest("[data-page]"); if (!btn || btn.disabled) return; state.page = Number(btn.dataset.page); loadRows(); });
    document.getElementById("scSelectAll").addEventListener("change", (event) => { state.rows.forEach((row) => event.target.checked ? state.selected.add(String(row.id)) : state.selected.delete(String(row.id))); renderRows(); });
    document.getElementById("scBulkBar").addEventListener("click", (event) => {
      const ids = [...state.selected].map(Number);
      const task = event.target.closest("[data-bulk-task]")?.dataset.bulkTask;
      if (task) runTask(task, ids);
      if (event.target.closest("[data-bulk-export]")) exportRows(ids);
      if (event.target.closest("[data-bulk-clear]")) { state.selected.clear(); renderRows(); }
    });
    document.getElementById("scRows").addEventListener("change", (event) => {
      if (!event.target.matches("[data-select-row]")) return;
      event.target.checked ? state.selected.add(event.target.value) : state.selected.delete(event.target.value); syncBulkBar();
    });
    document.getElementById("scRows").addEventListener("click", async (event) => {
      const tr = event.target.closest("[data-row-id]"); if (!tr) return;
      const row = state.rows.find((item) => String(item.id) === tr.dataset.rowId); if (!row) return;
      const entity = event.target.closest("[data-entity]");
      if (entity) {
        const kind = entity.dataset.entity;
        if (kind === "games") await openGamesModal(row);
        else if (kind === "price" || kind === "inventory") await openInventoryModal(row);
        else if (kind === "worker") openWorkerPopover(row);
        return;
      }
      const copy = event.target.closest("[data-copy]");
      if (copy) { try { await navigator.clipboard.writeText(copy.dataset.copy); toast("Данные скопированы", "success"); } catch { toast("Не удалось скопировать", "error"); } return; }
      if (event.target.closest("[data-account-tag]")) { openAccountTag(row); return; }
      const toggle = event.target.closest("[data-toggle-menu]");
      if (toggle) {
        event.preventDefault();
        event.stopPropagation();
        const menu = tr.querySelector("[data-sc-menu]") || document.querySelector(`[data-sc-menu="${CSS.escape(String(row.id))}"]`);
        if (!menu) return;
        if (!menu.hidden && menu.classList.contains("is-fixed")) {
          closeMenus();
          return;
        }
        openRowMenu(toggle, menu);
        return;
      }
      const garbonaStatusBtn = event.target.closest("[data-garbona-status]");
      if (garbonaStatusBtn) {
        closeMenus();
        await setLocalMafileStatus(row, garbonaStatusBtn.dataset.garbonaStatus);
        return;
      }
      const actionEl = event.target.closest("[data-action], [data-task], [data-set-status], [data-telegram-target]");
      if (actionEl) { closeMenus(); await handleRowAction(row, actionEl.dataset.action, actionEl.dataset.task, actionEl.dataset.setStatus, actionEl.dataset.telegramTarget); }
    });
    // Close on outside click (menu may be portaled to body, outside #main).
    const onDocCloseMenus = (event) => {
      if (event.target.closest("[data-toggle-menu]")) return;
      if (event.target.closest("[data-sc-menu]")) return;
      closeMenus();
    };
    document.addEventListener("click", onDocCloseMenus);
    window.addEventListener("resize", closeMenus);
    document.addEventListener("scroll", (event) => {
      if (!document.querySelector("[data-sc-menu].is-fixed:not([hidden])")) return;
      // Keep menu while scrolling inside it; close on page/table scroll.
      if (event.target?.closest?.("[data-sc-menu]")) return;
      closeMenus();
    }, true);
    renderActiveFilters();
    if (!logsOnly && document.getElementById("scTeamChart")) {
      PanelCharts.renderSmoothLineChart(document.getElementById("scTeamChart"), (overview.series || []).map((row) => ({
        date: row.date, label: row.label, amount: row.totalUsd, amountDisplay: row.totalDisplay, count: row.count,
        logsCount: row.logsCount, mafileCount: row.mafileCount,
      })), {
        ariaLabel: "Поступления логов и MaFile за 7 дней",
        empty: "За этот период поступлений пока нет",
        amountLabel: "Сумма",
        countLabel: "Поступило",
      });
    }
    await loadRows(initialRowsPromise);
    remoteStatsPromise.then((remoteStats) => {
      const counts = Object.fromEntries((remoteStats.statuses || []).map((item) => [item.status, Number(item.count || 0)]));
      if (document.getElementById("scValidCount")) document.getElementById("scValidCount").textContent = counts.Ok || 0;
      if (document.getElementById("scMafileCount")) document.getElementById("scMafileCount").textContent = counts.MaFile || 0;
      if (document.getElementById("scInvalidCount")) document.getElementById("scInvalidCount").textContent = counts.Invalid || 0;
    });
  }

  async function renderAdmins() {
    const data = await PanelAPI.get("/admin/admins");
    const rows = data.admins || [];
    const activeCount = rows.filter((admin) => admin.active).length;
    const fmtDate = (value) => {
      if (!value) return "—";
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("ru-RU");
    };
    const initials = (admin) => String(admin.displayName || admin.username || "A")
      .split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
    const cards = rows.map((admin) => {
      const current = String(admin.username || "").toLowerCase() === String(user.username || "").toLowerCase();
      return `
        <article class="admin-person ${current ? "is-current" : ""}">
          <div class="admin-person-avatar" aria-hidden="true">${escapeHtml(initials(admin))}</div>
          <div class="admin-person-main">
            <div class="admin-person-title">
              <strong>${escapeHtml(admin.displayName || admin.username)}</strong>
              ${current ? '<span class="admin-you-badge">Вы</span>' : ""}
            </div>
            <code>@${escapeHtml(admin.username)}</code>
          </div>
          <div class="admin-person-meta">
            <span class="admin-meta-label">Последний вход</span>
            <span>${escapeHtml(fmtDate(admin.lastLoginAt))}</span>
          </div>
          <div class="admin-person-meta admin-created-by">
            <span class="admin-meta-label">Добавил</span>
            <span>${escapeHtml(admin.createdByUsername ? `@${admin.createdByUsername}` : "Первичный доступ")}</span>
          </div>
          <span class="admin-status ${admin.active ? "is-active" : "is-disabled"}"><i></i>${admin.active ? "Активен" : "Отключён"}</span>
        </article>`;
    }).join("");
    main.innerHTML = `
      <section class="admin-access-hero">
        <div class="admin-access-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><path d="M12 3.5 19 7.3v5.4c0 4.3-3 6.8-7 7.8-4-1-7-3.5-7-7.8V7.3L12 3.5Z" stroke="currentColor" stroke-width="1.5"/><path d="m9.2 12.1 1.8 1.9 3.9-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="admin-access-copy"><span class="admin-access-kicker">Контроль доступа</span><h1>Администраторы</h1><p>Управляйте людьми, у которых есть полный доступ к Garbona.</p></div>
        <div class="admin-access-stats"><div><strong>${rows.length}</strong><span>всего</span></div><div><strong>${activeCount}</strong><span>активны</span></div></div>
      </section>
      <div class="admin-access-layout">
        <section class="admin-create-card">
          <div class="admin-card-heading"><span class="admin-card-number">01</span><div><h2>Новый администратор</h2><p>Создайте отдельный доступ для участника команды.</p></div></div>
          <form id="createAdminForm" class="admin-create-form" autocomplete="off">
            <label><span>Логин</span><small>Латиница, цифры, точка и дефис</small><div class="admin-input-wrap"><span class="admin-input-prefix">@</span><input name="username" required minlength="3" maxlength="32" pattern="[a-zA-Z0-9._-]+" placeholder="username" spellcheck="false" /></div></label>
            <label><span>Отображаемое имя</span><small>Так имя будет выглядеть в панели</small><div class="admin-input-wrap"><input name="displayName" maxlength="64" placeholder="Имя администратора" /></div></label>
            <label><span>Пароль</span><small id="adminPasswordHint">Минимум 8 символов</small><div class="admin-input-wrap"><input id="adminPassword" type="password" name="password" required minlength="8" maxlength="128" autocomplete="new-password" placeholder="Надёжный пароль" /><button class="admin-password-toggle" type="button" id="adminPasswordToggle" aria-label="Показать пароль"><span>Показать</span></button></div><div class="admin-password-meter"><i></i><i></i><i></i><i></i></div></label>
            <div class="admin-security-note"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3.5 19 7.3v5.4c0 4.3-3 6.8-7 7.8-4-1-7-3.5-7-7.8V7.3L12 3.5Z" stroke="currentColor" stroke-width="1.5"/><path d="M9.5 12h5M12 9.5v5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span>Пароль показывается только здесь. Передайте его по защищённому каналу.</span></div>
            <button class="admin-create-submit" type="submit"><span>Создать администратора</span><svg viewBox="0 0 24 24" fill="none"><path d="M5 12h14m-5-5 5 5-5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          </form>
          <p class="admin-create-status" id="createAdminStatus" role="status"></p>
        </section>
        <section class="admin-list-card">
          <div class="admin-list-head"><div><h2>Команда доступа</h2><p>${activeCount} ${activeCount === 1 ? "активный администратор" : "активных администратора"}</p></div><span class="admin-list-lock"><i></i>Полный доступ</span></div>
          <div class="admin-people">${cards || '<div class="admin-list-empty">Администраторы ещё не добавлены</div>'}</div>
        </section>
      </div>`;
    const form = document.getElementById("createAdminForm");
    const status = document.getElementById("createAdminStatus");
    const password = document.getElementById("adminPassword");
    const passwordToggle = document.getElementById("adminPasswordToggle");
    const passwordHint = document.getElementById("adminPasswordHint");
    passwordToggle?.addEventListener("click", () => {
      const visible = password.type === "text";
      password.type = visible ? "password" : "text";
      passwordToggle.querySelector("span").textContent = visible ? "Показать" : "Скрыть";
      passwordToggle.setAttribute("aria-label", visible ? "Показать пароль" : "Скрыть пароль");
    });
    password?.addEventListener("input", () => {
      const value = password.value;
      const score = [value.length >= 8, /[A-ZА-Я]/.test(value) && /[a-zа-я]/.test(value), /\d/.test(value), /[^\wа-яА-Я]/.test(value)].filter(Boolean).length;
      form.dataset.passwordScore = String(score);
      passwordHint.textContent = !value ? "Минимум 8 символов" : score < 2 ? "Слабый пароль" : score < 4 ? "Хороший пароль" : "Надёжный пароль";
    });
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = Object.fromEntries(new FormData(form).entries());
      const button = form.querySelector("button[type=submit]");
      button.disabled = true;
      status.textContent = "Создаю защищённую учётную запись…";
      try {
        await PanelAPI.post("/admin/admins", body);
        form.reset();
        PanelAPI.bust("/admin/admins");
        toast("Администратор создан", "success");
        await renderAdmins();
      } catch (error) {
        status.textContent = error.message === "admin_username_taken" ? "Этот логин уже занят." : `Ошибка: ${error.message}`;
      } finally {
        button.disabled = false;
      }
    });
  }

  async function renderUsers() {
    main.innerHTML = `
      <div class="members-page">
        <section class="members-hero">
          <div><span class="members-eyebrow">Команда Garbona</span><h1>Участники</h1><p>Профиль, статистика, ссылки и доступ — в одной карточке.</p></div>
          <button type="button" class="btn-ghost members-sync" id="syncSteamAll">Обновить настройки UProject</button>
        </section>
        <div class="member-summary-grid" id="memberSummary"><div></div><div></div><div></div><div></div></div>
        <section class="members-workspace">
          <div class="members-toolbar-stack">
            <div class="members-toolbar-row">
              <div class="members-search"><svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="6.5" stroke="currentColor"/><path d="m16 16 4 4" stroke="currentColor"/></svg><input id="userSearch" type="search" placeholder="Имя, @username или Telegram ID"/><kbd>Enter</kbd></div>
              <div class="members-filters"><button class="is-active" data-list="team">Все</button><button data-list="curators">Кураторы</button><button data-list="callers">Прозвон</button></div>
            </div>
            <div class="members-attr-filters" id="memberAttrFilters">
              ${Object.entries(MEMBER_ATTR_FILTERS).map(([key, def]) => `<button type="button" data-member-filter="${key}" class="${memberAttrFilters.has(key) ? "is-active" : ""}">${escapeHtml(def.label)}</button>`).join("")}
            </div>
          </div>
          <div class="members-grid" id="usersGrid"><div class="members-loading">Загружаем команду…</div></div>
          <nav class="members-pagination" id="membersPagination" hidden aria-label="Страницы участников"></nav>
        </section>
      </div>
    `;

    const MEMBERS_PAGE_SIZE = 10;
    let cachedMembers = [];
    let membersPage = 0;

    function membersPaginationPages(page, pageCount) {
      const current = Math.min(Math.max(1, Number(page) || 1), pageCount);
      const pages = Array.from({ length: pageCount }, (_, index) => index + 1);
      if (pageCount <= 5) return pages;
      return pages.filter(
        (value) => value === 1 || value === pageCount || Math.abs(value - current) <= 1
      );
    }

    function renderMembersPagination(total) {
      const box = document.getElementById("membersPagination");
      if (!box) return;
      const pageCount = Math.max(1, Math.ceil(total / MEMBERS_PAGE_SIZE) || 1);
      if (pageCount <= 1 || !total) {
        box.hidden = true;
        box.innerHTML = "";
        return;
      }
      const page = membersPage + 1;
      const prevDisabled = page <= 1 ? " disabled" : "";
      const nextDisabled = page >= pageCount ? " disabled" : "";
      const visible = membersPaginationPages(page, pageCount);
      const pageButtons = visible
        .map((value, index) => {
          const prev = visible[index - 1];
          const gap = prev != null && value - prev > 1
            ? `<span class="members-pagination__gap">…</span>`
            : "";
          const active = value === page ? " is-active" : "";
          const current = value === page ? ' aria-current="page"' : "";
          return `<span class="members-pagination__page-wrap">${gap}<button type="button" class="members-pagination__page${active}" data-members-page="${value - 1}"${current}>${value}</button></span>`;
        })
        .join("");
      box.hidden = false;
      box.innerHTML = `
        <button type="button" class="members-pagination__arrow" data-members-page="${membersPage - 1}"${prevDisabled} aria-label="Назад">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 6 9 12l6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>Назад</span>
        </button>
        <div class="members-pagination__center">
          <div class="members-pagination__pages">${pageButtons}</div>
          <span class="members-pagination__info">Страница ${page} из ${pageCount}</span>
        </div>
        <button type="button" class="members-pagination__arrow" data-members-page="${membersPage + 1}"${nextDisabled} aria-label="Далее">
          <span>Далее</span>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>`;
    }

    function paintMembers(members) {
      const filtered = applyMemberAttrFilters(members);
      const summary = document.getElementById("memberSummary");
      summary.innerHTML = [["Участников",filtered.length],["Кураторов",filtered.filter((m) => m.isCurator).length],["С UProject",filtered.filter((m) => m.panelUsername).length],["Общий баланс",`$${filtered.reduce((s,m) => s + Number(m.walletUsd || 0),0).toFixed(2)}`]].map(([label,value],i) => `<div><span>${label}</span><strong>${escapeHtml(value)}</strong><i class="tone-${i}"></i></div>`).join("");
      const totalPages = Math.max(1, Math.ceil(filtered.length / MEMBERS_PAGE_SIZE) || 1);
      if (membersPage > totalPages - 1) membersPage = totalPages - 1;
      if (membersPage < 0) membersPage = 0;
      const pageItems = filtered.slice(membersPage * MEMBERS_PAGE_SIZE, membersPage * MEMBERS_PAGE_SIZE + MEMBERS_PAGE_SIZE);
      const grid = document.getElementById("usersGrid");
      grid.innerHTML = pageItems.length ? pageItems.map((m) => {
        const name = m.firstName || m.username || `ID ${m.telegramId}`;
        const initials = name.trim().slice(0,2).toUpperCase();
        const photo = /^(?:https?:\/\/|\/)/i.test(String(m.photoUrl || "")) ? m.photoUrl : "";
        const state = m.isBanned ? "Заблокирован" : m.isTeamMember ? "Активен" : "Вне команды";
        return `<button type="button" class="member-list-card" data-member-id="${escapeHtml(m.telegramId)}"><div class="member-list-main"><span class="member-list-avatar"><span>${escapeHtml(initials)}</span>${photo ? `<img src="${escapeHtml(photo)}" alt="" loading="lazy" referrerpolicy="no-referrer"/>` : ""}<i class="${m.isBanned ? "is-bad" : ""}"></i></span><div><b>${escapeHtml(name)}</b><small>${m.username ? `@${escapeHtml(m.username)}` : escapeHtml(m.telegramId)}</small></div><span class="member-list-chevron">→</span></div><div class="member-list-meta"><span><small>Роль</small><b>${roleOf(m)}</b></span><span><small>Процент</small><b>${m.profitPercent}%</b></span><span><small>Кошелёк</small><b>${escapeHtml(m.walletDisplay)}</b></span></div><div class="member-list-foot"><span class="${m.isBanned ? "is-bad" : ""}"><i></i>${state}</span><small>${m.panelUsername ? `UProject · ${escapeHtml(m.panelUsername)}` : "UProject не подключён"}</small></div></button>`;
      }).join("") : `<div class="members-empty"><b>Никого не нашли</b><span>${members.length && memberAttrFilters.size ? "Снимите фильтры или измените запрос." : "Попробуйте другой запрос или фильтр."}</span></div>`;
      grid.querySelectorAll(".member-list-avatar img").forEach((img) => img.addEventListener("error", () => img.remove()));
      grid.querySelectorAll("[data-member-id]").forEach((card) => card.addEventListener("click", () => openMember(card.dataset.memberId)));
      renderMembersPagination(filtered.length);
    }

    async function load(mode = "team", q = "") {
      membersPage = 0;
      main.querySelectorAll("[data-list]").forEach((b) => b.classList.toggle("is-active", b.dataset.list === mode));
      document.getElementById("memberAttrFilters")?.querySelectorAll("[data-member-filter]").forEach((b) => {
        b.classList.toggle("is-active", memberAttrFilters.has(b.dataset.memberFilter));
      });
      let data;
      if (mode === "curators") data = await PanelAPI.get("/admin/members/roles/curators");
      else if (mode === "callers") data = await PanelAPI.get("/admin/members/roles/callers");
      else data = await PanelAPI.get(`/admin/members${q ? `?q=${encodeURIComponent(q)}` : ""}`);
      cachedMembers = data.members || [];
      paintMembers(cachedMembers);
    }

    document.getElementById("userSearch").addEventListener("keydown", (e) => {
      if (e.key === "Enter") load("team", e.currentTarget.value.trim());
    });
    main.querySelectorAll("[data-list]").forEach((b) => {
      b.addEventListener("click", () => load(b.dataset.list));
    });
    document.getElementById("membersPagination")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-members-page]");
      if (!button || button.hasAttribute("disabled")) return;
      const next = Number(button.dataset.membersPage);
      if (!Number.isInteger(next) || next < 0 || next === membersPage) return;
      membersPage = next;
      paintMembers(cachedMembers);
      document.querySelector(".members-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    document.getElementById("memberAttrFilters")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-member-filter]");
      if (!button) return;
      toggleMemberAttrFilter(button.dataset.memberFilter);
      document.getElementById("memberAttrFilters")?.querySelectorAll("[data-member-filter]").forEach((b) => {
        b.classList.toggle("is-active", memberAttrFilters.has(b.dataset.memberFilter));
      });
      membersPage = 0;
      paintMembers(cachedMembers);
    });
    document.getElementById("syncSteamAll").addEventListener("click", async (event) => {
      const button = event.currentTarget; button.disabled = true; button.textContent = "Синхронизация…";
      try { const result = await PanelAPI.post("/admin/members/steam-settings/sync-all", {}); toast(`Готово: ${result.configured + result.unchanged}, ошибок: ${result.failed}`, result.failed ? "error" : "ok"); }
      catch (error) { toast(error.message, "error"); }
      finally { button.disabled = false; button.textContent = "Обновить настройки UProject"; }
    });
    await load("team");
  }

  function roleOf(m) {
    if (m.isCurator) return "Куратор";
    if (m.isCaller) return "Прозвонщица";
    if (m.isModerator) return "Модер";
    if (m.isTeamMember) return "Воркер";
    return "—";
  }

  function formatRate(value) {
    if (value == null || Number.isNaN(Number(value))) return "—";
    const num = Number(value);
    if (num < 10 && num > 0) return `${num.toFixed(1)}%`;
    return `${Math.round(num)}%`;
  }

  async function renderStats() {
    const [stats, top] = await Promise.all([
      PanelAPI.get(`/admin/stats?period=${statsPeriod}`),
      PanelAPI.get(`/admin/top?period=${statsPeriod}&limit=15`),
    ]);
    const adsTotals = stats.ads?.totals || {};
    main.innerHTML = `
      <div class="greeting">
        <div>
          <h1 class="greeting-title">Статистика</h1>
          <p class="greeting-sub">Период: ${escapeHtml(stats.periodLabel)}</p>
        </div>
        <div class="period-pills" id="statsPeriods">
          ${["all", "24h", "7d", "30d"]
            .map(
              (p) =>
                `<button type="button" class="period-pill ${
                  p === statsPeriod ? "is-active" : ""
                }" data-period="${p}">${periodLabel(p)}</button>`
            )
            .join("")}
        </div>
      </div>
      <div class="stats-row">
        <div class="stat-card"><div class="stat-label">Команда</div><div class="stat-value">${stats.teamCount}</div></div>
        <div class="stat-card"><div class="stat-label">Заявки</div><div class="stat-value">${stats.applications.total}</div><div class="stat-hint">принят ${stats.applications.accepted} · откл ${stats.applications.rejected}</div></div>
        <div class="stat-card"><div class="stat-label">Профиты</div><div class="stat-value">${stats.profits.count}</div></div>
        <div class="stat-card"><div class="stat-label">Сумма</div><div class="stat-value">${escapeHtml(stats.profits.totalDisplay)}</div></div>
      </div>
      <div class="panel-card">
        <div class="panel-card-head"><h2 class="panel-card-title">Реклама</h2><button type="button" class="btn-ghost" data-goto="ads">Открыть раздел</button></div>
        <div class="panel-card-body">
          <p class="muted">Старт→приём: <strong>${formatRate(adsTotals.startToAccepted)}</strong> · Старт→профит: <strong>${formatRate(adsTotals.startToProfit)}</strong></p>
        </div>
      </div>
      <div class="panel-card">
        <div class="panel-card-head"><h2 class="panel-card-title">Топ воркеров</h2></div>
        <div class="panel-card-body">
          <div class="table-wrap">
            <table class="data">
              <thead><tr><th>#</th><th>Воркер</th><th>Профитов</th><th>Сумма</th></tr></thead>
              <tbody id="topBody"></tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    const body = document.getElementById("topBody");
    (top.rows || []).forEach((r) => {
      const tr = document.createElement("tr");
      tr.className = "clickable-row";
      tr.innerHTML = `
        <td class="muted">${r.rank}</td>
        <td>${r.username ? `@${escapeHtml(r.username)}` : r.telegramId || "—"}</td>
        <td class="muted">${r.count}</td>
        <td>${escapeHtml(r.totalDisplay)}</td>
      `;
      if (r.telegramId) tr.addEventListener("click", () => openMember(r.telegramId));
      body.appendChild(tr);
    });
    if (!(top.rows || []).length) {
      body.innerHTML = `<tr><td colspan="4" class="muted">Пока пусто</td></tr>`;
    }
    document.getElementById("statsPeriods").addEventListener("click", (e) => {
      const b = e.target.closest("[data-period]");
      if (!b) return;
      statsPeriod = b.dataset.period;
      renderStats();
    });
    main.querySelector('[data-goto="ads"]')?.addEventListener("click", () =>
      showView("ads", { historyMode: "push" })
    );
  }

  function stopAdsLiveRefresh() {
    if (adsPollTimer) {
      clearInterval(adsPollTimer);
      adsPollTimer = null;
    }
  }

  function startAdsLiveRefresh() {
    stopAdsLiveRefresh();
    adsPollTimer = setInterval(() => {
      if (currentView !== "ads") {
        stopAdsLiveRefresh();
        return;
      }
      if (document.hidden) return;
      refreshAdsLive();
    }, ADS_POLL_MS);
  }

  function renderAdsTableRow(row) {
    const f = row.funnel || {};
    const isSelected = row.id === adsSelectedId;
    return `<tr class="clickable-row ${isSelected ? "is-selected" : ""}" data-ad-id="${escapeHtml(row.id)}">
      <td><strong>${escapeHtml(row.name)}</strong><div class="muted"><code>${escapeHtml(row.telegramUrl || "—")}</code></div>${row.source ? `<div class="muted">${escapeHtml(row.source)}</div>` : ""}</td>
      <td>${f.starts || 0}</td>
      <td>${f.applications || 0}<div class="muted">${formatRate(f.startToApplication)}</div></td>
      <td>${f.accepted || 0}<div class="muted">${formatRate(f.startToAccepted)}</div></td>
      <td>${f.firstProfit || 0}<div class="muted">${formatRate(f.startToProfit)}</div></td>
      <td>${f.clicks || 0}</td>
      <td class="ads-row-actions">
        <button type="button" class="btn-ghost" data-ad-copy="${escapeHtml(row.telegramUrl || "")}">Ссылка</button>
        <button type="button" class="btn-ghost" data-ad-toggle="${escapeHtml(row.id)}" data-ad-status="${row.status === "paused" ? "active" : "paused"}">${row.status === "paused" ? "Возобновить" : "Пауза"}</button>
        <button type="button" class="btn-ghost btn-danger" data-ad-delete="${escapeHtml(row.id)}">Удалить</button>
      </td>
    </tr>`;
  }

  function renderAdsDetailCard(selected, cohort) {
    if (!selected) return "";
    return `
      <div class="panel-card" id="adsDetailCard">
        <div class="panel-card-head">
          <h2 class="panel-card-title">${escapeHtml(selected.name)}</h2>
          <div class="panel-card-head-actions">
            <span class="muted">${selected.status === "paused" ? "на паузе" : "активна"}</span>
            <button type="button" class="btn-ghost btn-danger" data-ad-delete="${escapeHtml(selected.id)}">Удалить</button>
          </div>
        </div>
        <div class="panel-card-body">
          <div class="settings-grid">
            <div class="settings-field"><span>Ссылка для рекламы</span><div class="member-inline-copy"><code>${escapeHtml(selected.telegramUrl || "—")}</code><button type="button" class="btn-ghost" data-copy="${escapeHtml(selected.telegramUrl || "")}">Копировать</button></div></div>
            ${selected.trackingUrl ? `<div class="settings-field"><span>Клики</span><div class="member-inline-copy"><code>${escapeHtml(selected.trackingUrl)}</code><button type="button" class="btn-ghost" data-copy="${escapeHtml(selected.trackingUrl)}">Копировать</button></div></div>` : ""}
          </div>
          <div class="table-wrap" style="margin-top:16px">
            <table class="data">
              <thead><tr><th>Пользователь</th><th>Старт</th><th>Заявка</th><th>В команде</th><th>Профит</th></tr></thead>
              <tbody id="adsCohortBody">${renderAdsCohortRows(cohort?.members || [])}</tbody>
            </table>
          </div>
        </div>
      </div>`;
  }

  function renderAdsCohortRows(members) {
    if (!members.length) {
      return `<tr><td colspan="5" class="muted">Пока никого в когорте</td></tr>`;
    }
    return members
      .map(
        (member) => `<tr class="clickable-row" data-open-member="${escapeHtml(member.telegramId)}">
            <td>${member.username ? `@${escapeHtml(member.username)}` : escapeHtml(member.telegramId)}</td>
            <td class="muted">${member.attributedAt ? new Date(member.attributedAt).toLocaleString("ru-RU") : "—"}</td>
            <td>${escapeHtml(member.applicationStatus || "—")}</td>
            <td>${member.isTeamMember ? "да" : "нет"}</td>
            <td>${member.hasFirstProfit ? "да" : "нет"}</td>
          </tr>`
      )
      .join("");
  }

  function bindAdsTableEvents() {
    const body = document.getElementById("adsBody");
    if (!body) return;

    body.querySelectorAll("[data-ad-id]").forEach((row) => {
      row.addEventListener("click", (event) => {
        if (event.target.closest("button")) return;
        const next = row.dataset.adId;
        adsSelectedId = adsSelectedId === next ? "" : next;
        renderAds();
      });
    });

    body.querySelectorAll("[data-ad-copy]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        try {
          await navigator.clipboard.writeText(button.dataset.adCopy || "");
          toast("Ссылка скопирована");
        } catch (_) {
          toast("Не удалось скопировать", "error");
        }
      });
    });

    body.querySelectorAll("[data-ad-toggle]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        try {
          await PanelAPI.patch(`/admin/ads/${button.dataset.adToggle}`, {
            status: button.dataset.adStatus,
          });
          PanelAPI.bust("/admin/ads");
          toast("Статус рекламы обновлён");
          await refreshAdsLive({ force: true });
        } catch (error) {
          toast(error.message, "error");
        }
      });
    });

    body.querySelectorAll("[data-ad-delete]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        if (!(await GarbonaAdminConfirm.open("Удалить рекламу? Ссылка перестанет работать.", { confirmLabel: "Удалить" }))) {
          return;
        }
        try {
          await PanelAPI.del(`/admin/ads/${button.dataset.adDelete}`);
          PanelAPI.bust("/admin/ads");
          if (adsSelectedId === button.dataset.adDelete) {
            adsSelectedId = "";
          }
          toast("Реклама удалена");
          await refreshAdsLive({ force: true });
        } catch (error) {
          toast(error.message, "error");
        }
      });
    });
  }

  function bindAdsDetailEvents() {
    const cohortBody = document.getElementById("adsCohortBody");
    cohortBody?.querySelectorAll("[data-open-member]").forEach((row) => {
      row.addEventListener("click", () => openMember(row.dataset.openMember));
    });

    document.getElementById("adsDetailCard")?.querySelectorAll("[data-copy]").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(button.dataset.copy || "");
          toast("Скопировано");
        } catch (_) {
          toast("Не удалось скопировать", "error");
        }
      });
    });

    document.getElementById("adsDetailCard")?.querySelectorAll("[data-ad-delete]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (!(await GarbonaAdminConfirm.open("Удалить рекламу? Ссылка перестанет работать.", { confirmLabel: "Удалить" }))) {
          return;
        }
        try {
          await PanelAPI.del(`/admin/ads/${button.dataset.adDelete}`);
          PanelAPI.bust("/admin/ads");
          adsSelectedId = "";
          toast("Реклама удалена");
          await refreshAdsLive({ force: true });
        } catch (error) {
          toast(error.message, "error");
        }
      });
    });
  }

  async function fetchAdsData({ force = false } = {}) {
    const dashPath = `/admin/ads?period=${adsPeriod}`;
    const cohortPath = adsSelectedId
      ? `/admin/ads?period=${adsPeriod}&campaignId=${encodeURIComponent(adsSelectedId)}`
      : "";
    const requests = [PanelAPI.get(dashPath, { force })];
    if (cohortPath) requests.push(PanelAPI.get(cohortPath, { force }));
    const [dash, cohort] = await Promise.all(requests);
    return { dash, cohort: cohortPath ? cohort : null };
  }

  function applyAdsData(dash, cohort) {
    if (!dash?.campaigns?.some((row) => row.id === adsSelectedId)) {
      adsSelectedId = "";
    }
    const selected = dash.campaigns.find((row) => row.id === adsSelectedId) || null;
    const rows = dash.campaigns || [];
    const body = document.getElementById("adsBody");
    if (body) {
      body.innerHTML = rows.length
        ? rows.map((row) => renderAdsTableRow(row)).join("")
        : `<tr><td colspan="7" class="muted">Реклама пока не создана</td></tr>`;
      bindAdsTableEvents();
    }

    let detailCard = document.getElementById("adsDetailCard");
    if (selected) {
      const nextHtml = renderAdsDetailCard(selected, cohort);
      if (detailCard) detailCard.outerHTML = nextHtml;
      else main.insertAdjacentHTML("beforeend", nextHtml);
      bindAdsDetailEvents();
    } else if (detailCard) {
      detailCard.remove();
    }
  }

  async function refreshAdsLive({ force = true } = {}) {
    if (currentView !== "ads" || !document.getElementById("adsBody")) return;
    try {
      const { dash, cohort } = await fetchAdsData({ force });
      if (currentView !== "ads" || !document.getElementById("adsBody")) return;
      applyAdsData(dash, cohort);
    } catch (_) {
      /* ignore transient poll errors */
    }
  }

  async function renderAds({ live = false } = {}) {
    if (live && document.getElementById("adsBody")) {
      await refreshAdsLive({ force: true });
      return;
    }

    const { dash, cohort } = await fetchAdsData({ force: true });
    if (currentView !== "ads") return;
    const selected = dash.campaigns.find((row) => row.id === adsSelectedId) || null;

    main.innerHTML = `
      <div class="greeting">
        <div>
          <h1 class="greeting-title">Реклама</h1>
          <p class="greeting-sub">Период: ${periodLabel(adsPeriod)} · обновляется автоматически</p>
        </div>
        <div class="period-pills" id="adsPeriods">
          ${["all", "24h", "7d", "30d"]
            .map(
              (p) =>
                `<button type="button" class="period-pill ${
                  p === adsPeriod ? "is-active" : ""
                }" data-period="${p}">${periodLabel(p)}</button>`
            )
            .join("")}
        </div>
      </div>
      <div class="panel-card">
        <div class="panel-card-head"><h2 class="panel-card-title">Новая реклама</h2></div>
        <div class="panel-card-body">
          <form id="adsCreateForm" class="settings-grid">
            <label class="settings-field"><span>Название рекламы</span><input class="settings-input" name="name" required maxlength="80" placeholder="Март — Telegram" /></label>
            <label class="settings-field"><span>Название ссылки</span><input class="settings-input" name="slug" required maxlength="24" placeholder="tg_march" /><small class="muted">Будет в ссылке: ?start=c_…</small></label>
            <label class="settings-field"><span>Площадка</span><input class="settings-input" name="source" maxlength="120" placeholder="Тг бот/Форум" /></label>
            <div class="settings-actions"><button type="submit" class="btn-primary">Создать</button></div>
          </form>
        </div>
      </div>
      <div class="panel-card">
        <div class="panel-card-head"><h2 class="panel-card-title">Реклама</h2></div>
        <div class="panel-card-body">
          <div class="table-wrap">
            <table class="data">
              <thead><tr><th>Название</th><th>Старты</th><th>Заявки</th><th>Приём</th><th>Профит</th><th>Клики</th><th></th></tr></thead>
              <tbody id="adsBody"></tbody>
            </table>
          </div>
        </div>
      </div>
      ${renderAdsDetailCard(selected, cohort)}
    `;

    applyAdsData(dash, cohort);

    document.getElementById("adsPeriods").addEventListener("click", (e) => {
      const b = e.target.closest("[data-period]");
      if (!b) return;
      adsPeriod = b.dataset.period;
      renderAds();
    });

    document.getElementById("adsCreateForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const payload = {
        name: form.name.value.trim(),
        slug: form.slug.value.trim(),
        source: form.source.value.trim(),
      };
      try {
        await PanelAPI.post("/admin/ads", payload);
        PanelAPI.bust("/admin/ads");
        form.reset();
        toast("Реклама создана");
        await refreshAdsLive({ force: true });
      } catch (error) {
        toast(error.message, "error");
      }
    });

    startAdsLiveRefresh();
  }

  function periodLabel(p) {
    return { all: "Всё время", "24h": "24ч", "7d": "7д", "30d": "30д" }[p] || p;
  }

  async function renderEconomy() {
    const eco = await PanelAPI.get("/admin/economy");
    main.innerHTML = `
      <div class="settings-page">
        <div class="greeting">
          <div>
            <h1 class="greeting-title">Экономика</h1>
            <p class="greeting-sub">Глобальные параметры выплат и отображения</p>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-label">
            <h3 class="settings-section-title">Выплаты воркерам</h3>
            <span class="settings-section-desc">Влияет на всех участников</span>
          </div>
          <div class="settings-card">
            <div class="settings-row">
              <div class="settings-row-text">
                <div class="settings-row-title">Глобальный %</div>
                <div class="settings-row-desc">Процент от профита на баланс всем воркерам</div>
              </div>
              <div class="settings-row-control">
                <div class="settings-input-wrap">
                  <input class="settings-input" id="ecoPercent" type="number" min="1" max="100" value="${eco.globalPercent}" />
                  <span class="settings-suffix">%</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-label">
            <h3 class="settings-section-title">Комиссии вывода</h3>
            <span class="settings-section-desc">USD, вычитается из суммы заявки по методу</span>
          </div>
          <div class="settings-card" id="ecoWithdrawFees">
            ${[
              ["usdt_trc20", "USDT TRC20"],
              ["usdt_bep20", "USDT BEP20"],
              ["ton_gram", "TON (GRAM)"],
              ["solana", "Solana"],
              ["cryptobot", "CryptoBot"],
              ["xRocketr", "xRocket"],
              ["lolz", "Lolz"],
            ]
              .map(
                ([key, label]) => `
            <div class="settings-row">
              <div class="settings-row-text">
                <div class="settings-row-title">${label}</div>
              </div>
              <div class="settings-row-control">
                <div class="settings-input-wrap">
                  <input class="settings-input eco-fee-input" data-fee-key="${key}" type="number" min="0" step="0.01" value="${Number((eco.withdrawalFees || {})[key] ?? 0).toFixed(2)}" />
                  <span class="settings-suffix">$</span>
                </div>
              </div>
            </div>`
              )
              .join("")}
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-label">
            <h3 class="settings-section-title">Отображение</h3>
            <span class="settings-section-desc">Только UI, балансы в USD</span>
          </div>
          <div class="settings-card">
            <div class="settings-row">
              <div class="settings-row-text">
                <div class="settings-row-title">Валюта</div>
                <div class="settings-row-desc">Формат сумм в боте и панели</div>
              </div>
              <div class="seg" id="ecoCurrency">
                <button type="button" class="seg-btn ${eco.currency === "USD" ? "is-active" : ""}" data-cur="USD">USD</button>
                <button type="button" class="seg-btn ${eco.currency === "RUB" ? "is-active" : ""}" data-cur="RUB">RUB</button>
              </div>
            </div>
            <div class="settings-row">
              <div class="settings-row-text">
                <div class="settings-row-title">Курс USD→RUB</div>
                <div class="settings-row-desc">Используется при валюте RUB</div>
              </div>
              <div class="settings-row-control">
                <div class="settings-input-wrap">
                  <input class="settings-input" id="ecoRate" type="number" min="0.01" step="0.01" value="${eco.rate}" />
                  <span class="settings-suffix">₽</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-label">
            <h3 class="settings-section-title">Имитация</h3>
            <span class="settings-section-desc">Косметические посты в каналы / ЛС</span>
          </div>
          <div class="settings-card">
            <div class="settings-card-body">
              <div class="settings-row-title">Фейк-профит</div>
              <div class="settings-row-desc">Укажите сумму MaFile — бот подберёт 5 скинов из базы. Опционально: баланс, MaFile-время и игры.</div>
              <div class="drawer-actions" style="margin-bottom:10px;flex-wrap:wrap;gap:8px">
                <input class="search-input" id="fakeProfitTotal" type="number" min="5" step="0.01" placeholder="Сумма MaFile ($)" style="max-width:180px" />
                <input class="search-input" id="fakeProfitBalance" type="number" min="0" step="0.01" placeholder="Баланс Steam ($)" style="max-width:160px" />
                <input class="search-input" id="fakeProfitMafile" placeholder="MaFile: часы или дата" style="max-width:180px" />
                <input class="search-input" id="fakeProfitGames" type="number" min="0" max="4" step="1" value="4" placeholder="Игр (0–4)" style="max-width:120px" />
              </div>
              <details class="settings-details" style="margin-bottom:10px">
                <summary class="settings-row-desc" style="cursor:pointer">Ручной режим — свои скины (5–7 строк)</summary>
                <textarea class="settings-textarea" id="fakeProfitText" placeholder="AK-47 | Redline (Field-Tested)&#10;AWP | Asiimov (Field-Tested)&#10;..."></textarea>
              </details>
              <div class="drawer-actions">
                <input class="search-input" id="fakeProfitTag" maxlength="6" placeholder="FAKE-TAG (aelita)" style="max-width:160px" />
                <input class="search-input" id="fakeProfitOwner" placeholder="Telegram ID владельца" />
                <button type="button" class="btn-primary" id="fakeProfitBtn">Отправить</button>
              </div>
              <div class="settings-row-desc">Без ID владельца — в канале будет <code>#тег</code> и <code>[ID: Аноним]</code>. Пустой тег → случайный (до 6 симв.).</div>
            </div>
          </div>
          <div class="settings-card">
            <div class="settings-card-body">
              <div class="settings-row-title">Фейк-лог</div>
              <div class="settings-row-desc">Лимит, баланс, инвентарь, уровень, актив, игры — по строке</div>
              <textarea class="settings-textarea" id="fakeLogText">лимит: Нет
баланс: 12.50
инвентарь: 150.00
уровень: 42
актив: 2024-08-15
игры: 8</textarea>
              <div class="drawer-actions">
                <input class="search-input" id="fakeLogOwner" placeholder="Telegram ID получателя" />
                <button type="button" class="btn-primary" id="fakeLogBtn">Отправить в ЛС</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    const savePercent = debounce(async () => {
      try {
        await PanelAPI.patch("/admin/economy", {
          globalPercent: Number(document.getElementById("ecoPercent").value),
        });
        toast("Глобальный % сохранён");
      } catch (e) {
        toast(e.message, "error");
      }
    }, 400);

    const saveRate = debounce(async () => {
      try {
        await PanelAPI.patch("/admin/economy", {
          rate: Number(document.getElementById("ecoRate").value),
        });
        toast("Курс сохранён");
      } catch (e) {
        toast(e.message, "error");
      }
    }, 400);

    const saveFees = debounce(async () => {
      try {
        const withdrawalFees = {};
        document.querySelectorAll(".eco-fee-input").forEach((input) => {
          const key = input.dataset.feeKey;
          if (!key) return;
          withdrawalFees[key] = Number(input.value);
        });
        await PanelAPI.patch("/admin/economy", { withdrawalFees });
        toast("Комиссии вывода сохранены");
      } catch (e) {
        toast(e.message, "error");
      }
    }, 400);

    document.getElementById("ecoPercent").addEventListener("change", savePercent);
    document.getElementById("ecoPercent").addEventListener("input", savePercent);
    document.getElementById("ecoRate").addEventListener("change", saveRate);
    document.getElementById("ecoRate").addEventListener("input", saveRate);
    document.querySelectorAll(".eco-fee-input").forEach((input) => {
      input.addEventListener("change", saveFees);
      input.addEventListener("input", saveFees);
    });

    document.getElementById("ecoCurrency").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-cur]");
      if (!b) return;
      try {
        await PanelAPI.patch("/admin/economy", { currency: b.dataset.cur });
        toast(`Валюта: ${b.dataset.cur}`);
        renderEconomy();
      } catch (err) {
        toast(err.message, "error");
      }
    });

    document.getElementById("fakeProfitBtn").addEventListener("click", async () => {
      try {
        const manualText = document.getElementById("fakeProfitText").value.trim();
        const totalUsd = document.getElementById("fakeProfitTotal").value;
        if (!manualText && (!totalUsd || Number(totalUsd) < 5)) {
          toast("Укажите сумму MaFile от $5", "error");
          return;
        }
        const ownerTelegramId = document.getElementById("fakeProfitOwner").value.trim();
        const result = await PanelAPI.post("/admin/economy/fake-profit", {
          text: manualText,
          totalUsd: manualText ? "" : totalUsd,
          balanceUsd: document.getElementById("fakeProfitBalance").value,
          mafileTime: document.getElementById("fakeProfitMafile").value.trim(),
          gamesCount: document.getElementById("fakeProfitGames").value,
          fakeTag: ownerTelegramId ? "" : document.getElementById("fakeProfitTag").value.trim(),
          ownerTelegramId,
        });
        toast(ownerTelegramId
          ? `Фейк-профит отправлен · #${result.sourceId || "?"}`
          : `Фейк-профит · #${result.fakeTag || "?"} · ${result.sourceId || ""}`);
      } catch (e) {
        toast(e.message, "error");
      }
    });

    document.getElementById("fakeLogBtn").addEventListener("click", async () => {
      try {
        await PanelAPI.post("/admin/economy/fake-log", {
          text: document.getElementById("fakeLogText").value,
          ownerTelegramId: document.getElementById("fakeLogOwner").value.trim(),
        });
        toast("Фейк-лог отправлен");
      } catch (e) {
        toast(e.message, "error");
      }
    });
  }

  async function renderApps() {
    const data = await PanelAPI.get(`/admin/apps?kind=${appsKind}&page=${appsPage}`, { force: true });
    const labels = new Map((data.questions || []).map((q) => [q.key, q.label]));
    const statusLabel = (status) => ({ pending: "На рассмотрении", accepted: "Принята", rejected: "Отклонена" }[status] || status);
    main.innerHTML = `
      <div class="applications-page">
        <section class="applications-hero"><div><span>Набор в команду</span><h1>Заявки</h1><p>Спокойная очередь решений: ответы, контекст и действия без таблиц.</p></div><div class="applications-switch"><button class="${appsKind === "pending" ? "is-active" : ""}" data-kind="pending">Очередь <b>${data.counts?.pending || 0}</b></button><button class="${appsKind === "closed" ? "is-active" : ""}" data-kind="closed">История <b>${(data.counts?.accepted || 0) + (data.counts?.rejected || 0)}</b></button></div></section>
        <div class="application-summary"><div><span>Ожидают решения</span><strong>${data.counts?.pending || 0}</strong><i class="is-wait"></i></div><div><span>Принято</span><strong>${data.counts?.accepted || 0}</strong><i class="is-ok"></i></div><div><span>Отклонено</span><strong>${data.counts?.rejected || 0}</strong><i class="is-bad"></i></div></div>
        <div class="application-list" id="appsBody"></div>
        ${data.totalPages > 1 ? `<nav class="application-pagination"><button id="appsPrev" ${appsPage <= 0 ? "disabled" : ""}>← Назад</button><span>${appsPage + 1} / ${data.totalPages}</span><button id="appsNext" ${appsPage >= data.totalPages - 1 ? "disabled" : ""}>Дальше →</button></nav>` : ""}
      </div>
    `;
    const body = document.getElementById("appsBody");
    const decideApp = async (id, action, { confirmText } = {}) => {
      if (confirmText && !(await GarbonaAdminConfirm.open(confirmText, { confirmLabel: "Отклонить" }))) return;
      try {
        const result = await PanelAPI.post(`/admin/apps/${id}/decide`, { action });
        toast(
          result?.reversed
            ? action === "accept"
              ? "Решение изменено: принята"
              : "Решение изменено: отклонена"
            : action === "accept"
              ? "Принято"
              : "Отклонено"
        );
        PanelAPI.bust("/admin/apps"); renderApps();
      } catch (e) {
        toast(e.message, "error");
      }
    };
    body.innerHTML = (data.apps || []).length ? data.apps.map((a) => {
      const name = a.firstName || a.username || `ID ${a.telegramId || "—"}`;
      const answers = Object.entries(a.answers || {});
      const avatar = /^(?:https?:\/\/|\/)/i.test(String(a.avatarUrl || "")) ? a.avatarUrl : "";
      return `<article class="application-card ${a.status !== "pending" ? "is-closed" : ""}"><header><div class="application-person"><span>${escapeHtml(name.trim().slice(0,2).toUpperCase())}${avatar ? `<img src="${escapeHtml(avatar)}" alt="" loading="lazy"/>` : ""}</span><div><h2>${escapeHtml(name)}</h2><p>${a.username ? `@${escapeHtml(a.username)}` : escapeHtml(a.telegramId || "Без Telegram ID")}</p></div></div><div class="application-state ${a.status}"><i></i>${statusLabel(a.status)}</div></header><div class="application-meta"><span>Заявка <code>#${escapeHtml(a.id.slice(-6))}</code></span><span>${new Date(a.createdAt).toLocaleString("ru-RU", { day:"2-digit", month:"long", hour:"2-digit", minute:"2-digit" })}</span>${a.campaignName ? `<span>Реклама <code>${escapeHtml(a.campaignTelegramUrl || a.campaignName)}</code></span>` : ""}${a.moderatorId ? `<span>Модератор <code>${escapeHtml(a.moderatorId)}</code></span>` : ""}</div><div class="application-answers">${answers.length ? answers.map(([key,value],index) => `<div class="${index === 0 && answers.length > 2 ? "is-wide" : ""}"><span>${escapeHtml(labels.get(key) || key)}</span><p>${escapeHtml(value || "—")}</p></div>`).join("") : `<div class="is-wide"><span>Ответы</span><p>Не заполнены</p></div>`}</div><footer><div class="application-actions">${a.status === "pending" ? `<button class="btn-primary" data-app-action="accept" data-app-id="${a.id}">Принять в команду</button><button class="btn-ghost btn-danger" data-app-action="reject" data-app-id="${a.id}">Отклонить</button>` : a.status === "rejected" ? `<button class="btn-primary" data-app-action="accept" data-app-id="${a.id}">Изменить → принять</button>` : `<button class="btn-ghost btn-danger" data-app-action="reject" data-app-id="${a.id}" data-reverse="1">Изменить → отклонить</button>`}</div>${a.telegramId ? `<button class="application-profile" data-app-member="${escapeHtml(a.telegramId)}">Открыть профиль <b>→</b></button>` : ""}</footer></article>`;
    }).join("") : `<div class="applications-empty"><span>✓</span><b>${appsKind === "pending" ? "Очередь разобрана" : "История пока пуста"}</b><p>${appsKind === "pending" ? "Новых заявок сейчас нет." : "Здесь появятся принятые и отклонённые заявки."}</p></div>`;
    body.querySelectorAll(".application-person img").forEach((img) => img.addEventListener("error", () => img.remove()));
    body.querySelectorAll("[data-app-action]").forEach((button) => button.addEventListener("click", () => decideApp(button.dataset.appId, button.dataset.appAction, button.dataset.reverse ? { confirmText:"Отклонить принятую заявку? Пользователь будет исключён из команды." } : {})));
    body.querySelectorAll("[data-app-member]").forEach((button) => button.addEventListener("click", () => openMember(button.dataset.appMember)));
    main.querySelectorAll("[data-kind]").forEach((b) => {
      b.addEventListener("click", () => {
        appsKind = b.dataset.kind; appsPage = 0;
        renderApps();
      });
    });
    document.getElementById("appsPrev")?.addEventListener("click", () => { appsPage = Math.max(0, appsPage - 1); renderApps(); });
    document.getElementById("appsNext")?.addEventListener("click", () => { appsPage += 1; renderApps(); });
  }

  async function renderComms() {
    let recipients = { count: 0 };
    try {
      recipients = await PanelAPI.get("/admin/comms/recipients");
    } catch (_) {
      /* ignore */
    }
    main.innerHTML = `
      <div class="settings-page">
        <div class="greeting">
          <div>
            <h1 class="greeting-title">Коммуникация</h1>
            <p class="greeting-sub">Получателей рассылки: ${recipients.count}</p>
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-section-label">
            <h3 class="settings-section-title">Рассылка</h3>
            <span class="settings-section-desc">Текст всем участникам команды в Telegram</span>
          </div>
          <div class="settings-card">
            <div class="settings-card-body">
              <textarea class="settings-textarea" id="broadcastText" placeholder="HTML-текст…"></textarea>
              <button type="button" class="btn-primary" id="broadcastBtn">Отправить</button>
            </div>
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-section-label">
            <h3 class="settings-section-title">Уведомление в панель</h3>
            <span class="settings-section-desc">WebApp и сайт · колокольчик у воркеров</span>
          </div>
          <div class="settings-card">
            <div class="settings-card-body comms-panel-notify">
              <label class="settings-field">
                <span class="settings-field-label">Заголовок</span>
                <input type="text" class="settings-input" id="panelNotifyTitle" maxlength="120" placeholder="Например: Обновление правил" />
              </label>
              <label class="settings-field">
                <span class="settings-field-label">Текст (HTML)</span>
                <textarea class="settings-textarea" id="panelNotifyMessage" placeholder="Поддерживаются &lt;b&gt;, &lt;i&gt;, &lt;u&gt;, &lt;code&gt;, &lt;a href=&quot;…&quot;&gt;"></textarea>
              </label>
              <div class="comms-panel-notify-row">
                <label class="settings-field">
                  <span class="settings-field-label">Важность</span>
                  <select class="settings-input" id="panelNotifySeverity">
                    <option value="info">Информация</option>
                    <option value="warn">Внимание</option>
                    <option value="danger">Важно</option>
                  </select>
                </label>
                <label class="settings-field">
                  <span class="settings-field-label">При клике</span>
                  <select class="settings-input" id="panelNotifyLinkType">
                    <option value="none">Никуда</option>
                    <option value="view">Раздел панели</option>
                    <option value="url">Внешняя ссылка</option>
                    <option value="domain">Домен (сайты)</option>
                  </select>
                </label>
              </div>
              <label class="settings-field" id="panelNotifyLinkViewWrap" hidden>
                <span class="settings-field-label">Раздел</span>
                <select class="settings-input" id="panelNotifyLinkView">
                  <option value="dashboard">Главная</option>
                  <option value="sites">Сайты</option>
                  <option value="analytics">Аналитика</option>
                  <option value="top">Топ</option>
                  <option value="wallet">Кошелёк</option>
                  <option value="settings">Настройки</option>
                  <option value="support">Поддержка</option>
                </select>
              </label>
              <label class="settings-field" id="panelNotifyLinkUrlWrap" hidden>
                <span class="settings-field-label">URL</span>
                <input type="url" class="settings-input" id="panelNotifyLinkUrl" placeholder="https://…" />
              </label>
              <label class="settings-field" id="panelNotifyLinkDomainWrap" hidden>
                <span class="settings-field-label">ID домена</span>
                <input type="number" class="settings-input" id="panelNotifyLinkDomain" min="1" placeholder="123" />
              </label>
              <button type="button" class="btn-primary" id="panelNotifyBtn">Отправить в панель</button>
            </div>
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-section-label">
            <h3 class="settings-section-title">Динамический закреп</h3>
            <span class="settings-section-desc">Чат воркеров · автообновление</span>
          </div>
          <div class="settings-card">
            <div class="settings-row">
              <div class="settings-row-text">
                <div class="settings-row-title">Обновить Live Pin</div>
                <div class="settings-row-desc">Стафф, профиты сегодня, курс, статус API</div>
              </div>
              <button type="button" class="btn-primary" id="dynamicPinBtn">Обновить</button>
            </div>
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-section-label">
            <h3 class="settings-section-title">Анонс Discord</h3>
            <span class="settings-section-desc">Рассылка в Telegram + уведомление в панель</span>
          </div>
          <div class="settings-card">
            <div class="settings-row">
              <div class="settings-row-text">
                <div class="settings-row-title">Discord открыт — залетайте</div>
                <div class="settings-row-desc">Всем в команде: TG ЛС + колокольчик в панели со ссылкой</div>
              </div>
              <button type="button" class="btn-primary" id="discordAnnounceBtn">Отправить</button>
            </div>
          </div>
        </div>
      </div>
    `;

    const linkTypeEl = document.getElementById("panelNotifyLinkType");
    const linkViewWrap = document.getElementById("panelNotifyLinkViewWrap");
    const linkUrlWrap = document.getElementById("panelNotifyLinkUrlWrap");
    const linkDomainWrap = document.getElementById("panelNotifyLinkDomainWrap");

    function syncPanelNotifyLinkFields() {
      const type = linkTypeEl?.value || "none";
      if (linkViewWrap) linkViewWrap.hidden = type !== "view";
      if (linkUrlWrap) linkUrlWrap.hidden = type !== "url";
      if (linkDomainWrap) linkDomainWrap.hidden = type !== "domain";
    }
    linkTypeEl?.addEventListener("change", syncPanelNotifyLinkFields);
    syncPanelNotifyLinkFields();

    document.getElementById("broadcastBtn").addEventListener("click", async () => {
      if (!(await GarbonaAdminConfirm.open("Отправить рассылку всем?", { confirmLabel: "Отправить" }))) return;
      try {
        const result = await PanelAPI.post("/admin/comms/broadcast", {
          text: document.getElementById("broadcastText").value,
        });
        toast(`Готово: ${JSON.stringify(result.result || result)}`);
      } catch (e) {
        toast(e.message, "error");
      }
    });

    document.getElementById("panelNotifyBtn").addEventListener("click", async () => {
      if (!(await GarbonaAdminConfirm.open("Отправить уведомление всем воркерам в панели?", { confirmLabel: "Отправить" }))) return;
      const linkType = linkTypeEl?.value || "none";
      const payload = {
        title: document.getElementById("panelNotifyTitle")?.value || "",
        messageHtml: document.getElementById("panelNotifyMessage")?.value || "",
        severity: document.getElementById("panelNotifySeverity")?.value || "info",
        linkType,
      };
      if (linkType === "view") {
        payload.linkView = document.getElementById("panelNotifyLinkView")?.value || "";
      } else if (linkType === "url") {
        payload.linkUrl = document.getElementById("panelNotifyLinkUrl")?.value || "";
      } else if (linkType === "domain") {
        payload.linkDomainId = document.getElementById("panelNotifyLinkDomain")?.value || "";
      }
      try {
        const data = await PanelAPI.post("/admin/comms/panel-notify", payload);
        toast(`Уведомление отправлено · ${data.notification?.title || "ok"}`);
        document.getElementById("panelNotifyTitle").value = "";
        document.getElementById("panelNotifyMessage").value = "";
      } catch (e) {
        toast(e.message, "error");
      }
    });

    document.getElementById("dynamicPinBtn").addEventListener("click", async () => {
      try {
        const data = await PanelAPI.post("/admin/comms/dynamic-pin", {});
        const r = data.result || data;
        toast(`Live Pin · ${r.refreshed ? "обновлён" : "создан"} · ${r.messageId || "ok"}`);
      } catch (e) {
        toast(e.message, "error");
      }
    });

    document.getElementById("discordAnnounceBtn")?.addEventListener("click", async () => {
      if (!(await GarbonaAdminConfirm.open(
        "Отправить анонс Discord всем в Telegram и в панель?",
        { confirmLabel: "Отправить" }
      ))) return;
      try {
        const data = await PanelAPI.post("/admin/comms/discord-announce", {});
        const b = data.broadcast || {};
        toast(`Discord анонс · TG ${b.success || 0}/${b.total || 0} · панель ok`);
      } catch (e) {
        toast(e.message, "error");
      }
    });
  }

  const PAYOUT_STATUS_LABEL = {
    pending: "Новая",
    awaiting_payout_link: "Ожидает ссылку",
    approved: "Одобрена",
    rejected: "Отклонена",
  };
  const PAYOUT_METHOD_LABEL = {
    xRocketr: "xRocket",
    cryptobot: "CryptoBot",
    usdt_trc20: "USDT TRC20",
    usdt_bep20: "USDT BEP20",
    ton_gram: "TON (GRAM)",
    solana: "Solana",
    usdt_ton: "USDT TON",
    lolz: "Lolz",
  };

  function payoutUsd(value) {
    return `$${Number(value || 0).toFixed(2)}`;
  }

  function payoutWhen(value) {
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

  function payoutSignedUsd(value, direction) {
    const amount = Math.abs(Number(value || 0));
    const out = direction === "out" || Number(value) < 0;
    return `${out ? "−" : "+"}$${amount.toFixed(2)}`;
  }

  async function copyPayoutText(value, ok = "Скопировано") {
    const text = String(value || "").trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast(ok);
    } catch (_) {
      toast("Не удалось скопировать", "error");
    }
  }

  function payoutFundingLabelHtml(row) {
    const label = String(row.label || "Начисление");
    const sourceId = String(row.sourceId || "").trim();
    if (sourceId && label.includes(`#${sourceId}`)) {
      const before = label.slice(0, label.indexOf(`#${sourceId}`));
      return `${escapeHtml(before)}<button type="button" class="payout-id-btn" data-copy="${escapeHtml(sourceId)}" title="Скопировать ID лога">#${escapeHtml(sourceId)}</button>`;
    }
    if (sourceId) {
      return `${escapeHtml(label)} <button type="button" class="payout-id-btn" data-copy="${escapeHtml(sourceId)}" title="Скопировать ID лога">#${escapeHtml(sourceId)}</button>`;
    }
    return escapeHtml(label);
  }

  function payoutLedgerType(item) {
    if (item.type === "withdrawal") return "Вывод";
    if (item.type === "transfer") return "Перевод";
    if (item.sourceId) return "Лог";
    return item.label || "Начисление";
  }

  async function renderPayouts() {
    if (/^[a-f0-9]{24}$/i.test(payoutOpenId)) {
      return renderPayoutDetail(payoutOpenId);
    }
    const data = await PanelAPI.get("/admin/payouts?status=all", { force: true });
    if (currentView !== "payouts" || payoutOpenId) return;
    const all = data.payouts || [];
    const openStatuses = new Set(["pending", "awaiting_payout_link"]);
    const rows = payoutFilter === "open"
      ? all.filter((p) => openStatuses.has(p.status))
      : payoutFilter === "done"
        ? all.filter((p) => !openStatuses.has(p.status))
        : all;
    main.innerHTML = `
      <div class="payouts-page">
        <section class="payouts-hero">
          <div><span>Финансы команды</span><h1>Выплаты</h1><p>Откройте заявку, чтобы увидеть источники начислений и обработать выплату.</p></div>
          <div class="payouts-summary">
            <div><small>В очереди</small><strong>${all.filter((p) => openStatuses.has(p.status)).length}</strong></div>
            <div><small>Одобрено</small><strong>${all.filter((p) => p.status === "approved").length}</strong></div>
            <div><small>Отклонено</small><strong>${all.filter((p) => p.status === "rejected").length}</strong></div>
          </div>
        </section>
        <div class="payouts-toolbar" id="payoutFilters">
          <button type="button" class="${payoutFilter === "open" ? "is-active" : ""}" data-payout-filter="open">Активные</button>
          <button type="button" class="${payoutFilter === "done" ? "is-active" : ""}" data-payout-filter="done">Завершённые</button>
          <button type="button" class="${payoutFilter === "all" ? "is-active" : ""}" data-payout-filter="all">Все</button>
        </div>
        <section class="payouts-list" id="payoutsList"></section>
      </div>
    `;
    const list = document.getElementById("payoutsList");
    rows.forEach((p) => {
      const card = document.createElement("article");
      card.className = `payout-card is-${p.status} clickable-row`;
      card.dataset.payoutId = p.id;
      const linkMethod = p.method === "xRocketr" || p.method === "cryptobot";
      const nickMethod = p.method === "lolz";
      const initials = String(p.username || p.telegramId || "U").replace(/^@/, "").slice(0, 2).toUpperCase();
      card.innerHTML = `
        <header>
          <div class="payout-person"><span>${escapeHtml(initials)}</span><div><b>${p.username ? `@${escapeHtml(p.username)}` : `ID ${escapeHtml(p.telegramId || "—")}`}</b><small><code>#${escapeHtml(String(p.shortId || p.id).slice(-8))}</code> · ${escapeHtml(payoutWhen(p.createdAt))}</small></div></div>
          <span class="payout-state">${escapeHtml(PAYOUT_STATUS_LABEL[p.status] || p.status)}</span>
        </header>
        <div class="payout-main">
          <div><small>Сумма</small><strong>${escapeHtml(payoutUsd(p.amountUsd))}</strong></div>
          <div><small>Метод</small><strong>${escapeHtml(PAYOUT_METHOD_LABEL[p.method] || p.method)}</strong></div>
          <div><small>${linkMethod ? "Получение" : nickMethod ? "Ник" : "Кошелёк"}</small><strong>${linkMethod ? "Чек после одобрения" : escapeHtml(p.walletAddress || "—")}</strong></div>
        </div>
        <footer class="payout-actions">
          <span class="payout-open-hint">Открыть заявку →</span>
        </footer>`;
      card.addEventListener("click", (event) => {
        if (event.target.closest("button, a, input, textarea")) return;
        showView("payouts", { historyMode: "push", payoutId: p.id });
      });
      list.appendChild(card);
    });
    if (!rows.length) {
      list.innerHTML = `<div class="payouts-empty"><span>✓</span><b>Здесь пока пусто</b><p>Заявки из Telegram и веб-панели появятся автоматически.</p></div>`;
    }
    document.querySelectorAll("[data-payout-filter]").forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation();
      payoutFilter = button.dataset.payoutFilter;
      renderPayouts();
    }));
  }

  async function renderPayoutDetail(id) {
    const requestId = String(id || "");
    let data;
    try {
      data = await PanelAPI.get(`/admin/payouts/${encodeURIComponent(requestId)}`, { force: true });
    } catch (error) {
      if (currentView !== "payouts" || payoutOpenId !== requestId) return;
      main.innerHTML = `
        <div class="payouts-page payout-detail-page">
          <button type="button" class="btn-ghost payout-back" data-payout-back>← К списку</button>
          <div class="payouts-empty">
            <span>!</span>
            <b>Заявка не найдена</b>
            <p>${escapeHtml(error.status === 404 || error.message === "not_found" ? "Заявка не найдена или нет доступа." : (error.message || "Проверьте ссылку или права доступа."))}</p>
          </div>
        </div>`;
      main.querySelector("[data-payout-back]")?.addEventListener("click", () => {
        showView("payouts", { historyMode: "push", payoutId: "" });
      });
      return;
    }
    if (currentView !== "payouts" || payoutOpenId !== requestId) return;

    const p = data.payout || {};
    const worker = data.worker || {};
    const openStatuses = new Set(["pending", "awaiting_payout_link"]);
    const shortId = p.shortId || String(p.id || "").slice(-8);
    const methodName = p.methodLabel || PAYOUT_METHOD_LABEL[p.method] || p.method || "—";
    const username = String(p.username || worker.username || "").replace(/^@/, "");
    pageTitle.textContent = `Выплата #${shortId}`;
    document.title = `Выплата #${shortId} — Garbona Admin`;

    const funding = data.funding || [];
    const ledger = data.ledger || [];
    const linkMethod = Boolean(p.isLinkMethod);
    const nickMethod = Boolean(p.isNicknameMethod);
    const requisitesLabel = nickMethod ? "Ник" : "Кошелёк";
    const requisitesValue = String(p.walletAddress || "").trim();
    const requisitesHtml = linkMethod
      ? `<p class="payout-note">Реквизиты не нужны — после принятия укажите ссылку на чек.</p>`
      : requisitesValue
        ? `<div class="payout-req"><span>${escapeHtml(requisitesLabel)}</span><code>${escapeHtml(requisitesValue)}</code><button type="button" class="btn-ghost" data-copy="${escapeHtml(requisitesValue)}">Копировать</button></div>`
        : `<p class="payout-warn">Реквизиты не указаны.</p>`;

    const fundingHtml = funding.length
      ? funding.map((row) => {
        const partial = Number(row.creditedUsd) > 0 && Number(row.creditedUsd) !== Number(row.appliedUsd)
          ? ` · из ${payoutUsd(row.creditedUsd)}`
          : "";
        return `<li class="payout-fund-row">
            <span class="is-in">${escapeHtml(payoutSignedUsd(row.appliedUsd, "in"))}</span>
            <div>
              <p>${payoutFundingLabelHtml(row)}</p>
              <small>${escapeHtml(payoutWhen(row.createdAt))}${escapeHtml(partial)}${row.id ? ` · <button type="button" class="payout-id-btn" data-copy="${escapeHtml(row.id)}" title="ID транзакции">tx</button>` : ""}</small>
            </div>
          </li>`;
      }).join("")
      : `<li class="payout-fund-empty">Источники начислений не найдены.</li>`;

    const ledgerHtml = ledger.length
      ? ledger.map((item) => {
        const current = item.type === "withdrawal" && item.id === p.id;
        const amountClass = item.direction === "out" ? "is-out" : "is-in";
        const source = item.sourceId
          ? `<button type="button" class="payout-id-btn" data-copy="${escapeHtml(item.sourceId)}">#${escapeHtml(item.sourceId)}</button>`
          : "—";
        return `<tr class="${current ? "is-current" : ""} ${item.reserved ? "is-reserved" : ""}">
            <td>${escapeHtml(payoutWhen(item.createdAt))}</td>
            <td>${escapeHtml(payoutLedgerType(item))}</td>
            <td>
              <div>${escapeHtml(item.label || "—")}</div>
              <small>${item.note && item.note !== item.label ? escapeHtml(item.note) : item.reserved ? "В резерве, баланс ещё не списан" : ""}</small>
            </td>
            <td>${source}</td>
            <td><button type="button" class="payout-id-btn" data-copy="${escapeHtml(item.id || "")}" title="ID транзакции">${escapeHtml(String(item.id || "—").slice(-8))}</button></td>
            <td class="${amountClass}">${escapeHtml(payoutSignedUsd(item.deltaUsd ?? item.amountUsd, item.direction))}</td>
            <td>${item.reserved ? "—" : escapeHtml(payoutUsd(item.balanceAfterUsd))}</td>
          </tr>`;
      }).join("")
      : `<tr><td colspan="7">Операций пока нет.</td></tr>`;

    const linkPlaceholder = linkMethod ? "Ссылка активации чека https://…" : "Ссылка на транзакцию https://…";

    main.innerHTML = `
      <div class="payouts-page payout-detail-page">
        <div class="payout-detail-nav">
          <button type="button" class="btn-ghost payout-back" data-payout-back>← К списку</button>
          <button type="button" class="btn-ghost" data-copy="${escapeHtml(p.id || "")}">Копировать ID</button>
        </div>

        <section class="payout-detail-hero is-${escapeHtml(p.status || "pending")}">
          <div>
            <span>Заявка #${escapeHtml(shortId)}</span>
            <h1>${escapeHtml(payoutUsd(p.amountUsd))}</h1>
            <p>${username ? `@${escapeHtml(username)}` : "Воркер"} · ${escapeHtml(methodName)}</p>
          </div>
          <span class="payout-state">${escapeHtml(PAYOUT_STATUS_LABEL[p.status] || p.status)}</span>
        </section>

        <section class="payout-money-strip" aria-label="Суммы заявки">
          <div><small>Запрошено</small><strong>${escapeHtml(payoutUsd(p.amountUsd))}</strong></div>
          <div><small>Комиссия</small><strong>${escapeHtml(payoutUsd(p.networkFee))}</strong></div>
          <div><small>К выплате</small><strong>${escapeHtml(payoutUsd(p.payoutAmount))}</strong></div>
        </section>

        <div class="payout-detail-grid">
          <section class="payout-panel">
            <h2>Заявка</h2>
            <dl class="payout-facts">
              <div><dt>ID</dt><dd><code>${escapeHtml(p.id || "—")}</code></dd></div>
              <div><dt>Статус</dt><dd>${escapeHtml(PAYOUT_STATUS_LABEL[p.status] || p.status || "—")}</dd></div>
              <div><dt>Создана</dt><dd>${escapeHtml(payoutWhen(p.createdAt))}</dd></div>
              <div><dt>Воркер</dt><dd>${username ? `@${escapeHtml(username)}` : "—"}</dd></div>
              <div><dt>Telegram ID</dt><dd><code>${escapeHtml(p.telegramId || worker.telegramId || "—")}</code></dd></div>
              <div><dt>Метод</dt><dd>${escapeHtml(methodName)}</dd></div>
              <div><dt>Баланс сейчас</dt><dd>${escapeHtml(payoutUsd(worker.walletUsd))} · доступно ${escapeHtml(payoutUsd(worker.availableUsd))}</dd></div>
              <div><dt>В резерве</dt><dd>${escapeHtml(payoutUsd(worker.reservedUsd))}</dd></div>
            </dl>
            <h3>Реквизиты</h3>
            ${requisitesHtml}
            ${p.payoutUrl ? `<p class="payout-note">Ссылка выплаты: <a href="${escapeHtml(p.payoutUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(p.payoutUrl)}</a></p>` : ""}
            ${p.resolvedByTelegramId ? `<p class="payout-muted">Обработал: ${escapeHtml(p.resolvedByTelegramId)}</p>` : ""}
          </section>

          <section class="payout-panel payout-funding">
            <h2>История денег</h2>
            <p class="payout-lead">Операции, из которых сложилась сумма этой заявки.</p>
            <ul class="payout-fund-list">${fundingHtml}</ul>
            <footer class="payout-fund-total">
              <span>Итого</span>
              <strong>${escapeHtml(payoutUsd(data.coveredUsd))}</strong>
              ${Number(data.missingUsd) > 0 ? `<small class="payout-warn-inline">не хватает ${escapeHtml(payoutUsd(data.missingUsd))}</small>` : `<small>из ${escapeHtml(payoutUsd(p.amountUsd))}</small>`}
            </footer>
          </section>
        </div>

        <section class="payout-panel payout-actions-panel">
          <h2>Управление</h2>
          <div class="payout-manage" id="payoutManage"></div>
        </section>

        <section class="payout-panel">
          <h2>Все операции воркера</h2>
          <div class="payout-table-wrap">
            <table class="payout-ledger">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Тип</th>
                  <th>Описание</th>
                  <th>Источник</th>
                  <th>ID</th>
                  <th>Сумма</th>
                  <th>Баланс</th>
                </tr>
              </thead>
              <tbody>${ledgerHtml}</tbody>
            </table>
          </div>
        </section>
      </div>
    `;

    main.querySelector("[data-payout-back]")?.addEventListener("click", () => {
      showView("payouts", { historyMode: "push", payoutId: "" });
    });
    main.querySelectorAll("[data-copy]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        copyPayoutText(button.dataset.copy);
      });
    });
    if (p.telegramId) {
      const facts = main.querySelector(".payout-facts");
      const profile = document.createElement("button");
      profile.type = "button";
      profile.className = "btn-ghost";
      profile.textContent = "Профиль воркера";
      profile.addEventListener("click", () => openMember(p.telegramId));
      facts?.after(profile);
    }

    const manage = document.getElementById("payoutManage");
    if (!manage) return;
    if (p.status === "pending") {
      const accept = document.createElement("button");
      accept.type = "button";
      accept.className = "btn-primary";
      accept.textContent = "Принять выплату";
      accept.addEventListener("click", async () => {
        try {
          await PanelAPI.post(`/admin/payouts/${p.id}/approve`, {});
          toast(linkMethod ? "Вставьте ссылку на чек" : "Вставьте ссылку на транзакцию");
          renderPayouts();
        } catch (error) {
          toast(error.message, "error");
        }
      });
      manage.appendChild(accept);
    }
    if (p.status === "awaiting_payout_link") {
      const input = document.createElement("input");
      input.className = "search-input";
      input.placeholder = linkPlaceholder;
      input.autocomplete = "off";
      const send = document.createElement("button");
      send.type = "button";
      send.className = "btn-primary";
      send.textContent = "Завершить выплату";
      send.addEventListener("click", async () => {
        try {
          await PanelAPI.post(`/admin/payouts/${p.id}/link`, { url: input.value });
          toast("Выплата завершена");
          renderPayouts();
        } catch (error) {
          toast(error.message, "error");
        }
      });
      manage.append(input, send);
    }
    if (openStatuses.has(p.status)) {
      const reject = document.createElement("button");
      reject.type = "button";
      reject.className = "btn-ghost btn-danger";
      reject.textContent = "Отклонить";
      reject.addEventListener("click", async () => {
        if (!(await GarbonaAdminConfirm.open(`Отклонить заявку #${shortId}? Баланс вернётся воркеру.`, {
          title: "Отклонить выплату",
          confirmLabel: "Отклонить",
          danger: true,
        }))) return;
        try {
          await PanelAPI.post(`/admin/payouts/${p.id}/reject`, {});
          toast("Заявка отклонена");
          renderPayouts();
        } catch (error) {
          toast(error.message, "error");
        }
      });
      manage.appendChild(reject);
    }
    if (p.payoutUrl) {
      const openLink = document.createElement("a");
      openLink.className = "btn-ghost payout-open-link";
      openLink.href = p.payoutUrl;
      openLink.target = "_blank";
      openLink.rel = "noopener noreferrer";
      openLink.textContent = linkMethod ? "Открыть чек" : "Открыть транзакцию";
      manage.appendChild(openLink);
    }
    if (!manage.childNodes.length) {
      manage.innerHTML = `<p class="payout-muted">Действий нет — заявка уже обработана.</p>`;
    }
  }

  async function renderSites() {
    let sitesTab = "referrals";
    let selectedDomainId = null;

    main.innerHTML = `
      <div class="greeting">
        <div>
          <h1 class="greeting-title">Сайты</h1>
          <p class="greeting-sub" id="sitesSub">Все домены, ссылки и аналитика команды</p>
        </div>
        <div class="period-pills" id="sitesTabs">
          <button type="button" class="period-pill is-active" data-sites-tab="referrals">Рефералки</button>
          <button type="button" class="period-pill" data-sites-tab="domains">Домены</button>
          <button type="button" class="period-pill" data-sites-tab="analytics">Аналитика</button>
          <button type="button" class="period-pill" data-sites-tab="templates">Шаблоны</button>
          <button type="button" class="period-pill" data-sites-tab="workers">Воркеры</button>
        </div>
      </div>
      <div id="sitesBody"></div>
    `;

    const body = document.getElementById("sitesBody");
    const sub = document.getElementById("sitesSub");

    document.getElementById("sitesTabs").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-sites-tab]");
      if (!btn) return;
      sitesTab = btn.dataset.sitesTab;
      selectedDomainId = null;
      document.querySelectorAll("#sitesTabs .period-pill").forEach((el) => {
        el.classList.toggle("is-active", el.dataset.sitesTab === sitesTab);
      });
      load();
    });

    async function load() {
      body.innerHTML = `<div class="panel-card"><div class="panel-card-body"><div class="muted">Загрузка…</div></div></div>`;
      try {
        if (sitesTab === "workers") await renderWorkers();
        else if (sitesTab === "templates") await renderTemplatesVisibility();
        else if (sitesTab === "analytics") await renderSiteAnalytics();
        else if (sitesTab === "referrals") await renderReferrals();
        else if (selectedDomainId) await renderDomainDetail(selectedDomainId);
        else await renderDomains();
      } catch (e) {
        body.innerHTML = `
          <div class="panel-card">
            <div class="panel-card-body">
              <div class="empty">
                <div class="empty-title">Не удалось открыть сайты</div>
                <div class="empty-sub">${escapeHtml(e.message)}</div>
              </div>
            </div>
          </div>`;
      }
    }

    async function renderReferrals() {
      const data = await PanelAPI.get("/admin/sites/referrals", { force: true });
      const templates = data.templates || [];
      sub.textContent = `Реферальных ссылок: ${data.total || 0}`;
      body.innerHTML = `
        <div class="panel-card">
          <div class="panel-card-body" style="padding-top:16px">
            <div class="search-row" style="margin-bottom:12px">
              <input class="search-input" id="refSearch" placeholder="Поиск: @user, telegram id, path, домен" />
            </div>
            <div class="table-wrap">
              <table class="data">
                <thead>
                  <tr>
                    <th>Воркер</th>
                    <th>Домен</th>
                    <th>Ссылка</th>
                    <th>Шаблон</th>
                    <th>Окно</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody id="refsBody"></tbody>
              </table>
            </div>
          </div>
        </div>
      `;
      const tbody = document.getElementById("refsBody");
      const rows = data.referrals || [];

      const paint = (filter = "") => {
        tbody.innerHTML = "";
        const q = String(filter || "").trim().toLowerCase();
        const filtered = !q
          ? rows
          : rows.filter((r) =>
              [r.username, r.telegramId, r.customId, r.domainName, r.path, r.url]
                .map((v) => String(v || "").toLowerCase())
                .join(" ")
                .includes(q)
            );
        if (!filtered.length) {
          tbody.innerHTML = `<tr><td colspan="6" class="muted">Пусто</td></tr>`;
          return;
        }
        filtered.forEach((r) => {
          const tr = document.createElement("tr");
          const tplOptions = templates
            .map(
              (t) =>
                `<option value="${t.id}">${escapeHtml(t.name || `Template #${t.id}`)} (#${t.id})</option>`
            )
            .join("");
          tr.innerHTML = `
            <td>
              ${r.username ? `@${escapeHtml(r.username)}` : "—"}
              <div class="muted"><code>${escapeHtml(r.telegramId)}</code></div>
            </td>
            <td>${escapeHtml(r.domainName || `#${r.domainId}`)}</td>
            <td><code style="word-break:break-all">${escapeHtml(r.url || r.path || "—")}</code></td>
            <td>
              <select class="search-input ref-template" style="min-width:160px;max-width:220px">
                <option value="">Шаблон…</option>
                ${tplOptions}
              </select>
            </td>
            <td>
              <select class="search-input ref-window" style="min-width:140px">
                <option value="">Окно…</option>
                <option value="FakeWindow">FakeWindow</option>
                <option value="CurrentWindow">CurrentWindow</option>
                <option value="NewWindow">NewWindow</option>
                <option value="AboutBlank">AboutBlank</option>
              </select>
            </td>
            <td class="drawer-actions"></td>
          `;
          const cell = tr.lastElementChild;
          const save = document.createElement("button");
          save.className = "btn-primary";
          save.textContent = "Сохранить";
          save.onclick = async () => {
            const templateId = tr.querySelector(".ref-template").value;
            const windowType = tr.querySelector(".ref-window").value;
            if (!templateId && !windowType) {
              toast("Выберите шаблон или окно", "error");
              return;
            }
            try {
              await PanelAPI.patch(`/admin/sites/referrals/${r.telegramId}/${r.domainId}`, {
                templateId: templateId || undefined,
                windowType: windowType || undefined,
              });
              toast("Обновлено");
            } catch (e) {
              toast(e.message, "error");
            }
          };
          const del = document.createElement("button");
          del.className = "btn-ghost btn-danger";
          del.textContent = "Удалить";
          del.onclick = async () => {
            if (
              !(await GarbonaAdminConfirm.open(
                `Удалить рефералку ${r.username ? "@" + r.username : r.telegramId} на ${r.domainName || r.domainId}?`,
                { confirmLabel: "Удалить" }
              ))
            ) {
              return;
            }
            try {
              await PanelAPI.del(`/admin/sites/referrals/${r.telegramId}/${r.domainId}`);
              toast("Удалено");
              await renderReferrals();
            } catch (e) {
              toast(e.message, "error");
            }
          };
          const open = document.createElement("button");
          open.className = "btn-ghost";
          open.textContent = "Карточка";
          open.onclick = () => openMember(r.telegramId);
          cell.append(save, del, open);
          tbody.appendChild(tr);
        });
      };

      paint();
      document.getElementById("refSearch").addEventListener("input", (e) => paint(e.target.value));
    }

    async function renderDomains() {
      const data = await PanelAPI.get("/admin/sites/domains");
      const domains = data.domains || [];
      sub.textContent = `Все домены команды · ${domains.length} · онлайн ${data.totalOnline || 0}`;
      body.innerHTML = `
        <div class="panel-card">
          <div class="panel-card-body" style="padding-top:16px">
            <div class="meta-grid" style="margin-bottom:16px">
              <div><dt>Домены</dt><dd>${domains.length}</dd></div>
              <div><dt>Онлайн</dt><dd>${data.totalOnline || 0}</dd></div>
              <div><dt>Просмотры</dt><dd>${data.totalViews || 0}</dd></div>
              <div><dt>Логи</dt><dd>${data.totalLogs || 0}</dd></div>
            </div>
            <div class="search-row">
              <input class="search-input" id="siteDomainInput" placeholder="новый-домен.com" />
              <button type="button" class="btn-ghost" id="siteDomainCheck">Проверить</button>
              <button type="button" class="btn-primary" id="siteDomainAdd">Добавить</button>
            </div>
            <div class="muted" id="siteDomainHint" style="margin-bottom:12px"></div>
            <div class="search-row" style="margin-bottom:12px">
              <input class="search-input" id="siteDomainSearch" placeholder="Поиск: домен, владелец, id" />
            </div>
            <div class="table-wrap">
              <table class="data">
                <thead>
                  <tr>
                    <th>Домен</th>
                    <th>Владелец</th>
                    <th>Онлайн</th>
                    <th>Просмотры</th>
                    <th>Клики</th>
                    <th>Логи</th>
                    <th>Ссылки</th>
                    <th>Тип</th>
                  </tr>
                </thead>
                <tbody id="sitesDomainsBody"></tbody>
              </table>
            </div>
          </div>
        </div>
      `;
      const tbody = document.getElementById("sitesDomainsBody");
      const paint = (filter = "") => {
        tbody.innerHTML = "";
        const q = String(filter || "").trim().toLowerCase();
        const rows = !q
          ? domains
          : domains.filter((d) =>
              [d.domain, d.ownerLabel, d.ownerTelegramId, d.ownerPanelUsername, d.id]
                .map((v) => String(v || "").toLowerCase())
                .join(" ")
                .includes(q)
            );
        rows.forEach((d) => {
          const tr = document.createElement("tr");
          tr.className = "clickable-row";
          tr.innerHTML = `
            <td>${escapeHtml(d.domain)}</td>
            <td>${escapeHtml(d.ownerLabel || "—")}</td>
            <td>${d.online || 0}</td>
            <td>${d.stats?.views || 0}</td>
            <td>${d.stats?.clicks || 0}</td>
            <td>${d.stats?.logs || 0}</td>
            <td>${d.linksCount || 0}</td>
            <td class="muted">${d.isOwn ? "свой" : d.isTeamPublic ? "командный" : "воркера"}</td>
          `;
          tr.addEventListener("click", () => {
            selectedDomainId = d.id;
            load();
          });
          tbody.appendChild(tr);
        });
        if (!rows.length) {
          tbody.innerHTML = `<tr><td colspan="8" class="muted">Доменов нет</td></tr>`;
        }
      };
      paint();
      document.getElementById("siteDomainSearch").addEventListener("input", (e) => paint(e.target.value));

      const hint = document.getElementById("siteDomainHint");
      document.getElementById("siteDomainCheck").addEventListener("click", async () => {
        try {
          const domain = document.getElementById("siteDomainInput").value.trim();
          const preview = await PanelAPI.post("/admin/sites/domains/check", { domain });
          if (preview.existing) {
            hint.textContent = `${preview.message || "Домен уже в команде"} · ${preview.existing.domain || domain}`;
            toast("Домен уже есть в команде — открываю");
            selectedDomainId = preview.existing.id || null;
            if (selectedDomainId) await load();
            return;
          }
          hint.textContent = `Свободен. A-запись → ${preview.ip || "—"}`;
          toast("Домен свободен");
        } catch (e) {
          hint.textContent = e.message;
          toast(e.message, "error");
        }
      });
      document.getElementById("siteDomainAdd").addEventListener("click", async () => {
        try {
          const domain = document.getElementById("siteDomainInput").value.trim();
          const result = await PanelAPI.post("/admin/sites/domains", { domain });
          toast(
            result.existing
              ? `Уже есть ${result.created?.domain || domain}`
              : `Добавлен ${result.created?.domain || domain}`
          );
          selectedDomainId = result.created?.id || null;
          await load();
        } catch (e) {
          toast(e.message, "error");
        }
      });
    }

    async function renderDomainDetail(domainId) {
      const [detail, templatesData] = await Promise.all([
        PanelAPI.get(`/admin/sites/domains/${domainId}`),
        PanelAPI.get("/admin/sites/templates").catch(() => ({ templates: [] })),
      ]);
      const d = detail.domain;
      sub.textContent = d.domain;
      const templates = templatesData.templates || [];
      body.innerHTML = `
        <div class="panel-card">
          <div class="panel-card-head">
            <h2 class="panel-card-title">${escapeHtml(d.domain)}</h2>
            <button type="button" class="panel-card-link" id="sitesBack">← К списку</button>
          </div>
          <div class="panel-card-body">
            <div class="meta-grid" style="margin-bottom:16px">
              <div><dt>ID</dt><dd>${d.id}</dd></div>
              <div><dt>Владелец</dt><dd>${escapeHtml(d.ownerLabel || "—")}</dd></div>
              <div><dt>Онлайн</dt><dd>${d.online || 0}</dd></div>
              <div><dt>Просмотры</dt><dd>${d.stats?.views || 0}</dd></div>
              <div><dt>Клики</dt><dd>${d.stats?.clicks || 0}</dd></div>
              <div><dt>Логи</dt><dd>${d.stats?.logs || 0}</dd></div>
              <div><dt>Тип</dt><dd>${d.isOwn ? "свой" : d.isTeamPublic ? "командный" : "воркера"}</dd></div>
              <div><dt>IP</dt><dd>${escapeHtml(d.ip || "—")}</dd></div>
            </div>
            <div class="settings-row-title" style="margin-bottom:8px">Создать ссылку</div>
            <div class="search-row">
              <input class="search-input" id="siteLinkPath" placeholder="path (пусто = random)" />
              <select class="search-input" id="siteLinkTemplate" style="max-width:220px">
                <option value="">${templates.length ? "Шаблон…" : "Нет доступных шаблонов"}</option>
                ${templates
                  .map(
                    (t) =>
                      `<option value="${t.id}">${escapeHtml(t.name || `Template #${t.id}`)} (#${t.id})</option>`
                  )
                  .join("")}
              </select>
              <select class="search-input" id="siteLinkWindow" style="max-width:160px">
                <option value="FakeWindow">FakeWindow</option>
                <option value="CurrentWindow">CurrentWindow</option>
                <option value="NewWindow">NewWindow</option>
                <option value="AboutBlank">AboutBlank</option>
              </select>
              <button type="button" class="btn-primary" id="siteLinkCreate">Создать</button>
            </div>
            <div class="table-wrap" style="margin-top:8px">
              <table class="data">
                <thead><tr><th>Path</th><th>Окно</th><th>Шаблон</th><th>Онлайн</th><th>Просмотры</th><th>Клики</th><th>Логи</th><th>ID</th></tr></thead>
                <tbody id="siteLinksBody"></tbody>
              </table>
            </div>
            <div class="settings-row-title" style="margin:20px 0 8px">Рефералки воркеров</div>
            <div class="table-wrap">
              <table class="data">
                <thead><tr><th>Воркер</th><th>Ссылка</th><th></th></tr></thead>
                <tbody id="siteRefsBody"></tbody>
              </table>
            </div>
            ${d.isOwn ? `<div class="drawer-actions" style="margin-top:16px"><button type="button" class="btn-ghost btn-danger" id="siteDomainDelete">Удалить домен</button></div>` : ""}
          </div>
        </div>
      `;
      const linksBody = document.getElementById("siteLinksBody");
      (detail.links || []).forEach((link) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>/${escapeHtml(link.path || "")}</td>
          <td class="muted">${escapeHtml(link.windowType || "—")}</td>
          <td class="muted">${escapeHtml(link.templateName || link.template || "—")}</td>
          <td>${link.online || 0}</td>
          <td>${link.stats?.views || 0}</td>
          <td>${link.stats?.clicks || 0}</td>
          <td>${link.stats?.logs || 0}</td>
          <td class="muted">${link.id ?? "—"}</td>
        `;
        linksBody.appendChild(tr);
      });
      if (!(detail.links || []).length) {
        linksBody.innerHTML = `<tr><td colspan="8" class="muted">Ссылок нет</td></tr>`;
      }

      const refsBody = document.getElementById("siteRefsBody");
      (detail.referrals || []).forEach((r) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${r.username ? `@${escapeHtml(r.username)}` : escapeHtml(r.telegramId)}</td>
          <td><code style="word-break:break-all">${escapeHtml(r.url || r.path || "—")}</code></td>
          <td class="drawer-actions"></td>
        `;
        const del = document.createElement("button");
        del.className = "btn-ghost btn-danger";
        del.textContent = "Удалить";
        del.onclick = async () => {
          if (!(await GarbonaAdminConfirm.open(`Удалить рефералку ${r.username ? "@" + r.username : r.telegramId}?`, { confirmLabel: "Удалить" }))) return;
          try {
            await PanelAPI.del(`/admin/sites/referrals/${r.telegramId}/${r.domainId}`);
            toast("Удалено");
            await renderDomainDetail(domainId);
          } catch (e) {
            toast(e.message, "error");
          }
        };
        tr.lastElementChild.appendChild(del);
        refsBody.appendChild(tr);
      });
      if (!(detail.referrals || []).length) {
        refsBody.innerHTML = `<tr><td colspan="3" class="muted">Рефералок на этом домене нет</td></tr>`;
      }

      document.getElementById("sitesBack").addEventListener("click", () => {
        selectedDomainId = null;
        load();
      });
      document.getElementById("siteLinkCreate").addEventListener("click", async () => {
        try {
          await PanelAPI.post(`/admin/sites/domains/${domainId}/links`, {
            path: document.getElementById("siteLinkPath").value.trim(),
            templateId: document.getElementById("siteLinkTemplate").value,
            windowType: document.getElementById("siteLinkWindow").value,
          });
          toast("Ссылка создана");
          await renderDomainDetail(domainId);
        } catch (e) {
          toast(e.message, "error");
        }
      });
      document.getElementById("siteDomainDelete")?.addEventListener("click", async () => {
        if (!(await GarbonaAdminConfirm.open(`Удалить домен ${d.domain}?`, { confirmLabel: "Удалить" }))) return;
        try {
          await PanelAPI.del(`/admin/sites/domains/${domainId}`);
          toast("Домен удалён");
          selectedDomainId = null;
          await load();
        } catch (e) {
          toast(e.message, "error");
        }
      });
    }

    async function renderSiteAnalytics() {
      const data = await PanelAPI.get("/admin/sites/analytics");
      const summary = data.summary || {};
      const rows = data.rows || [];
      sub.textContent = `Аналитика всех сайтов · ссылок ${summary.links || 0}`;
      body.innerHTML = `
        <div class="panel-card">
          <div class="panel-card-body" style="padding-top:16px">
            <div class="meta-grid" style="margin-bottom:16px">
              <div><dt>Домены</dt><dd>${summary.domains || 0}</dd></div>
              <div><dt>Ссылки</dt><dd>${summary.links || 0}</dd></div>
              <div><dt>Онлайн</dt><dd>${summary.online || 0}</dd></div>
              <div><dt>Просмотры</dt><dd>${summary.views || 0}</dd></div>
              <div><dt>Авторизации</dt><dd>${summary.auths || 0}</dd></div>
              <div><dt>Конверсия</dt><dd>${summary.views ? ((Number(summary.auths || 0) / Number(summary.views)) * 100).toFixed(1) : "0"}%</dd></div>
              <div><dt>Логи</dt><dd>${summary.logs || 0}</dd></div>
              <div><dt>MaFile</dt><dd>${summary.mafiles || 0}</dd></div>
            </div>
            <div class="search-row" style="margin-bottom:12px">
              <input class="search-input" id="siteAnalyticsSearch" placeholder="Поиск: ссылка, домен, владелец" />
            </div>
            <div class="table-wrap">
              <table class="data">
                <thead>
                  <tr>
                    <th>Ссылка</th>
                    <th>Владелец</th>
                    <th>Онлайн</th>
                    <th>Просмотры</th>
                    <th>Авторизации</th>
                    <th>Конверсия</th>
                    <th>Логи</th>
                    <th>MaFile</th>
                  </tr>
                </thead>
                <tbody id="siteAnalyticsBody"></tbody>
              </table>
            </div>
          </div>
        </div>
      `;
      const tbody = document.getElementById("siteAnalyticsBody");
      const paint = (filter = "") => {
        tbody.innerHTML = "";
        const q = String(filter || "").trim().toLowerCase();
        const filtered = !q
          ? rows
          : rows.filter((r) =>
              [r.url, r.domainName, r.ownerLabel, r.ownerTelegramId, r.link?.path]
                .map((v) => String(v || "").toLowerCase())
                .join(" ")
                .includes(q)
            );
        filtered.forEach((r) => {
          const views = Number(r.link?.stats?.views || 0);
          const auths = Number(r.link?.stats?.auths || 0);
          const conv = views > 0 ? `${((auths / views) * 100).toFixed(1)}%` : "—";
          const tr = document.createElement("tr");
          tr.className = "clickable-row";
          tr.innerHTML = `
            <td><code style="word-break:break-all">${escapeHtml(r.url || "—")}</code></td>
            <td>${escapeHtml(r.ownerLabel || "—")}</td>
            <td>${r.link?.online || 0}</td>
            <td>${views}</td>
            <td>${auths}</td>
            <td>${conv}</td>
            <td>${r.link?.stats?.logs || 0}</td>
            <td>${r.link?.stats?.mafiles || 0}</td>
          `;
          tr.addEventListener("click", () => {
            if (!r.domainId) return;
            sitesTab = "domains";
            selectedDomainId = r.domainId;
            document.querySelectorAll("#sitesTabs .period-pill").forEach((el) => {
              el.classList.toggle("is-active", el.dataset.sitesTab === "domains");
            });
            load();
          });
          tbody.appendChild(tr);
        });
        if (!filtered.length) {
          tbody.innerHTML = `<tr><td colspan="8" class="muted">Ссылок нет</td></tr>`;
        }
      };
      paint();
      document.getElementById("siteAnalyticsSearch").addEventListener("input", (e) => paint(e.target.value));
    }

    async function renderWorkers() {
      const data = await PanelAPI.get("/admin/sites/workers");
      sub.textContent = `Воркеры uproject · ${data.workers?.length || 0}`;
      body.innerHTML = `
        <div class="panel-card">
          <div class="panel-card-body" style="padding-top:16px">
            <div class="table-wrap">
              <table class="data">
                <thead><tr><th>Логин</th><th>Telegram</th><th>ID</th><th></th></tr></thead>
                <tbody id="siteWorkersBody"></tbody>
              </table>
            </div>
          </div>
        </div>
      `;
      const tbody = document.getElementById("siteWorkersBody");
      (data.workers || []).forEach((w) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${escapeHtml(w.username || "—")}${w.isOwner ? ' <span class="badge ok">вы</span>' : ""}</td>
          <td class="muted">${escapeHtml(w.telegram || "—")}</td>
          <td class="muted">${w.id ?? "—"}</td>
          <td></td>
        `;
        if (w.telegram) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "btn-ghost";
          btn.textContent = "Юзер";
          btn.addEventListener("click", () => openMember(String(w.telegram)));
          tr.lastElementChild.appendChild(btn);
        }
        tbody.appendChild(tr);
      });
      if (!(data.workers || []).length) {
        tbody.innerHTML = `<tr><td colspan="4" class="muted">Пусто</td></tr>`;
      }
    }

    async function renderTemplatesVisibility() {
      await mountTemplatesVisibility(body, {
        onMeta: (text) => {
          sub.textContent = text;
        },
      });
    }

    await load();
  }

  async function renderTemplates() {
    main.innerHTML = `
      <div class="greeting">
        <div>
          <h1 class="greeting-title">Шаблоны</h1>
          <p class="greeting-sub" id="templatesSub">Какие шаблоны видны в боте и панелях</p>
        </div>
      </div>
      <div id="templatesBody"></div>
    `;
    await mountTemplatesVisibility(document.getElementById("templatesBody"), {
      onMeta: (text) => {
        const el = document.getElementById("templatesSub");
        if (el) el.textContent = text;
      },
    });
  }

  async function mountTemplatesVisibility(container, { onMeta } = {}) {
    const data = await PanelAPI.get("/admin/sites/templates/visibility");
    const templates = (data.templates || []).slice().sort((a, b) => {
      if (Boolean(a.enabled) !== Boolean(b.enabled)) return a.enabled ? -1 : 1;
      return Number(b.id) - Number(a.id);
    });
    const enabledCount = templates.filter((t) => t.enabled).length;
    if (typeof onMeta === "function") {
      onMeta(`Каталог · ${templates.length} · включено ${enabledCount}`);
    }
    container.innerHTML = `
      <div class="panel-card">
        <div class="panel-card-body" style="padding-top:16px">
          <div class="settings-row-title" style="margin-bottom:4px">Добавить шаблон для воркеров</div>
          <div class="muted" style="margin-bottom:12px">
            Загрузи HTML или вставь код. Новый шаблон сразу появится в каталоге воркеров.
          </div>
          <div class="admin-template-create">
            <input class="search-input" id="adminTemplateName" maxlength="80" placeholder="Название шаблона" />
            <div class="admin-template-file">
              <input id="adminTemplateFile" type="file" accept=".html,text/html" hidden />
              <button type="button" class="btn-ghost" id="adminTemplateFileBtn">Выбрать .html</button>
              <span class="muted" id="adminTemplateFileName" hidden></span>
            </div>
            <textarea class="settings-textarea admin-template-code" id="adminTemplateCode" rows="8" spellcheck="false" placeholder="HTML-код шаблона"></textarea>
            <label class="admin-template-public">
              <input type="checkbox" id="adminTemplatePublic" checked />
              <span>
                <span>Сделать общедоступным для воркеров</span>
                <small class="muted">Если снять галочку, шаблон останется только у вас.</small>
              </span>
            </label>
            <div class="admin-template-create-actions">
              <button type="button" class="btn-primary" id="adminTemplateCreate">Создать шаблон</button>
              <span class="muted" id="adminTemplateHint" hidden></span>
            </div>
          </div>
          <div class="settings-row-title" style="margin:20px 0 4px">Каталог шаблонов uProject</div>
          <div class="muted" style="margin-bottom:12px">
            Здесь видны все шаблоны аккаунта. Воркеры и бот видят только включённые.
            Шаблоны, добавленные воркерами, помечены — их нельзя удалить из uProject, только скрыть.
          </div>
          <div class="search-row">
            <input class="search-input" id="siteTemplateIdInput" type="number" min="1" step="1" placeholder="ID шаблона, например 785" />
            <input class="search-input" id="siteTemplateNameInput" maxlength="80" placeholder="Своё название (необязательно)" />
            <button type="button" class="btn-primary" id="siteTemplateEnable">Включить</button>
          </div>
          <div class="table-wrap" style="margin-top:8px">
            <table class="data">
              <thead><tr><th>ID</th><th>Название</th><th>Статус</th><th>Превью</th><th></th></tr></thead>
              <tbody id="siteTemplatesBody"></tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    const tbody = document.getElementById("siteTemplatesBody");
    templates.forEach((t) => {
      const tr = document.createElement("tr");
      if (!t.enabled) tr.classList.add("is-template-disabled");
      tr.innerHTML = `
        <td><code>${t.id}</code></td>
        <td></td>
        <td class="admin-template-status"></td>
        <td class="muted admin-template-preview"></td>
        <td class="admin-template-actions"></td>
      `;
      const nameCell = tr.children[1];
      const nameInput = document.createElement("input");
      nameInput.className = "search-input";
      nameInput.style.maxWidth = "220px";
      nameInput.maxLength = 80;
      nameInput.value = t.name || `Template #${t.id}`;
      nameInput.disabled = !t.enabled;
      if (t.isWorkerTemplate) {
        const badges = document.createElement("div");
        badges.className = "admin-template-badges";
        badges.innerHTML = `<span class="badge worker">Шаблон воркера · TG ${escapeHtml(t.ownerTelegramId || "—")}</span>`;
        nameCell.appendChild(badges);
      }
      nameCell.appendChild(nameInput);

      const statusCell = tr.children[2];
      statusCell.innerHTML = t.enabled
        ? `<span class="badge ok">Включён</span>`
        : `<span class="badge off">Скрыт</span>`;

      const previewCell = tr.children[3];
      mountAdminTemplatePreview(previewCell, t);

      const actions = tr.children[4];
      if (t.enabled) {
        const saveBtn = document.createElement("button");
        saveBtn.type = "button";
        saveBtn.className = "btn-ghost";
        saveBtn.textContent = "Сохранить";
        saveBtn.addEventListener("click", async () => {
          const name = nameInput.value.trim();
          if (!name) {
            toast("Укажите название", "error");
            return;
          }
          try {
            await PanelAPI.patch(`/admin/sites/templates/visibility/${t.id}`, { name });
            toast(`Название #${t.id} обновлено`);
            await mountTemplatesVisibility(container, { onMeta });
          } catch (err) {
            toast(err.message, "error");
          }
        });
        actions.appendChild(saveBtn);

        const hideBtn = document.createElement("button");
        hideBtn.type = "button";
        hideBtn.className = t.isWorkerTemplate ? "btn-ghost" : "btn-ghost btn-danger";
        hideBtn.textContent = t.isWorkerTemplate ? "Скрыть" : "Выключить";
        hideBtn.addEventListener("click", async () => {
          const msg = t.isWorkerTemplate
            ? `Скрыть шаблон воркера #${t.id} от каталога? Сам шаблон в uProject не удалится.`
            : `Выключить шаблон #${t.id}? Воркеры перестанут его видеть.`;
          if (!window.confirm(msg)) return;
          try {
            await PanelAPI.del(`/admin/sites/templates/visibility/${t.id}`);
            toast(t.isWorkerTemplate ? `Шаблон #${t.id} скрыт` : `Шаблон #${t.id} выключен`);
            await mountTemplatesVisibility(container, { onMeta });
          } catch (e) {
            toast(e.message, "error");
          }
        });
        actions.appendChild(hideBtn);
      } else {
        const enableBtn = document.createElement("button");
        enableBtn.type = "button";
        enableBtn.className = "btn-primary";
        enableBtn.textContent = "Включить";
        enableBtn.addEventListener("click", async () => {
          try {
            await PanelAPI.post("/admin/sites/templates/visibility", {
              id: t.id,
              name: t.name || "",
            });
            toast(`Включён: ${t.name || `#${t.id}`}`);
            await mountTemplatesVisibility(container, { onMeta });
          } catch (e) {
            toast(e.message, "error");
          }
        });
        actions.appendChild(enableBtn);
      }

      nameInput.addEventListener("keydown", async (e) => {
        if (e.key !== "Enter" || !t.enabled) return;
        const name = nameInput.value.trim();
        if (!name) {
          toast("Укажите название", "error");
          return;
        }
        try {
          await PanelAPI.patch(`/admin/sites/templates/visibility/${t.id}`, { name });
          toast(`Название #${t.id} обновлено`);
          await mountTemplatesVisibility(container, { onMeta });
        } catch (err) {
          toast(err.message, "error");
        }
      });

      tbody.appendChild(tr);
    });
    if (!templates.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="muted">Каталог uProject пуст или недоступен</td></tr>`;
    }

    const enable = async () => {
      const id = document.getElementById("siteTemplateIdInput").value.trim();
      const name = document.getElementById("siteTemplateNameInput").value.trim();
      if (!id) {
        toast("Укажите ID шаблона", "error");
        return;
      }
      try {
        const result = await PanelAPI.post("/admin/sites/templates/visibility", { id, name });
        const savedName = result.template?.name || `#${id}`;
        toast(`Включён: ${savedName}`);
        document.getElementById("siteTemplateIdInput").value = "";
        document.getElementById("siteTemplateNameInput").value = "";
        await mountTemplatesVisibility(container, { onMeta });
      } catch (e) {
        toast(e.message, "error");
      }
    };
    document.getElementById("siteTemplateEnable").addEventListener("click", enable);
    document.getElementById("siteTemplateIdInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") enable();
    });
    document.getElementById("siteTemplateNameInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") enable();
    });

    const createHint = document.getElementById("adminTemplateHint");
    const setCreateHint = (text) => {
      if (!createHint) return;
      const value = String(text || "").trim();
      createHint.textContent = value;
      createHint.hidden = !value;
    };
    const fileInput = document.getElementById("adminTemplateFile");
    const fileNameEl = document.getElementById("adminTemplateFileName");
    document.getElementById("adminTemplateFileBtn")?.addEventListener("click", () => {
      fileInput?.click();
    });
    fileInput?.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      const nameInput = document.getElementById("adminTemplateName");
      const codeInput = document.getElementById("adminTemplateCode");
      if (!file) {
        if (fileNameEl) {
          fileNameEl.textContent = "";
          fileNameEl.hidden = true;
        }
        return;
      }
      try {
        if (codeInput) codeInput.value = await file.text();
        if (nameInput && !nameInput.value.trim()) {
          nameInput.value = String(file.name || "").replace(/\.html?$/i, "").slice(0, 80);
        }
        if (fileNameEl) {
          fileNameEl.textContent = file.name;
          fileNameEl.hidden = false;
        }
        setCreateHint("");
      } catch (error) {
        setCreateHint(error.message || "Не удалось прочитать файл");
      }
    });
    document.getElementById("adminTemplateCreate")?.addEventListener("click", async () => {
      const nameInput = document.getElementById("adminTemplateName");
      const codeInput = document.getElementById("adminTemplateCode");
      const submitBtn = document.getElementById("adminTemplateCreate");
      const name = String(nameInput?.value || "").trim();
      const code = String(codeInput?.value || "").trim();
      if (!name) {
        setCreateHint("Укажите название шаблона");
        nameInput?.focus();
        return;
      }
      if (!code) {
        setCreateHint("Пришлите HTML-код шаблона");
        codeInput?.focus();
        return;
      }
      submitBtn.disabled = true;
      setCreateHint("");
      try {
        const result = await PanelAPI.post("/admin/sites/templates", {
          name,
          code,
          isPublic: Boolean(document.getElementById("adminTemplatePublic")?.checked),
        });
        const savedName = result.template?.name || name;
        toast(`Создан шаблон: ${savedName}`);
        await mountTemplatesVisibility(container, { onMeta });
      } catch (error) {
        setCreateHint(error.message || "Не удалось создать шаблон");
        toast(error.message, "error");
        submitBtn.disabled = false;
      }
    });
  }

  async function renderSteam() {
    main.innerHTML = `
      <div class="greeting">
        <div>
          <h1 class="greeting-title">Логи Steam</h1>
          <p class="greeting-sub">Последние аккаунты панели · поиск по ID</p>
        </div>
      </div>
      <div class="panel-card">
        <div class="panel-card-body" style="padding-top:16px">
          <div class="search-row">
            <input class="search-input" id="steamId" placeholder="ID лога (цифры) или оставьте пустым" />
            <button type="button" class="btn-primary" id="steamSearch">Найти</button>
            <button type="button" class="btn-ghost" id="steamRefresh">Обновить</button>
          </div>
          <div class="table-wrap">
            <table class="data">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Логин</th>
                    <th>Тип</th>
                    <th>Цена</th>
                    <th>Владелец</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody id="steamBody">
                  <tr><td colspan="6" class="muted">Загрузка…</td></tr>
                </tbody>
            </table>
          </div>
          <pre id="steamOut" hidden style="margin:14px 0 0;padding:12px;background:#202124;border-radius:10px;overflow:auto;font-size:12px;color:#b6b6b8;max-height:360px;white-space:pre-wrap"></pre>
        </div>
      </div>
    `;

    const body = document.getElementById("steamBody");
    const out = document.getElementById("steamOut");

    function rowCells(row) {
      const owner = row.owner?.telegram || row.owner?.username || "—";
      const kind = row.kindLabel || row.status || "—";
      const price =
        row.priceUsd != null && Number.isFinite(Number(row.priceUsd))
          ? `$${Number(row.priceUsd).toFixed(2)}`
          : "—";
      const kindClass = /mafile/i.test(String(row.kind || kind))
        ? "ok"
        : /invalid|невалид/i.test(String(row.status || ""))
          ? "bad"
          : "ok";
      return `
        <td class="muted">${escapeHtml(row.id ?? "—")}</td>
        <td>${escapeHtml(row.username || "—")}</td>
        <td><span class="badge ${kindClass}">${escapeHtml(kind)}</span></td>
        <td>${escapeHtml(price)}</td>
        <td class="muted">${escapeHtml(owner)}</td>
        <td></td>
      `;
    }

    async function loadList() {
      body.innerHTML = `<tr><td colspan="6" class="muted">Загрузка…</td></tr>`;
      out.hidden = true;
      try {
        const data = await PanelAPI.get("/admin/steam-logs");
        const rows = Array.isArray(data) ? data : data?.rows || data?.data || [];
        body.innerHTML = "";
        if (!rows.length) {
          body.innerHTML = `<tr><td colspan="6" class="muted">Логи не найдены</td></tr>`;
          return;
        }
        rows.forEach((row) => {
          const tr = document.createElement("tr");
          tr.className = "clickable-row";
          tr.innerHTML = rowCells(row);
          const btnCell = tr.lastElementChild;
          const openBtn = document.createElement("button");
          openBtn.type = "button";
          openBtn.className = "btn-ghost";
          openBtn.textContent = "JSON";
          openBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            out.hidden = false;
            out.textContent = JSON.stringify(row, null, 2);
          });
          btnCell.appendChild(openBtn);
          tr.addEventListener("click", () => {
            document.getElementById("steamId").value = String(row.id || "");
            loadById(String(row.id || ""));
          });
          body.appendChild(tr);
        });
      } catch (e) {
        body.innerHTML = `<tr><td colspan="5" class="muted">Ошибка: ${escapeHtml(e.message)}</td></tr>`;
        toast(e.message, "error");
      }
    }

    async function loadById(id) {
      if (!id) return loadList();
      body.innerHTML = `<tr><td colspan="5" class="muted">Загрузка #${escapeHtml(id)}…</td></tr>`;
      out.hidden = true;
      try {
        const data = await PanelAPI.get(`/admin/steam-logs?id=${encodeURIComponent(id)}`);
        const account = data?.account || data;
        body.innerHTML = "";
        const tr = document.createElement("tr");
        tr.innerHTML = rowCells(account);
        body.appendChild(tr);
        out.hidden = false;
        out.textContent = JSON.stringify(account, null, 2);
      } catch (e) {
        body.innerHTML = `<tr><td colspan="5" class="muted">Ошибка: ${escapeHtml(e.message)}</td></tr>`;
        toast(e.message, "error");
      }
    }

    document.getElementById("steamSearch").addEventListener("click", () => {
      loadById(document.getElementById("steamId").value.trim());
    });
    document.getElementById("steamRefresh").addEventListener("click", loadList);
    document.getElementById("steamId").addEventListener("keydown", (e) => {
      if (e.key === "Enter") loadById(e.target.value.trim());
    });
    await loadList();
  }

  const AUTO_SALES_PAGE_SIZE = 20;
  const AUTO_SALES_OPS_PAGE_SIZE = 15;
  const autoSalesListState = { page: 0, q: "", status: "" };
  const autoSalesStatsState = { period: "7d" };
  const autoSalesTeamOpsState = { page: 0, q: "", flagged: false, exportFrom: "", exportTo: "", lastExportLabel: "" };
  const autoSalesWorkersState = { q: "", issuesOnly: false };
  let autoSalesRenderSeq = 0;
  let autoSalesWorkersLoadSeq = 0;
  let autoSalesGuaranteeRefreshPromise = null;
  let lotMenuListeners = null;

  function teardownLotMenuListeners() {
    if (!lotMenuListeners) return;
    lotMenuListeners.abort();
    lotMenuListeners = null;
  }

  function closeAllLotMenus() {
    document.querySelectorAll(".as-lot-menu").forEach((menu) => {
      menu.hidden = true;
      menu.classList.remove("is-fixed");
      menu.style.cssText = "";
      menu.onclick = null;
      const id = String(menu.dataset.statusMenu || "");
      const hostBtn = id ? document.querySelector(`[data-menu-id="${CSS.escape(id)}"]`) : null;
      const host = hostBtn?.closest("td.mafile-action-cell") || hostBtn?.parentElement;
      if (host && menu.parentElement !== host) host.appendChild(menu);
      else if (!host && menu.parentElement === document.body) menu.remove();
    });
    document.querySelectorAll("[data-menu-id][aria-expanded='true']").forEach((btn) => {
      btn.setAttribute("aria-expanded", "false");
    });
    teardownLotMenuListeners();
  }

  function positionLotMenu(toggle, menu) {
    const btn = toggle.getBoundingClientRect();
    const pad = 10;
    const mw = Math.max(menu.offsetWidth || 248, 220);
    let mh = menu.offsetHeight || 220;
    const spaceBelow = window.innerHeight - btn.bottom - pad;
    const spaceAbove = btn.top - pad;
    const openUp = spaceBelow < Math.min(mh, 200) && spaceAbove > spaceBelow;
    const maxH = Math.max(140, openUp ? spaceAbove - 6 : spaceBelow - 6);
    menu.style.maxHeight = `${Math.min(mh, maxH)}px`;
    mh = Math.min(menu.offsetHeight || mh, maxH);
    let top = openUp ? btn.top - mh - 6 : btn.bottom + 6;
    let left = btn.right - mw;
    left = Math.min(Math.max(pad, left), window.innerWidth - mw - pad);
    top = Math.min(Math.max(pad, top), window.innerHeight - Math.min(mh, maxH) - pad);
    menu.style.top = `${Math.round(top)}px`;
    menu.style.left = `${Math.round(left)}px`;
    menu.style.right = "auto";
    menu.style.bottom = "auto";
    menu.style.zIndex = "10000";
  }

  function bindLotMenuDismiss(menu, toggle) {
    teardownLotMenuListeners();
    const ac = new AbortController();
    lotMenuListeners = ac;
    const { signal } = ac;
    document.addEventListener("pointerdown", (event) => {
      if (toggle.contains(event.target) || menu.contains(event.target)) return;
      closeAllLotMenus();
    }, { capture: true, signal });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeAllLotMenus();
    }, { signal });
    window.addEventListener("resize", closeAllLotMenus, { signal });
    document.addEventListener("scroll", (event) => {
      if (event.target?.closest?.(".as-lot-menu")) return;
      closeAllLotMenus();
    }, { capture: true, signal });
  }

  function openLotMenu(toggle, menu, onPick) {
    const alreadyOpen = !menu.hidden && menu.classList.contains("is-fixed") && menu.parentElement === document.body;
    closeAllLotMenus();
    if (alreadyOpen) return;

    document.body.appendChild(menu);
    menu.hidden = false;
    menu.classList.add("is-fixed");
    positionLotMenu(toggle, menu);
    toggle.setAttribute("aria-expanded", "true");

    menu.onclick = (event) => {
      const actionBtn = event.target.closest("[data-lot-action]");
      if (!actionBtn) {
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const sourceId = menu.dataset.statusMenu;
      const action = actionBtn.dataset.lotAction;
      closeAllLotMenus();
      onPick(sourceId, action);
    };

    bindLotMenuDismiss(menu, toggle);
  }

  function autoSalesQueryPath() {
    const params = new URLSearchParams();
    params.set("limit", String(AUTO_SALES_PAGE_SIZE));
    params.set("page", String(autoSalesListState.page || 0));
    params.set("opsLimit", String(AUTO_SALES_OPS_PAGE_SIZE));
    params.set("opsPage", String(autoSalesTeamOpsState.page || 0));
    params.set("period", autoSalesStatsState.period || "7d");
    if (autoSalesTeamOpsState.q) params.set("opsQ", autoSalesTeamOpsState.q);
    if (autoSalesTeamOpsState.flagged) params.set("opsFlagged", "1");
    if (autoSalesListState.q) params.set("q", autoSalesListState.q);
    if (autoSalesListState.status) params.set("status", autoSalesListState.status);
    return `/admin/auto-sales?${params.toString()}`;
  }

  function autoSalesWorkersPath() {
    const params = new URLSearchParams();
    params.set("limit", "120");
    params.set("includeTx", "0");
    if (autoSalesWorkersState.q) params.set("q", autoSalesWorkersState.q);
    if (autoSalesWorkersState.issuesOnly) params.set("issuesOnly", "1");
    return `/admin/finance?${params.toString()}`;
  }

  function refreshAutoSalesGuarantees() {
    if (!autoSalesGuaranteeRefreshPromise) {
      autoSalesGuaranteeRefreshPromise = PanelAPI.post("/admin/auto-sales/refresh-guarantees", {})
        .finally(() => {
          autoSalesGuaranteeRefreshPromise = null;
        });
    }
    return autoSalesGuaranteeRefreshPromise;
  }

  async function renderAutoSales() {
    const renderSeq = ++autoSalesRenderSeq;
    const workerLoadSeq = ++autoSalesWorkersLoadSeq;
    const financePromise = PanelAPI.get(autoSalesWorkersPath(), { force: true })
      .catch(() => ({ overview: { workers: [] } }));
    const data = await PanelAPI.get(autoSalesQueryPath(), { force: true });
    const stats = data.stats || {
      statuses: {},
      total: 0,
      onSale: 0,
      onSaleUsd: 0,
      sold: 0,
      heldDisplay: "$0.00",
      frozenBalancesDisplay: "$0.00",
      workerShareDisplay: "$0.00",
      workerShareTotalDisplay: "$0.00",
      workerShareOnHoldDisplay: "$0.00",
      workerShareReleasedDisplay: "$0.00",
      teamShareDisplay: "$0.00",
      teamShareOnHoldDisplay: "$0.00",
      releasedDisplay: "$0.00",
      grossSoldDisplay: "$0.00",
      onSaleDisplay: "$0.00",
      missingCreditCount: 0,
      onSaleSource: "db",
      activeGuaranteeCount: 0,
      activeGuaranteeGrossDisplay: "$0.00",
    };
    const st = stats.statuses || {};
    let filterStatus = autoSalesListState.status || "";
    const missingCredit = Number(stats.missingCreditCount || 0);
    if (data.teamOpsLastExportLabel) {
      autoSalesTeamOpsState.lastExportLabel = data.teamOpsLastExportLabel;
    }
    const teamShareDisplay = String(stats.periodTeamShareDisplay || "$0.00")
      .replace(/^\$-/, "−$")
      .replace(/^-(?=\d)/, "−");
    const periodLabel = String(stats.periodLabel || "7 дней");
    const uproject = stats.uprojectFinance || null;
    const uprojectBalanceDisplay = String(uproject?.balanceDisplay || "$0.00")
      .replace(/^\$-/, "−$")
      .replace(/^-(?=\d)/, "−");
    const lztSummaryReady = stats.onSaleSource === "lzt";

    closeAllLotMenus();
    main.innerHTML = `
      <div class="greeting as-page-head">
        <div>
          <h1 class="greeting-title">Автопродажи</h1>
          <p class="greeting-sub">Текущие лоты LZT, продажи, гарантии и экономика команды</p>
        </div>
        <div class="as-head-tools">
          <div class="as-period-switch" id="autoSalesPeriod" role="group" aria-label="Период статистики">
            ${[
              ["24h", "24 часа"],
              ["7d", "7 дней"],
              ["30d", "30 дней"],
            ].map(([value, label]) => `<button type="button" data-stats-period="${value}" class="${autoSalesStatsState.period === value ? "is-active" : ""}" aria-pressed="${autoSalesStatsState.period === value ? "true" : "false"}">${label}</button>`).join("")}
          </div>
          <div class="as-actions">
            <button type="button" class="btn-ghost" id="autoSalesRefresh">Обновить</button>
            <button type="button" class="btn-primary" id="autoSalesSync">Синхронизировать</button>
          </div>
        </div>
      </div>
      <section class="as-overview-grid" aria-label="Ключевые показатели">
        <article class="as-overview-item is-net">
          <div class="as-overview-label">Чистая доля команды <span>${escapeHtml(periodLabel)}</span></div>
          <strong class="${Number(stats.periodTeamShareUsd || 0) < 0 ? "is-negative" : ""}">${escapeHtml(teamShareDisplay)}</strong>
          <p>${escapeHtml(stats.periodTeamShareGrossDisplay || "$0.00")} начислено <i>−</i> ${escapeHtml(stats.periodTeamShareDebitedDisplay || "$0.00")} комиссий</p>
        </article>
        <article class="as-overview-item">
          <div class="as-overview-label">На продаже в LZT <span>сейчас</span></div>
          <strong><span id="asLztCount">${lztSummaryReady ? Number(stats.lztOnSaleCount || 0) : "—"}</span> <em>лотов</em></strong>
          <p id="asLztAmount">${lztSummaryReady ? `${escapeHtml(stats.lztOnSaleDisplay || "$0.00")} общей стоимости` : "Обновляем данные LZT…"}</p>
        </article>
        <article class="as-overview-item">
          <div class="as-overview-label">Продано <span>${escapeHtml(periodLabel)}</span></div>
          <strong>${Number(stats.periodSoldCount || 0)} <em>лотов</em></strong>
          <p>${escapeHtml(stats.periodGrossSoldDisplay || "$0.00")} оборот продаж</p>
        </article>
        <article class="as-overview-item">
          <div class="as-overview-label">В холде <span>сейчас</span></div>
          <strong>${Number(st.sold_held || 0)} <em>лотов</em></strong>
          <p>${escapeHtml(stats.heldGrossDisplay || "$0.00")} заморожено до подтверждения LZT</p>
        </article>
      </section>

      <section class="as-live-strip" aria-label="Дополнительные показатели">
        <div><span>Воркерам начислено</span><strong>${escapeHtml(stats.periodWorkerShareReleasedDisplay || "$0.00")}</strong><small>${escapeHtml(periodLabel)}</small></div>
        <div><span>Доля команды в холде</span><strong>${escapeHtml(stats.teamShareOnHoldDisplay || "$0.00")}</strong><small>не входит в чистую долю</small></div>
        <button type="button" data-open-lot-filter="guarantee_active"><span>Активная гарантия</span><strong>${Number(stats.activeGuaranteeCount || 0)}</strong><small>${escapeHtml(stats.activeGuaranteeGrossDisplay || "$0.00")} · открыть лоты</small></button>
        <div><span>Арбитраж</span><strong>${Number(st.arbitration || 0)}</strong><small>активных претензий</small></div>
        <button type="button" data-open-lot-filter="needs_credit"><span>Требуют внимания</span><strong>${missingCredit + Number(stats.periodFailedCount || 0)}</strong><small>${Number(stats.periodFailedCount || 0)} ошибок · ${missingCredit} без начисления</small></button>
      </section>
      <section class="as-ops-card" aria-labelledby="asOpsTitle">
        <header class="as-ops-head">
          <div>
            <h2 class="panel-card-title" id="asOpsTitle">Доля команды</h2>
            <p class="as-ops-sub" id="asOpsSub">Расчёт доли и журнал комиссий за ${escapeHtml(periodLabel).toLowerCase()}</p>
          </div>
          <div class="as-ops-count">
            <strong id="asOpsCount">${Number(data.teamOpsTotal || 0)}</strong>
            <span>записей</span>
          </div>
        </header>
        <div class="as-ops-balance" aria-label="Расчёт доли команды">
          <div><span>Начислено</span><strong>${escapeHtml(stats.periodTeamShareGrossDisplay || "$0.00")}</strong></div>
          <div><span>Комиссии</span><strong>−${escapeHtml(stats.periodTeamShareDebitedDisplay || "$0.00")}</strong></div>
          <div class="${Number(stats.periodTeamShareUsd || 0) < 0 ? "is-negative" : ""}"><span>Чистая доля</span><strong>${escapeHtml(teamShareDisplay)}</strong></div>
          <div><span>UProject</span><strong id="asUprojectBalance">${uproject ? escapeHtml(uprojectBalanceDisplay) : "—"}</strong><small>текущий баланс счёта</small></div>
        </div>
        <div class="as-ops-toolbar">
          <label class="as-ops-search">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.6"/><path d="M16.2 16.2 20 20" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
            <input class="search-input" id="autoSalesOpsSearch" type="search" placeholder="ID MaFile или администратор" value="${escapeHtml(autoSalesTeamOpsState.q || "")}" />
          </label>
          <div class="as-ops-toolbar__group" role="group" aria-label="Фильтр">
            <button type="button" class="btn-ghost${autoSalesTeamOpsState.flagged ? " is-active" : ""}" id="autoSalesOpsFlagged" aria-pressed="${autoSalesTeamOpsState.flagged ? "true" : "false"}">Расхождения</button>
          </div>
          <div class="as-ops-toolbar__group" role="group" aria-label="Операции">
            <button type="button" class="btn-ghost" id="autoSalesImportOps">Импорт UProject</button>
            <button type="button" class="btn-primary" id="autoSalesAddOp">Добавить</button>
          </div>
          <details class="as-export-disclosure">
            <summary>Выгрузка журнала</summary>
            <div class="as-ops-period">
              <label>Начало периода<input id="autoSalesExportFrom" type="text" autocomplete="off" spellcheck="false" placeholder="28.08.2026 10:30:00" value="${escapeHtml(autoSalesTeamOpsState.exportFrom || "")}" /></label>
              <label>Окончание периода<input id="autoSalesExportTo" type="text" autocomplete="off" spellcheck="false" placeholder="28.08.2026 14:00:00" value="${escapeHtml(autoSalesTeamOpsState.exportTo || "")}" /></label>
              <div class="as-ops-period-action">
                <button type="button" class="btn-primary" id="autoSalesExportOps">${autoSalesTeamOpsState.flagged ? "Выгрузить расхождения" : "Выгрузить журнал"}</button>
              </div>
              <p class="as-ops-period-hint">${autoSalesTeamOpsState.flagged ? `Только расхождения. Пустое начало — с последней выгрузки${autoSalesTeamOpsState.lastExportLabel ? ` (${escapeHtml(autoSalesTeamOpsState.lastExportLabel)})` : ""}.` : "Пустое начало — за всё время."} Время МСК, файл будет отправлен в Telegram.</p>
            </div>
          </details>
        </div>
        <div class="as-ops-body">
          <div class="table-wrap">
            <table class="data as-ops-table">
              <thead>
                <tr>
                  <th>Операция</th>
                  <th>Списано</th>
                  <th>Получено</th>
                  <th>Стоимость</th>
                  <th>Источник</th>
                  <th>Дата</th>
                  <th aria-label="Действия"></th>
                </tr>
              </thead>
              <tbody id="autoSalesTeamOps"></tbody>
            </table>
          </div>
          <nav class="as-ops-pagination" id="autoSalesOpsPagination" aria-label="Страницы списаний"></nav>
        </div>
      </section>
      <div class="panel-card mafile-table-card as-table-card">
        <div class="panel-card-head mafile-table-head">
          <div>
            <h2 class="panel-card-title">Лоты</h2>
            <p class="as-table-sub">Текущие публикации, продажи и гарантии с привязкой к воркерам</p>
          </div>
          <div class="mafile-table-tools">
            <input class="search-input" id="autoSalesSearch" type="search" placeholder="ID, аккаунт, воркер, lzt…" value="${escapeHtml(autoSalesListState.q || "")}" />
            <div id="autoSalesStatusFilter" class="custom-select-host"></div>
          </div>
        </div>
        <div class="as-lot-views" id="autoSalesLotViews" role="group" aria-label="Быстрые фильтры лотов">
          ${[
            ["", "Все"],
            ["on_sale", "На LZT"],
            ["guarantee_active", "Активная гарантия"],
            ["guarantee_12h", "Гарантия 12ч"],
            ["needs_credit", "Требуют внимания"],
          ].map(([value, label]) => `<button type="button" data-lot-view="${value}" class="${filterStatus === value ? "is-active" : ""}" aria-pressed="${filterStatus === value ? "true" : "false"}">${label}</button>`).join("")}
        </div>
        <div class="panel-card-body mafile-table-body">
          <div class="table-wrap">
            <table class="data mafile-data-table as-data-table">
              <thead>
                <tr>
                  <th>Лот LZT</th>
                  <th>Аккаунт</th>
                  <th>Воркер</th>
                  <th>Финансы</th>
                  <th>Гарантия</th>
                  <th>Событие</th>
                  <th aria-label="Действия"></th>
                </tr>
              </thead>
              <tbody id="autoSalesRows"></tbody>
            </table>
          </div>
          <footer class="sc-pagination" id="autoSalesPagination"></footer>
        </div>
      </div>
      <section class="as-wk" aria-label="Воркеры">
        <header class="as-wk-head">
          <h2 class="as-wk-title">Воркеры</h2>
          <div class="as-wk-tools">
            <input class="as-wk-search" id="autoSalesWorkerSearch" type="search" placeholder="Поиск" value="${escapeHtml(autoSalesWorkersState.q || "")}" />
            <button type="button" class="as-wk-filter${autoSalesWorkersState.issuesOnly ? " is-active" : ""}" id="autoSalesWorkerIssues">С проблемами</button>
          </div>
        </header>
        <div class="as-wk-table-wrap">
          <table class="as-wk-table">
            <thead>
              <tr>
                <th>Воркер</th>
                <th>Баланс</th>
                <th>Холд</th>
                <th>Доступно</th>
                <th>Автопродажи</th>
                <th>Холды</th>
                <th>Тип</th>
                <th>Сверка</th>
              </tr>
            </thead>
            <tbody id="autoSalesWorkers"></tbody>
          </table>
        </div>
      </section>
    `;

    if (!lztSummaryReady) {
      PanelAPI.get("/admin/auto-sales/lzt-summary", { force: true })
        .then((summary) => {
          if (renderSeq !== autoSalesRenderSeq) return;
          const count = document.getElementById("asLztCount");
          const amount = document.getElementById("asLztAmount");
          if (!count || !amount) return;
          if (!summary?.available) {
            count.textContent = "—";
            amount.textContent = "LZT временно недоступен";
            return;
          }
          count.textContent = String(Number(summary.count || 0));
          amount.textContent = `${summary.display || "$0.00"} общей стоимости`;
        })
        .catch(() => {
          if (renderSeq !== autoSalesRenderSeq) return;
          const amount = document.getElementById("asLztAmount");
          if (amount) amount.textContent = "LZT временно недоступен";
        });
    }
    if (!uproject) {
      PanelAPI.get("/admin/auto-sales/uproject-summary", { force: true })
        .then((summary) => {
          if (renderSeq !== autoSalesRenderSeq) return;
          const balance = document.getElementById("asUprojectBalance");
          if (!balance) return;
          balance.textContent = String(summary?.balanceDisplay || "$0.00")
            .replace(/^\$-/, "−$")
            .replace(/^-(?=\d)/, "−");
        })
        .catch(() => {});
    }
    if (Number(st.sold_held || 0) > 0) {
      const renderedGuarantee12h = Number(stats.activeGuarantee12hCount || 0);
      const renderedGuaranteeActive = Number(stats.activeGuaranteeCount || 0);
      refreshAutoSalesGuarantees()
        .then((summary) => {
          if (renderSeq !== autoSalesRenderSeq || !summary) return;
          const nextGuarantee12h = Number(summary.activeGuarantee12hCount || 0);
          const nextGuaranteeActive = Number(summary.activeGuaranteeCount || 0);
          if (
            nextGuarantee12h === renderedGuarantee12h &&
            nextGuaranteeActive === renderedGuaranteeActive &&
            Number(summary.changed || 0) === 0
          ) return;
          renderAutoSales().catch((error) => toast(error.message, "error"));
        })
        .catch(() => {});
    }

    const rowsBody = document.getElementById("autoSalesRows");
    const opsBody = document.getElementById("autoSalesTeamOps");
    let currentRows = Array.isArray(data.rows) ? data.rows : [];
    let currentTeamOps = Array.isArray(data.teamOps) ? data.teamOps : [];
    let currentWorkers = [];
    let lotsPage = Number(data.page || 0);
    let lotsPageCount = Number(data.pageCount || 1);
    let opsPage = Number(data.teamOpsPage || 0);
    let opsPageCount = Number(data.teamOpsPageCount || 1);
    let opsTotal = Number(data.teamOpsTotal || 0);
    autoSalesListState.page = lotsPage;
    autoSalesTeamOpsState.page = opsPage;

    if (window.AdminDropdown) {
      AdminDropdown.mount(document.getElementById("autoSalesStatusFilter"), {
        value: filterStatus,
        ariaLabel: "Фильтр статуса",
        options: [
          { value: "", label: "Все статусы" },
          { value: "active", label: "Активные" },
          { value: "on_sale", label: "На продаже" },
          { value: "listed", label: "Лот выставлен" },
          { value: "sold", label: "Проданные" },
          { value: "sold_held", label: "Продан · холд" },
          { value: "guarantee_active", label: "Активная гарантия" },
          { value: "guarantee_12h", label: "Активная гарантия 12ч" },
          { value: "arbitration", label: "Арбитраж" },
          { value: "released", label: "Холд снят" },
          { value: "needs_credit", label: "Без начисления" },
          { value: "failed", label: "Ошибка" },
          { value: "queued", label: "В очереди" },
          { value: "listing", label: "Выставляется" },
        ],
        onChange: (value) => {
          filterStatus = value;
          autoSalesListState.status = value;
          autoSalesListState.page = 0;
          reload().catch((error) => toast(error.message, "error"));
        },
      });
    }

    document.getElementById("autoSalesPeriod")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-stats-period]");
      if (!button || button.dataset.statsPeriod === autoSalesStatsState.period) return;
      autoSalesStatsState.period = button.dataset.statsPeriod || "7d";
      autoSalesListState.page = 0;
      autoSalesTeamOpsState.page = 0;
      renderAutoSales().catch((error) => toast(error.message, "error"));
    });

    const openLotView = (value, { trigger = null, scroll = false } = {}) => {
      const nextStatus = String(value || "");
      autoSalesListState.status = nextStatus;
      autoSalesListState.page = 0;
      if (trigger) {
        trigger.classList.add("is-loading");
        trigger.setAttribute("aria-busy", "true");
      }
      const refreshGuarantees =
        nextStatus === "guarantee_active" || nextStatus === "guarantee_12h"
          ? refreshAutoSalesGuarantees().catch((error) => {
              toast(error.message, "error");
              return null;
            })
          : Promise.resolve(null);
      renderAutoSales()
        .then(() => {
          if (scroll) {
            document.querySelector(".as-table-card")?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
          }
          return refreshGuarantees.then((summary) => {
            if (!summary || autoSalesListState.status !== nextStatus) return null;
            return renderAutoSales().then(() => {
              if (!scroll) return;
              document.querySelector(".as-table-card")?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });
            });
          });
        })
        .catch((error) => toast(error.message, "error"))
        .finally(() => {
          if (!trigger) return;
          trigger.classList.remove("is-loading");
          trigger.removeAttribute("aria-busy");
        });
    };
    document.getElementById("autoSalesLotViews")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-lot-view]");
      if (!button) return;
      openLotView(button.dataset.lotView || "", { trigger: button });
    });
    document.querySelectorAll("[data-open-lot-filter]").forEach((button) => {
      button.addEventListener("click", () => openLotView(button.dataset.openLotFilter || "", {
        trigger: button,
        scroll: true,
      }));
    });

    function dateTime(value) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "—";
      return date.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
    }

    function statusBadge(row) {
      const status = String(row.autoSaleStatus || "");
      let cls = "wait";
      if (status === "released") cls = "ok";
      if (status === "failed") cls = "bad";
      if (status === "arbitration") cls = "arb";
      let tip = String(row.statusTooltip || "").trim();
      if (!tip && (status === "sold_held" || status === "arbitration")) {
        const bits = [];
        if (row.autoSaleHoldUntil) bits.push(`Холд до ${dateTime(row.autoSaleHoldUntil)}`);
        if (row.autoSaleHoldRemainingPhrase) bits.push(`осталось ${row.autoSaleHoldRemainingPhrase}`);
        if (status === "arbitration") bits.unshift("Открыт арбитраж");
        tip = bits.join(" · ");
      }
      const tipAttr = tip
        ? ` data-tip="${escapeHtml(tip)}" title="${escapeHtml(tip)}"`
        : "";
      return `<span class="badge ${cls}"${tipAttr}>${escapeHtml(row.statusLabel || status)}</span>`;
    }

    function moneyCells(row) {
      const share = Number(row.autoSaleWorkerShareUsd || 0);
      const gross = Number(row.autoSaleGrossUsd || 0);
      const estimate = Number(row.totalProfit || 0);
      const miss = Boolean(row.needsCredit);
      const grossCell =
        gross > 0
          ? `<strong>$${gross.toFixed(2)}</strong>`
          : estimate > 0
            ? `<strong>$${estimate.toFixed(2)}</strong><small>оценка лога</small>`
            : `<span class="muted">—</span>`;
      let shareCell = share > 0 ? `<strong>$${share.toFixed(2)}</strong>` : `<span class="muted">—</span>`;
      if (miss) {
        shareCell = `<span class="badge bad">не начислено</span>`;
      } else if (row.holdActive && share > 0) {
        shareCell += `<small>на холде</small>`;
      }
      return `<td>${grossCell}</td><td>${shareCell}</td>`;
    }

    function ownerCell(row) {
      const owner = row.owner || {};
      // Admin view: always real identity (ignore isAnonymous / fakeProfitTag).
      const name =
        owner.firstName ||
        (owner.username ? `@${owner.username}` : "") ||
        row.ownerTelegramId ||
        "—";
      const handle = owner.username ? `@${owner.username}` : "";
      const idLine = [
        handle && handle !== name ? handle : "",
        `TG ${row.ownerTelegramId || "—"}`,
      ]
        .filter(Boolean)
        .join(" · ");
      const frozen =
        Number(owner.frozenSaleUsd || 0) > 0
          ? `<small>холд кошелька $${Number(owner.frozenSaleUsd).toFixed(2)}</small>`
          : "";
      const clickable = row.ownerTelegramId
        ? `class="clickable-row" data-open-member="${escapeHtml(row.ownerTelegramId)}"`
        : "";
      return `<td ${clickable}><strong>${escapeHtml(name)}</strong><small>${escapeHtml(idLine)}</small>${frozen}</td>`;
    }

    function lotMenu(row) {
      const actions = row.actions || {};
      const buttons = [];
      if (actions.canSync) {
        buttons.push(`<button type="button" data-lot-action="sync">Синхронизировать с LZT</button>`);
      }
      if (actions.canCredit) {
        buttons.push(`<button type="button" data-lot-action="credit">Начислить воркеру</button>`);
      }
      if (actions.canReleaseHold) {
        buttons.push(`<button type="button" data-lot-action="release-hold">Снять холд с баланса</button>`);
      }
      if (actions.canClawback) {
        if (buttons.length) buttons.push(`<div class="mafile-status-menu-sep"></div>`);
        buttons.push(`<button type="button" class="danger" data-lot-action="clawback">Забрать деньги с холда</button>`);
      }
      if (!buttons.length) {
        buttons.push(`<div class="mafile-status-menu-title">Нет действий</div>`);
      }
      return `
        <td class="mafile-action-cell">
          <button type="button" class="mafile-menu-btn" data-menu-id="${escapeHtml(row.sourceId)}" aria-label="Действия с лотом" aria-haspopup="menu" aria-expanded="false">•••</button>
          <div class="mafile-status-menu as-lot-menu" data-status-menu="${escapeHtml(row.sourceId)}" hidden>
            <div class="mafile-status-menu-title">Лот</div>
            ${buttons.join("")}
          </div>
        </td>`;
    }

    function opAccountId(op) {
      const fromField = String(op.accountId || "").trim();
      if (fromField) return fromField;
      const match = String(op.reason || "").match(/#(\d{3,})\b/);
      return match ? match[1] : "";
    }

    function opReasonLabel(reason, accountId) {
      let text = String(reason || "").trim();
      const id = String(accountId || "").trim();
      if (!id) return text;
      const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return text
        .replace(new RegExp(`(?:\\s*[·•]\\s*)?#${escaped}\\b`, "gi"), "")
        .replace(/\s*[·•]\s*$/, "")
        .trim();
    }

    async function copyListedId(id) {
      const value = String(id || "").trim();
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        toast(`ID ${value} скопирован`, "success");
      } catch (_) {
        toast("Не удалось скопировать", "error");
      }
    }

    function opMoney(value) {
      if (value == null || value === "") return `<span class="muted">—</span>`;
      const amount = Number(value);
      if (!Number.isFinite(amount)) return `<span class="muted">—</span>`;
      return `$${amount.toFixed(2)}`;
    }

    function opAdminCell(op) {
      const label = String(op.adminLabel || "").trim()
        || (op.source === "uproject" ? "UProject" : "")
        || (op.actorUsername ? `@${String(op.actorUsername).replace(/^@/, "")}` : "")
        || op.actorTelegramId
        || "Админ";
      return `<td>${escapeHtml(label)}</td>`;
    }

    function renderTeamOps(ops) {
      if (!opsBody) return;
      closeAllLotMenus();
      const countEl = document.getElementById("asOpsCount");
      if (countEl) countEl.textContent = String(opsTotal);
      const exportBtn = document.getElementById("autoSalesExportOps");
      if (exportBtn) exportBtn.disabled = false;
      if (!ops.length) {
        const title = autoSalesTeamOpsState.flagged
          ? "Расхождений нет"
          : autoSalesTeamOpsState.q
            ? "Ничего не найдено"
            : "Списаний пока нет";
        const hint = autoSalesTeamOpsState.flagged
          ? "Невалид или не продан после конвертации"
          : "Импортируйте комиссии UProject или добавьте операцию администратором";
        opsBody.innerHTML = `<tr><td colspan="7"><div class="as-ops-empty">
          <span class="as-ops-empty__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none"><rect x="4" y="5.5" width="16" height="13" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M8 9.5h8M8 13h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </span>
          <strong>${title}</strong>
          <span>${hint}</span>
        </div></td></tr>`;
        return;
      }
      opsBody.innerHTML = ops
        .map((op) => {
          const canceled = String(op.status || "") === "canceled";
          const id = opAccountId(op);
          const idHtml = id
            ? `<button type="button" class="auto-sales-id-btn" data-copy-id="${escapeHtml(id)}" title="Скопировать ID">#${escapeHtml(id)}</button>`
            : `<span class="muted">—</span>`;
          const amount = Number(op.amountUsd || 0);
          const shortfall = Number(op.shortfallUsd || 0);
          const amountHtml = `<strong>−$${amount.toFixed(2)}</strong>${shortfall > 0 ? `<small class="as-ops-shortfall">разрыв $${shortfall.toFixed(2)}</small>` : ""}`;
          const cancelCell = canceled
            ? `<td class="muted">отменено</td>`
            : `<td class="mafile-action-cell">
                <button type="button" class="mafile-menu-btn" data-menu-id="${escapeHtml(op.id)}" aria-label="Действия со списанием" aria-haspopup="menu" aria-expanded="false">•••</button>
                <div class="mafile-status-menu as-lot-menu" data-status-menu="${escapeHtml(op.id)}" hidden>
                  <div class="mafile-status-menu-title">Списание</div>
                  <button type="button" class="danger" data-lot-action="cancel">Отменить и вернуть на долю</button>
                </div>
              </td>`;
          const logId = String(op.logId || "").trim();
          const logHtml = op.converted && logId
            ? `<button type="button" class="auto-sales-id-btn as-ops-log-id" data-copy-id="${escapeHtml(logId)}" title="Скопировать ID лога">лог #${escapeHtml(logId)}</button>`
            : "";
          const flagHtml = op.flagLabel
            ? `<span class="as-op-flag as-op-flag--${escapeHtml(op.flag)}">${escapeHtml(op.flagLabel)}</span>`
            : "";
          const reason = opReasonLabel(op.reason, id);
          return `<tr class="${canceled ? "is-canceled" : ""}${op.flag ? " is-flagged" : ""}">
            <td><div class="as-ops-id-head">${idHtml}${flagHtml}</div>${logHtml}${reason ? `<small>${escapeHtml(reason)}</small>` : ""}</td>
            <td>${amountHtml}${canceled ? `<small>вернуто</small>` : ""}</td>
            <td>${opMoney(op.withdrawnUsd)}</td>
            <td>${op.inventoryUsd ? opMoney(op.inventoryUsd) : `<span class="muted">—</span>`}</td>
            ${opAdminCell(op)}
            <td class="muted">${escapeHtml(dateTime(op.createdAt))}</td>
            ${cancelCell}
          </tr>`;
        })
        .join("");
    }

    async function cancelTeamOp(opId) {
      const op = currentTeamOps.find((item) => String(item.id) === String(opId));
      if (!op || op.status === "canceled") return;
      const amount = Number(op.amountUsd || 0).toFixed(2);
      const ok = await GarbonaAdminConfirm.open(
        `Вернуть $${amount} на долю команды?`,
        { title: "Отменить списание", confirmLabel: "Вернуть" }
      );
      if (!ok) return;
      try {
        await PanelAPI.post(`/admin/auto-sales/team-ops/${encodeURIComponent(opId)}/cancel`);
        toast(`$${amount} вернулись на долю команды`, "success");
        PanelAPI.bust("/admin/auto-sales");
        await renderAutoSales();
      } catch (error) {
        toast(error.message, "error");
      }
    }

    function dashPaginationPages(page, pageCount) {
      const current = Math.min(Math.max(1, Number(page) || 1), pageCount);
      const pages = Array.from({ length: pageCount }, (_, index) => index + 1);
      if (pageCount <= 5) return pages;
      return pages.filter(
        (value) => value === 1 || value === pageCount || Math.abs(value - current) <= 1
      );
    }

    function renderOpsPagination() {
      const box = document.getElementById("autoSalesOpsPagination");
      if (!box) return;
      const pageCount = Math.max(1, opsPageCount);
      if (pageCount <= 1) {
        box.innerHTML = "";
        return;
      }
      const page = opsPage + 1;
      const prevDisabled = page <= 1 ? " disabled" : "";
      const nextDisabled = page >= pageCount ? " disabled" : "";
      const visible = dashPaginationPages(page, pageCount);
      const pageButtons = visible
        .map((value, index) => {
          const prev = visible[index - 1];
          const gap = prev != null && value - prev > 1
            ? `<span class="as-ops-pagination__gap">…</span>`
            : "";
          const active = value === page ? " is-active" : "";
          const current = value === page ? ' aria-current="page"' : "";
          return `<span class="as-ops-pagination__page-wrap">${gap}<button type="button" class="as-ops-pagination__page${active}" data-ops-page="${value - 1}"${current}>${value}</button></span>`;
        })
        .join("");
      box.innerHTML = `
        <button type="button" class="as-ops-pagination__arrow" data-ops-page="${opsPage - 1}"${prevDisabled} aria-label="Назад">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 6 9 12l6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>Назад</span>
        </button>
        <div class="as-ops-pagination__center">
          <div class="as-ops-pagination__pages">${pageButtons}</div>
          <span class="as-ops-pagination__info">Страница ${page} из ${pageCount}</span>
        </div>
        <button type="button" class="as-ops-pagination__arrow" data-ops-page="${opsPage + 1}"${nextDisabled} aria-label="Далее">
          <span>Далее</span>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>`;
    }

    function askTeamOp() {
      return new Promise((resolve) => {
        let settled = false;
        const overlay = document.createElement("div");
        overlay.className = "as-op-overlay";
        overlay.innerHTML = `<form class="as-op-dialog" role="dialog" aria-modal="true" aria-labelledby="asOpTitle">
          <button type="button" class="as-op-close" data-cancel aria-label="Закрыть">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
          </button>
          <h3 id="asOpTitle">Операция</h3>
          <label class="as-op-field">
            <span>Сумма</span>
            <span class="as-op-amount">
              <span class="as-op-amount-prefix">$</span>
              <input name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" required />
            </span>
          </label>
          <label class="as-op-field">
            <span>Причина</span>
            <textarea name="reason" rows="3" required minlength="3"></textarea>
          </label>
          <div class="as-op-footer">
            <button type="button" class="btn-ghost" data-cancel>Отмена</button>
            <button type="submit" class="btn-primary">Списать</button>
          </div>
        </form>`;
        document.body.appendChild(overlay);
        const dialog = overlay.querySelector(".as-op-dialog");
        const amountInput = overlay.querySelector("[name=amount]");
        const reasonInput = overlay.querySelector("[name=reason]");
        requestAnimationFrame(() => overlay.classList.add("is-open"));
        setTimeout(() => amountInput.focus(), 40);

        const finish = (value) => {
          if (settled) return;
          settled = true;
          document.removeEventListener("keydown", onKey);
          overlay.classList.remove("is-open");
          let removed = false;
          const drop = () => {
            if (removed) return;
            removed = true;
            overlay.remove();
            resolve(value);
          };
          overlay.addEventListener("transitionend", drop, { once: true });
          setTimeout(drop, 200);
        };

        function onKey(event) {
          if (event.key === "Escape") finish(null);
        }
        document.addEventListener("keydown", onKey);
        overlay.querySelectorAll("[data-cancel]").forEach((btn) => {
          btn.addEventListener("click", () => finish(null));
        });
        overlay.addEventListener("click", (event) => {
          if (event.target === overlay) finish(null);
        });
        dialog.addEventListener("submit", (event) => {
          event.preventDefault();
          const amount = Number(amountInput.value);
          const reason = String(reasonInput.value || "").trim();
          if (!(amount > 0) || reason.length < 3) return;
          finish({ amount, reason });
        });
      });
    }

    function askImportSince() {
      return new Promise((resolve) => {
        let settled = false;
        const overlay = document.createElement("div");
        overlay.className = "as-op-overlay";
        overlay.innerHTML = `<form class="as-op-dialog" role="dialog" aria-modal="true" aria-labelledby="asImportTitle">
          <button type="button" class="as-op-close" data-cancel aria-label="Закрыть">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
          </button>
          <h3 id="asImportTitle">Импорт UProject</h3>
          <label class="as-op-field">
            <span>С даты</span>
            <input name="since" type="date" value="2026-08-27" required />
          </label>
          <div class="as-op-footer">
            <button type="button" class="btn-ghost" data-cancel>Отмена</button>
            <button type="submit" class="btn-primary">Импортировать</button>
          </div>
        </form>`;
        document.body.appendChild(overlay);
        const dialog = overlay.querySelector(".as-op-dialog");
        const sinceInput = overlay.querySelector("[name=since]");
        requestAnimationFrame(() => overlay.classList.add("is-open"));
        setTimeout(() => sinceInput.focus(), 40);

        const finish = (value) => {
          if (settled) return;
          settled = true;
          document.removeEventListener("keydown", onKey);
          overlay.classList.remove("is-open");
          let removed = false;
          const drop = () => {
            if (removed) return;
            removed = true;
            overlay.remove();
            resolve(value);
          };
          overlay.addEventListener("transitionend", drop, { once: true });
          setTimeout(drop, 200);
        };

        function onKey(event) {
          if (event.key === "Escape") finish(null);
        }
        document.addEventListener("keydown", onKey);
        overlay.querySelectorAll("[data-cancel]").forEach((btn) => {
          btn.addEventListener("click", () => finish(null));
        });
        overlay.addEventListener("click", (event) => {
          if (event.target === overlay) finish(null);
        });
        dialog.addEventListener("submit", (event) => {
          event.preventDefault();
          const since = String(sinceInput.value || "").trim();
          if (!since) return;
          finish(since);
        });
      });
    }

    function confirmLotAction(action, row) {
      const id = `#${row.sourceId}`;
      if (action === "credit") {
        return GarbonaAdminConfirm.open(`Начислить долю воркеру по логу ${id}?`, {
          title: "Начислить воркеру",
          confirmLabel: "Начислить",
        });
      }
      if (action === "release-hold") {
        return GarbonaAdminConfirm.open(
          row.needsCredit
            ? `Закрыть холд по логу ${id} без начисления воркеру?`
            : `Снять холд по логу ${id}? Воркер получит деньги на баланс.`,
          {
            title: "Снять холд",
            confirmLabel: "Снять холд",
          }
        );
      }
      if (action === "clawback") {
        return GarbonaAdminConfirm.open(
          `Лог ${id}. Доля воркера будет снята, продажа отметится отменённой.`,
          {
            title: "Забрать деньги с холда",
            confirmLabel: "Забрать",
            danger: true,
          }
        );
      }
      return true;
    }

    async function runLotAction(row, action) {
      if (!(await confirmLotAction(action, row))) return;
      try {
        await PanelAPI.post(`/admin/auto-sales/${encodeURIComponent(row.sourceId)}/action`, { action });
        const labels = {
          sync: "Синхронизировано с LZT",
          credit: "Начислено воркеру",
          "release-hold": "Холд снят",
          clawback: "Деньги забраны с холда",
        };
        toast(labels[action] || "Готово", "success");
        PanelAPI.bust("/admin/auto-sales");
        await renderAutoSales();
      } catch (error) {
        toast(error.message, "error");
      }
    }

    function renderRows(rows) {
      closeAllLotMenus();
      rowsBody.innerHTML = "";
      if (!rows.length) {
        rowsBody.innerHTML = `<tr><td colspan="7" class="muted">По выбранному фильтру лотов нет</td></tr>`;
        return;
      }
      rows.forEach((row) => {
        const tr = document.createElement("tr");
        if (row.needsCredit) tr.classList.add("as-row-miss");
        const account = row.accountUsername || row.steamId || "—";
        const lzt = row.lztMarketUrl
          ? `<a href="${escapeHtml(row.lztMarketUrl)}" target="_blank" rel="noopener">${escapeHtml(row.lztItemId || "лот")}</a>`
          : `<span class="muted">—</span>`;
        const err =
          (row.autoSaleStatus === "failed" || row.autoSaleError) && row.autoSaleError
            ? `<small class="badge bad">${escapeHtml(String(row.autoSaleError).slice(0, 80))}</small>`
            : "";
        const gross = Number(row.autoSaleGrossUsd || 0);
        const worker = Number(row.autoSaleWorkerShareUsd || 0);
        const team = Math.max(0, gross - worker);
        const finance = gross > 0
          ? `<strong>${escapeHtml(moneyUsd(gross))}</strong><small>воркер ${escapeHtml(moneyUsd(worker))} · команда ${escapeHtml(moneyUsd(team))}</small>`
          : `<span class="muted">—</span>`;
        let guarantee = `<span class="muted">—</span>`;
        if (row.holdActive) {
          guarantee = `<strong>${escapeHtml(row.autoSaleHoldRemainingPhrase || "активна")}</strong><small>${escapeHtml(row.autoSaleHoldDurationPhrase || "гарантия")}${row.autoSaleHoldUntil ? ` · до ${escapeHtml(dateTime(row.autoSaleHoldUntil))}` : ""}</small>`;
        } else if (row.autoSaleStatus === "released") {
          guarantee = `<strong>Завершена</strong><small>${row.autoSaleReleasedAt ? escapeHtml(dateTime(row.autoSaleReleasedAt)) : "холд снят"}</small>`;
        }
        tr.innerHTML = `
          <td>
            <div class="as-lot-primary">${lzt}${statusBadge(row)}</div>
            <small>${row.autoSaleSoldAt ? `продан ${escapeHtml(dateTime(row.autoSaleSoldAt))}` : row.autoSaleListedAt ? `выставлен ${escapeHtml(dateTime(row.autoSaleListedAt))}` : "лот ещё не создан"}</small>
          </td>
          <td><button type="button" class="auto-sales-id-btn" data-copy-id="${escapeHtml(row.sourceId)}" title="Скопировать ID">#${escapeHtml(row.sourceId)}</button><small>${escapeHtml(account)}</small>${err}</td>
          ${ownerCell(row)}
          <td class="as-lot-finance">${finance}</td>
          <td class="as-lot-guarantee">${guarantee}</td>
          <td class="muted">${escapeHtml(dateTime(row.autoSaleSoldAt || row.autoSaleListedAt || row.updatedAt || row.createdAt))}</td>
          ${lotMenu(row)}
        `;
        rowsBody.appendChild(tr);
      });
      enhanceClickableRows(rowsBody);
    }

    async function reload() {
      autoSalesListState.q = document.getElementById("autoSalesSearch")?.value || "";
      autoSalesListState.status = filterStatus;
      autoSalesTeamOpsState.q = document.getElementById("autoSalesOpsSearch")?.value?.trim() || "";
      const next = await PanelAPI.get(autoSalesQueryPath(), { force: true });
      currentRows = Array.isArray(next.rows) ? next.rows : [];
      currentTeamOps = Array.isArray(next.teamOps) ? next.teamOps : currentTeamOps;
      lotsPage = Number(next.page || 0);
      lotsPageCount = Number(next.pageCount || 1);
      opsPage = Number(next.teamOpsPage || 0);
      opsPageCount = Number(next.teamOpsPageCount || 1);
      opsTotal = Number(next.teamOpsTotal || 0);
      autoSalesListState.page = lotsPage;
      autoSalesTeamOpsState.page = opsPage;
      renderRows(currentRows);
      renderTeamOps(currentTeamOps);
      renderPagination();
      renderOpsPagination();
    }

    function renderPagination() {
      const box = document.getElementById("autoSalesPagination");
      if (!box) return;
      box.innerHTML = `<button type="button" data-page="${lotsPage - 1}" ${lotsPage <= 0 ? "disabled" : ""} aria-label="Предыдущая страница">‹</button>
        <span>Страница <b>${lotsPage + 1}</b> из <b>${Math.max(1, lotsPageCount)}</b></span>
        <button type="button" data-page="${lotsPage + 1}" ${lotsPage + 1 >= lotsPageCount ? "disabled" : ""} aria-label="Следующая страница">›</button>`;
    }

    function moneyUsd(value) {
      return `$${Number(value || 0).toFixed(2)}`;
    }

    function workerInitials(row) {
      const name = String(row.displayName || row.telegramId || "?").trim();
      return name.replace(/^@/, "").slice(0, 1).toUpperCase() || "?";
    }

    function holdTypeClass(kind) {
      const map = {
        log: "type-log",
        mafile: "type-mafile",
        autosale: "type-autosale",
        legacy_autosale: "type-legacy-autosale",
      };
      return map[String(kind || "").trim()] || "type-other";
    }

    function issueBadges(row) {
      const items = Array.isArray(row.reconciliationIssues)
        ? row.reconciliationIssues
        : (Array.isArray(row.issues) ? row.issues : []).filter((item) => item.severity !== "info");
      if (!items.length) return `<span class="as-wk-ok">OK</span>`;
      return items
        .map((issue) => {
          const cls = issue.severity === "high" ? "is-bad" : "is-warn";
          const label = issue.label || issue.message || issue.code || "расхождение";
          return `<span class="as-wk-pill ${cls}" title="${escapeHtml(issue.message || label)}">${escapeHtml(label)}</span>`;
        })
        .join("");
    }

    function holdTypeCell(row) {
      const summary = Array.isArray(row.holdTypeSummary) ? row.holdTypeSummary : [];
      if (!summary.length) {
        return row.legacyHoldCount > 0
          ? `<span class="as-wk-muted">старый ×${row.legacyHoldCount}</span>`
          : `<span class="as-wk-muted">—</span>`;
      }
      return summary
        .map((item) => `<span class="as-wk-pill ${holdTypeClass(item.kind)}">${escapeHtml(item.label)} ×${item.count}</span>`)
        .join("");
    }

    function renderWorkers(rows) {
      const body = document.getElementById("autoSalesWorkers");
      if (!body) return;
      if (!rows.length) {
        body.innerHTML = `<tr><td colspan="8" class="as-wk-empty">Никого нет</td></tr>`;
        return;
      }
      body.innerHTML = rows
        .map((row) => {
          const issues = Array.isArray(row.reconciliationIssues) ? row.reconciliationIssues : [];
          const holdsHint =
            row.activeHolds > 0
              ? `${row.activeHolds} · ${moneyUsd(row.activeHoldFrozenUsd)}`
              : "—";
          const autosaleShare =
            Number(row.autosaleWorkerShareUsd || 0) > 0
              ? moneyUsd(row.autosaleWorkerShareUsd)
              : "—";
          const ledgerHint =
            Math.abs(row.ledgerDelta) >= 0.05
              ? `<small>${row.ledgerDelta >= 0 ? "+" : ""}${moneyUsd(row.ledgerDelta)}</small>`
              : "";
          const holdHint =
            Math.abs(row.holdDelta) >= 0.05
              ? `<small>${row.holdDelta >= 0 ? "+" : ""}${moneyUsd(row.holdDelta)}</small>`
              : "";
          return `<tr class="${issues.length ? "has-issue" : ""}" data-open-member="${escapeHtml(row.telegramId)}">
            <td>
              <div class="as-wk-person">
                <span class="as-wk-avatar" aria-hidden="true">${escapeHtml(workerInitials(row))}</span>
                <span>
                  <b>${escapeHtml(row.displayName || row.telegramId)}</b>
                  <small>${escapeHtml(row.telegramId)} · ${Number(row.profitPercent || 0)}%</small>
                </span>
              </div>
            </td>
            <td><b>${moneyUsd(row.walletUsd)}</b>${ledgerHint}</td>
            <td><b>${moneyUsd(row.frozenSaleUsd)}</b>${holdHint}</td>
            <td>${moneyUsd(row.availableUsd)}</td>
            <td>${autosaleShare}</td>
            <td>${escapeHtml(holdsHint)}</td>
            <td class="as-wk-pills">${holdTypeCell(row)}</td>
            <td class="as-wk-pills">${issueBadges(row)}</td>
          </tr>`;
        })
        .join("");
    }

    async function reloadWorkers() {
      const loadSeq = ++autoSalesWorkersLoadSeq;
      autoSalesWorkersState.q = document.getElementById("autoSalesWorkerSearch")?.value || "";
      const next = await PanelAPI.get(autoSalesWorkersPath(), { force: true });
      if (loadSeq !== autoSalesWorkersLoadSeq) return;
      currentWorkers = Array.isArray(next?.overview?.workers) ? next.overview.workers : [];
      renderWorkers(currentWorkers);
    }

    rowsBody.addEventListener("click", async (event) => {
      const menuBtn = event.target.closest("[data-menu-id]");
      if (menuBtn) {
        event.preventDefault();
        event.stopPropagation();
        const menu = rowsBody.querySelector(`[data-status-menu="${CSS.escape(menuBtn.dataset.menuId)}"]`)
          || document.querySelector(`.as-lot-menu[data-status-menu="${CSS.escape(menuBtn.dataset.menuId)}"]`);
        if (!menu) return;
        openLotMenu(menuBtn, menu, (sourceId, action) => {
          const row = currentRows.find((item) => String(item.sourceId) === String(sourceId));
          if (row) runLotAction(row, action);
        });
        return;
      }
      const copyBtn = event.target.closest("[data-copy-id]");
      if (copyBtn) {
        event.preventDefault();
        event.stopPropagation();
        await copyListedId(copyBtn.dataset.copyId);
        return;
      }
      const member = event.target.closest("[data-open-member]");
      if (!member) return;
      openMember(member.dataset.openMember);
    });

    opsBody?.addEventListener("click", async (event) => {
      const copyBtn = event.target.closest("[data-copy-id]");
      if (copyBtn) {
        event.preventDefault();
        event.stopPropagation();
        await copyListedId(copyBtn.dataset.copyId);
        return;
      }
      const member = event.target.closest("[data-open-member]");
      if (member) {
        event.preventDefault();
        event.stopPropagation();
        openMember(member.dataset.openMember);
        return;
      }
      const menuBtn = event.target.closest("[data-menu-id]");
      if (!menuBtn) return;
      event.preventDefault();
      event.stopPropagation();
      const menu = opsBody.querySelector(`[data-status-menu="${CSS.escape(menuBtn.dataset.menuId)}"]`)
        || document.querySelector(`.as-lot-menu[data-status-menu="${CSS.escape(menuBtn.dataset.menuId)}"]`);
      if (!menu) return;
      openLotMenu(menuBtn, menu, (opId, action) => {
        if (action === "cancel") cancelTeamOp(opId);
      });
    });

    document.getElementById("autoSalesOpsFlagged")?.addEventListener("click", async () => {
      autoSalesTeamOpsState.flagged = !autoSalesTeamOpsState.flagged;
      autoSalesTeamOpsState.page = 0;
      try {
        await renderAutoSales();
      } catch (error) {
        toast(error.message, "error");
      }
    });

    document.getElementById("autoSalesExportFrom")?.addEventListener("input", (event) => {
      autoSalesTeamOpsState.exportFrom = event.currentTarget.value;
    });
    document.getElementById("autoSalesExportTo")?.addEventListener("input", (event) => {
      autoSalesTeamOpsState.exportTo = event.currentTarget.value;
    });

    document.getElementById("autoSalesExportOps")?.addEventListener("click", async () => {
      const btn = document.getElementById("autoSalesExportOps");
      if (btn) btn.disabled = true;
      try {
        autoSalesTeamOpsState.exportFrom = document.getElementById("autoSalesExportFrom")?.value?.trim() || "";
        autoSalesTeamOpsState.exportTo = document.getElementById("autoSalesExportTo")?.value?.trim() || "";
        const q = document.getElementById("autoSalesOpsSearch")?.value?.trim() || "";
        const params = new URLSearchParams();
        if (q) params.set("opsQ", q);
        params.set("scope", autoSalesTeamOpsState.flagged ? "flagged" : "all");
        if (autoSalesTeamOpsState.exportFrom) params.set("from", autoSalesTeamOpsState.exportFrom);
        if (autoSalesTeamOpsState.exportTo) params.set("to", autoSalesTeamOpsState.exportTo);
        const query = params.toString();
        const data = await PanelAPI.get(
          `/admin/auto-sales/team-ops/export${query ? `?${query}` : ""}`,
          { force: true }
        );
        const total = Number(data.total || 0);
        if (data.lastExportLabel) autoSalesTeamOpsState.lastExportLabel = data.lastExportLabel;
        const hint = document.querySelector(".as-ops-period-hint");
        if (hint) {
          hint.textContent = `${autoSalesTeamOpsState.flagged ? `Выгружаются только расхождения. Пустое начало — с последней выгрузки${autoSalesTeamOpsState.lastExportLabel ? ` (${autoSalesTeamOpsState.lastExportLabel})` : ""}.` : "Выгружается полный подробный отчёт со сводкой и всеми операциями. Пустое начало — за всё время."} МСК, с начала включительно, окончание не входит. Пустое окончание — до текущего времени. Файл уйдёт в Telegram.`;
        }
        if (!total) {
          toast(autoSalesTeamOpsState.flagged ? "В этом периоде расхождений нет" : "В этом периоде операций нет", "error");
          return;
        }
        toast(`${autoSalesTeamOpsState.flagged ? "Расхождения" : "Полный отчёт"} отправлен в Telegram · ${total} · ${data.startLabel} — ${data.endLabel}`, "success");
      } catch (error) {
        toast(error.message, "error");
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    document.getElementById("autoSalesAddOp")?.addEventListener("click", async () => {
      const payload = await askTeamOp();
      if (!payload) return;
      try {
        await PanelAPI.post("/admin/auto-sales/team-ops", payload);
        toast(`Списано $${payload.amount.toFixed(2)} с доли команды`, "success");
        PanelAPI.bust("/admin/auto-sales");
        autoSalesTeamOpsState.page = 0;
        await renderAutoSales();
      } catch (error) {
        toast(error.message, "error");
      }
    });

    document.getElementById("autoSalesImportOps")?.addEventListener("click", async () => {
      const since = await askImportSince();
      if (!since) return;
      const btn = document.getElementById("autoSalesImportOps");
      if (btn) btn.disabled = true;
      try {
        const result = await PanelAPI.post("/admin/auto-sales/team-ops/import", { since });
        const imported = Number(result.teamShare?.imported || 0);
        const updated = Number(result.teamShare?.updated || 0);
        const canceled = Number(result.teamShare?.canceled || 0);
        toast(
          `UProject: +${imported}${updated ? `, пересчитано ${updated}` : ""}${canceled ? `, отменено ${canceled}` : ""}`,
          "success"
        );
        PanelAPI.bust("/admin/auto-sales");
        autoSalesTeamOpsState.page = 0;
        await renderAutoSales();
      } catch (error) {
        toast(error.message, "error");
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    document.getElementById("autoSalesOpsSearch")?.addEventListener(
      "input",
      debounce(() => {
        autoSalesTeamOpsState.page = 0;
        reload().catch((error) => toast(error.message, "error"));
      }, 280)
    );

    document.getElementById("autoSalesRefresh")?.addEventListener("click", async () => {
      try {
        await reload();
        toast("Обновлено", "success");
      } catch (error) {
        toast(error.message, "error");
      }
    });
    document.getElementById("autoSalesSearch")?.addEventListener(
      "input",
      debounce(() => {
        autoSalesListState.page = 0;
        reload().catch((error) => toast(error.message, "error"));
      }, 280)
    );
    document.getElementById("autoSalesPagination")?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-page]");
      if (!btn || btn.disabled) return;
      autoSalesListState.page = Number(btn.dataset.page);
      reload().catch((error) => toast(error.message, "error"));
    });
    document.getElementById("autoSalesOpsPagination")?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-ops-page]");
      if (!btn || btn.disabled) return;
      autoSalesTeamOpsState.page = Number(btn.dataset.opsPage);
      reload().catch((error) => toast(error.message, "error"));
    });
    document.getElementById("autoSalesWorkerSearch")?.addEventListener(
      "input",
      debounce(() => reloadWorkers().catch((error) => toast(error.message, "error")), 280)
    );
    document.getElementById("autoSalesWorkerIssues")?.addEventListener("click", (event) => {
      autoSalesWorkersState.issuesOnly = !autoSalesWorkersState.issuesOnly;
      event.currentTarget.classList.toggle("is-active", autoSalesWorkersState.issuesOnly);
      reloadWorkers().catch((error) => toast(error.message, "error"));
    });
    document.getElementById("autoSalesWorkers")?.addEventListener("click", (event) => {
      const row = event.target.closest("[data-open-member]");
      if (!row) return;
      openMember(row.dataset.openMember);
    });
    document.getElementById("autoSalesSync")?.addEventListener("click", async () => {
      const btn = document.getElementById("autoSalesSync");
      if (btn) btn.disabled = true;
      try {
        const result = await PanelAPI.post("/admin/auto-sales/sync", {});
        if (result.skipped) {
          toast("Синхронизация уже выполняется", "success");
        } else {
          const teamImported = Number(result.teamShare?.imported || 0);
          const teamUpdated = Number(result.teamShare?.updated || 0);
          const teamCanceled = Number(result.teamShare?.canceled || 0);
          toast(
            `Подтянуто: +${Number(result.imported || 0)}, обновлено ${Number(result.updated || 0)} · UProject: +${teamImported}, пересчитано ${teamUpdated}, отменено ${teamCanceled} · на продаже ${Number(result.listed || 0) + Number(result.listing || 0)}, холд ${Number(result.sold_held || 0)}, снято ${Number(result.released || 0)}`,
            "success"
          );
        }
        PanelAPI.bust("/admin/auto-sales");
        await renderAutoSales();
      } catch (error) {
        toast(error.message, "error");
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    renderRows(currentRows);
    renderTeamOps(currentTeamOps);
    renderPagination();
    renderOpsPagination();
    const workersBody = document.getElementById("autoSalesWorkers");
    if (workersBody) {
      workersBody.innerHTML = `<tr><td colspan="8" class="as-wk-empty">Загружаем воркеров…</td></tr>`;
    }
    financePromise.then((finance) => {
      if (renderSeq !== autoSalesRenderSeq || workerLoadSeq !== autoSalesWorkersLoadSeq) return;
      currentWorkers = Array.isArray(finance?.overview?.workers) ? finance.overview.workers : [];
      renderWorkers(currentWorkers);
    });
  }

  async function renderBotLogs() {
    main.innerHTML = `
      <div class="greeting">
        <div>
          <h1 class="greeting-title">Логи бота</h1>
          <p class="greeting-sub">Последние 250 строк</p>
        </div>
        <button type="button" class="btn-primary" id="botLogsRefresh">Обновить</button>
      </div>
      <div class="panel-card">
        <div class="panel-card-body" style="padding-top:16px">
          <pre id="botLogsOut" style="margin:0;padding:12px;background:#202124;border-radius:10px;overflow:auto;font-size:12px;color:#b6b6b8;max-height:60vh;white-space:pre-wrap"></pre>
        </div>
      </div>
    `;
    async function load() {
      const text = await PanelAPI.get("/admin/bot-logs?lines=250");
      document.getElementById("botLogsOut").textContent = text;
    }
    document.getElementById("botLogsRefresh").addEventListener("click", load);
    await load();
  }

  function adminTemplatePreviewUrls(t) {
    const id = Number(t?.id);
    if (!Number.isFinite(id) || id < 1) return [];
    const urls = [];
    const push = (value) => {
      const url = String(value || "").trim();
      if (!url || urls.includes(url)) return;
      urls.push(url);
    };
    push(t?.preview);
    push(`/assets/template-previews/${id}.jpg`);
    push(`/app/assets/template-previews/${id}.jpg`);
    push(`/api/user/public/template-preview/${id}.jpg`);
    return urls;
  }

  function mountAdminTemplatePreview(previewCell, t) {
    const urls = adminTemplatePreviewUrls(t);
    if (!urls.length) {
      previewCell.innerHTML = `<div class="admin-template-preview-card"><div class="admin-template-preview-empty">—</div></div>`;
      return;
    }
    previewCell.innerHTML = `
      <div class="admin-template-preview-card">
        <img class="admin-template-preview-img" alt="" loading="lazy" decoding="async" />
      </div>`;
    const img = previewCell.querySelector(".admin-template-preview-img");
    let idx = 0;
    const tryNext = () => {
      if (!img || idx >= urls.length) {
        previewCell.innerHTML = `<div class="admin-template-preview-card"><div class="admin-template-preview-empty">—</div></div>`;
        return;
      }
      img.src = urls[idx];
      idx += 1;
    };
    img.addEventListener("error", tryNext);
    tryNext();
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function routeFromLocation() {
    const id = location.hash.replace(/^#/, "").replace(/^\/+/, "");
    if (id === "finance") return "autosales";
    const payoutMatch = /^payouts(?:\/([a-fA-F0-9]{24}))?$/.exec(id);
    if (payoutMatch) {
      payoutOpenId = payoutMatch[1] || "";
      return "payouts";
    }
    return AdminNav.byId.has(id) ? id : "overview";
  }

  let routeSyncQueued = false;
  function syncViewFromLocation() {
    if (routeSyncQueued) return;
    routeSyncQueued = true;
    queueMicrotask(() => {
      routeSyncQueued = false;
      const prevPayout = payoutOpenId;
      const next = routeFromLocation();
      if (next !== currentView || prevPayout !== payoutOpenId) {
        showView(next, { historyMode: "none" });
      }
    });
  }

  window.addEventListener("popstate", syncViewFromLocation);
  window.addEventListener("hashchange", syncViewFromLocation);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && currentView === "ads") {
      refreshAdsLive({ force: true });
    }
  });

  await showView(routeFromLocation(), { historyMode: "replace" });
})();
