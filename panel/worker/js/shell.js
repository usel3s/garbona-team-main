(async function () {
  WorkerPrefs.init();

  function syncTelegramViewport() {
    const root = document.documentElement;
    const tg = WorkerAuth.getTelegramWebApp?.();
    if (!tg) {
      root.style.setProperty("--tg-viewport-stable-height", `${window.innerHeight}px`);
      return;
    }
    try {
      tg.ready?.();
      tg.expand?.();
      const h = Number(tg.viewportStableHeight || tg.viewportHeight || window.innerHeight) || window.innerHeight;
      root.style.setProperty("--tg-viewport-stable-height", `${h}px`);
      const top = Number(tg.safeAreaInset?.top || tg.contentSafeAreaInset?.top || 0) || 0;
      const bottom = Number(tg.safeAreaInset?.bottom || tg.contentSafeAreaInset?.bottom || 0) || 0;
      root.style.setProperty("--tg-safe-top", `${top}px`);
      root.style.setProperty("--tg-safe-bottom", `${bottom}px`);
    } catch (_) {
      root.style.setProperty("--tg-viewport-stable-height", `${window.innerHeight}px`);
    }
  }

  syncTelegramViewport();
  window.addEventListener("resize", syncTelegramViewport);
  try {
    WorkerAuth.getTelegramWebApp?.()?.onEvent?.("viewportChanged", syncTelegramViewport);
  } catch (_) {}

  const user = await WorkerAuth.requireAuth();
  if (!user) return;

  let panelConfig = {};
  try {
    panelConfig = await WorkerAuth.getConfig();
    if (panelConfig.usdRubRate) WorkerPrefs.setRate(panelConfig.usdRubRate);
  } catch (_) {}

  const main = document.getElementById("main");
  const nav = document.getElementById("nav");
  const mobileNav = document.getElementById("workerMobileNav");
  const mobileMore = document.getElementById("workerMobileMore");
  const mobileMoreSheet = document.getElementById("workerMobileMoreSheet");
  const mobileNotifSlot = document.getElementById("workerMobileNotifSlot");
  const notifWrap = document.getElementById("notifWrap");
  const sidebarFooter = document.querySelector(".sidebar-footer");
  const sidebarLogoutBtn = document.getElementById("sidebarLogoutBtn");
  const topbarNotifSlot = document.getElementById("topbarNotifSlot");
  const topbarBalance = document.getElementById("topbarBalance");
  const topbarBalanceValue = document.getElementById("topbarBalanceValue");
  const topbarBalanceWrap = document.getElementById("topbarBalanceWrap");
  const topbarBalanceMenu = document.getElementById("topbarBalanceMenu");
  const topbarBalanceTip = document.getElementById("topbarBalanceTip");
  const topbarAvailableValue = document.getElementById("topbarAvailableValue");
  const topbarFrozenValue = document.getElementById("topbarFrozenValue");
  const topbarTotalValue = document.getElementById("topbarTotalValue");
  const topbarWithdrawBtn = document.getElementById("topbarWithdrawBtn");
  const topbarUserName = document.getElementById("topbarUserName");
  const topbarAvatar = document.getElementById("topbarAvatar");
  let balanceMenuOpen = false;
  let branchMembership = "none";
  const mobileQuery = GarbonaSidebar.mobileQuery();
  const BRAND_ICON_URL = WorkerFormat.logoUrl();

  function resolveView(viewId) {
    if (viewId === "dashboard") {
      return window.WorkerDashboard?.mount || WorkerViews.dashboard;
    }
    if (viewId === "sites") {
      return window.WorkerSites?.mount || WorkerViews.sites;
    }
    return WorkerViews[viewId];
  }

  function hasView(viewId) {
    return typeof resolveView(viewId) === "function";
  }

  const VIEW_IDS = ["dashboard", "sites", "analytics", "branch", "top", "settings", "wallet", "support"];

  // Debug: snapshot available view keys and types to help diagnose missing views
  try {
    const _dbg = {};
    VIEW_IDS.forEach((k) => {
      _dbg[k] = typeof resolveView(k);
    });
    if (typeof console !== "undefined" && console.debug) {
      console.debug("WorkerViews snapshot:", _dbg, "window.WorkerViews keys:", Object.keys(window.WorkerViews || {}));
    }
    window.__WorkerViewsSnapshot = _dbg;
  } catch (e) {
    /* ignore */
  }

  let currentView = "dashboard";
  let viewEpoch = 0;

  function stopViewPolls(viewId) {
    if (viewId === "analytics" && WorkerViews.analyticsState?._pollTimer) {
      clearInterval(WorkerViews.analyticsState._pollTimer);
      WorkerViews.analyticsState._pollTimer = null;
    }
    if (viewId === "sites" && WorkerViews.sitesState?._pollTimer) {
      clearInterval(WorkerViews.sitesState._pollTimer);
      WorkerViews.sitesState._pollTimer = null;
    }
  }

  const SETTINGS_TABS = new Set([
    "profile",
    "password",
    "security",
    "appearance",
    "interface",
    "payouts",
  ]);

  const BRANCH_SECTIONS = new Set([
    "catalog",
    "create",
    "overview",
    "members",
    "settings",
    "manuals",
  ]);

  function updateDocumentTitle(viewId) {
    const section =
      viewId === "branch" ? String(WorkerViews.branchSection || "") : "";
    const key = WorkerNav.titleKey(viewId, section);
    const page = WorkerI18n.t(key);
    const brand = WorkerI18n.t("brand.name");
    document.title = `${page} - ${brand}`;
  }

  function displayName() {
    return user.username || user.firstName || user.telegramId;
  }

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
        return;
      }
      img.onerror = loadNext;
      img.src = candidates[nextIndex];
      nextIndex += 1;
    };
    img.referrerPolicy = "no-referrer";
    loadNext();
  }

  function formatUsdLabel(usd) {
    const { currency } = WorkerPrefs.get();
    if (currency === "RUB") {
      const value = WorkerFormat.convertUsd(usd);
      const locale = WorkerPrefs.get().lang === "ru" ? "ru-RU" : "en-US";
      return `${value.toLocaleString(locale)} ₽`;
    }
    return `${Number(usd || 0).toFixed(2)} $`;
  }

  function statsLine() {
    return formatUsdLabel(Number(user.walletUsd || 0));
  }

  function setBalanceMenuOpen(open) {
    balanceMenuOpen = !!open;
    if (topbarBalanceMenu) topbarBalanceMenu.hidden = !balanceMenuOpen;
    topbarBalance?.setAttribute("aria-expanded", String(balanceMenuOpen));
    topbarBalanceWrap?.classList.toggle("is-open", balanceMenuOpen);
    if (balanceMenuOpen) {
      if (window.WorkerNotifMenu) WorkerNotifMenu.setOpen(false);
    }
  }

  window.closeWorkerBalanceMenu = () => setBalanceMenuOpen(false);

  function updateUserHeader() {
    const name = displayName();
    const avatars = avatarUrls();
    const walletUsd = Number(user.walletUsd || 0);
    const frozenUsd = Math.max(0, Number(user.frozenSaleUsd || 0));
    const availableUsd = Math.max(0, walletUsd - frozenUsd);
    const balance = formatUsdLabel(walletUsd);

    if (topbarUserName) topbarUserName.textContent = name;
    if (topbarBalanceValue) {
      topbarBalanceValue.textContent = balance;
      topbarBalance?.classList.toggle("is-neg", walletUsd < 0);
    }
    if (topbarAvailableValue) topbarAvailableValue.textContent = formatUsdLabel(availableUsd);
    if (topbarFrozenValue) topbarFrozenValue.textContent = formatUsdLabel(frozenUsd);
    if (topbarTotalValue) topbarTotalValue.textContent = balance;
    if (topbarBalanceTip) {
      topbarBalanceTip.hidden = frozenUsd <= 0;
      topbarBalanceTip.textContent = WorkerI18n.t("wallet.frozenSummary", {
        amount: formatUsdLabel(frozenUsd),
      });
    }

    if (topbarAvatar) {
      loadAvatar(topbarAvatar, avatars);
    }
  }

  function renderNavigation() {
    const items = WorkerNav.buildItems(branchMembership);
    GarbonaSidebar.renderSidebarNav(nav, {
      groups: WorkerNav.GROUPS,
      items,
      resolveLabel: WorkerNav.label,
    });
    GarbonaSidebar.renderMobileBar(mobileNav, {
      items,
      resolveLabel: WorkerNav.label,
      more: {
        id: "workerMobileMoreBtn",
        controls: "workerMobileMore",
        label: WorkerI18n.t("nav.more"),
        icon: WorkerNav.MORE_ICON,
      },
    });
    GarbonaSidebar.renderMoreSheet(document.getElementById("workerMobileNavList"), {
      groups: WorkerNav.GROUPS,
      items,
      resolveLabel: WorkerNav.label,
    });
  }

  async function refreshBranchNav() {
    try {
      const me = await WorkerAPI.get("/branch/me", { force: true });
      const next = String(me?.membership || "none");
      branchMembership = next === "owner" || next === "member" ? next : "none";
    } catch (_) {
      branchMembership = "none";
    }
    renderNavigation();
    syncNav(currentView);
  }

  renderNavigation();

  const mobileMoreBtn = document.getElementById("workerMobileMoreBtn");

  const sidebarController = GarbonaSidebar.createController({
    sidebar: document.getElementById("sidebar"),
    rail: document.getElementById("sidebarRail"),
    toggleButton: document.getElementById("sidebarCollapse"),
    lockExpanded: true,
    isCollapsed: () => false,
    setCollapsed() {},
    labels: () => ({
      collapse: WorkerI18n.t("nav.collapse"),
      expand: WorkerI18n.t("nav.expand"),
    }),
    tooltipTargets: () => {
      const targets = Array.from(document.querySelectorAll(".nav-item")).map((element) => ({
        element,
        tip: element.querySelector("span")?.textContent?.trim() || "",
      }));
      if (sidebarLogoutBtn) {
        targets.push({
          element: sidebarLogoutBtn,
          tip: WorkerI18n.t("nav.logout"),
        });
      }
      const notifBell = document.getElementById("notifBell");
      if (notifBell) {
        const tip = WorkerI18n.t("nav.notifications");
        notifBell.dataset.tip = tip;
        notifBell.setAttribute("aria-label", tip);
        targets.push({ element: notifBell, tip });
      }
      return targets;
    },
  });

  const workspaceSwitcher = GarbonaSidebar.createWorkspaceSwitcher({
    mount: document.getElementById("workspaceSwitcher"),
    iconUrl: BRAND_ICON_URL,
    currentId: "worker",
    labels: () => ({
      switcher: WorkerI18n.t("nav.workspace"),
      development: WorkerI18n.t("nav.inDevelopment"),
    }),
  });
  workspaceSwitcher.setWorkspaces(WorkerAuth.session()?.workspaces || []);

  const moreSheet = GarbonaSidebar.createMobileSheet({
    root: mobileMore,
    sheet: mobileMoreSheet,
    trigger: mobileMoreBtn,
    onToggle: () => syncNav(currentView),
  });

  function syncNav(viewId) {
    GarbonaSidebar.syncActive(viewId, {
      primaryIds: WorkerNav.primaryIds,
      moreButton: mobileMoreBtn,
      section: viewId === "branch" ? String(WorkerViews.branchSection || "") : "",
    });
  }

  function syncMobileStructure() {
    if (!notifWrap || !mobileNotifSlot) return;
    if (mobileQuery.matches) {
      mobileNotifSlot.appendChild(notifWrap);
      notifWrap.classList.remove("is-topbar");
      return;
    }
    moreSheet.setOpen(false, { restoreFocus: false });
    if (topbarNotifSlot) {
      topbarNotifSlot.appendChild(notifWrap);
      notifWrap.classList.add("is-topbar");
      return;
    }
    if (sidebarFooter && sidebarLogoutBtn) {
      sidebarFooter.insertBefore(notifWrap, sidebarLogoutBtn);
      notifWrap.classList.remove("is-topbar");
    }
  }

  function bindHelpLink(id, url) {
    const el = document.getElementById(id);
    if (!el) return;
    const href = String(url || "").trim();
    if (!href) {
      el.classList.add("is-hidden");
      return;
    }
    el.href = href;
    el.classList.remove("is-hidden");
  }

  function setupHelpLinks() {
    bindHelpLink("workerMobileGettingStarted", "");
  }

  function openSettings(tab) {
    if (tab && SETTINGS_TABS.has(tab)) {
      WorkerViews.settingsTab = tab;
    }
    showView("settings", { historyMode: "push" });
  }

  async function logout() {
    moreSheet.setOpen(false, { restoreFocus: false });
    await WorkerAuth.logout();
    location.replace("/app/login");
  }

  function openSupport() {
    moreSheet.setOpen(false, { restoreFocus: false });
    const bot = String(panelConfig.botUsername || "").replace(/^@/, "").trim();
    const url =
      String(panelConfig.supportUrl || "").trim() ||
      (bot ? `https://t.me/${bot}?start=feedback` : "https://t.me/Garbonabot?start=feedback");
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function showView(id, { refresh = false, historyMode = "replace" } = {}) {
    const viewId = hasView(id) ? id : hasView("dashboard") ? "dashboard" : id;
    const previousView = currentView;
    const epoch = ++viewEpoch;
    if (previousView !== viewId) {
      stopViewPolls(previousView);
    }
    if (
      ["dashboard", "sites", "settings", "branch"].includes(previousView) &&
      previousView !== viewId
    ) {
      window.WorkerDashboard?.unmount?.();
      window.WorkerSites?.unmount?.();
    }
    currentView = viewId;

    if (viewId !== "sites" && WorkerViews.sitesState) {
      WorkerViews.sitesState.selectedId = null;
    }

    syncNav(viewId);
    updateDocumentTitle(viewId);
    moreSheet.setOpen(false, { restoreFocus: false });

    const hash =
      viewId === "settings" && WorkerViews.settingsTab
        ? `#settings/${WorkerViews.settingsTab}`
        : viewId === "branch" &&
            WorkerViews.branchSection &&
            WorkerViews.branchSection !== "catalog"
          ? `#branch/${WorkerViews.branchSection}`
          : `#${viewId}`;
    if (historyMode === "push" && location.hash !== hash) {
      history.pushState({ view: viewId }, "", hash);
    } else if (historyMode === "replace" && location.hash !== hash) {
      history.replaceState({ view: viewId }, "", hash);
    }

    // Resolve at call time so React bundles can register after shell boot.
    const renderView = resolveView(viewId);
    if (typeof renderView !== "function") {
      const error = new Error(`View "${viewId}" is not available`);
      console.error(error, { viewId, value: renderView });
      if (viewId === "dashboard") window.WorkerDashboard?.unmount?.();
      if (viewId === "sites") window.WorkerSites?.unmount?.();
      if (window.WorkerToast) WorkerToast.error(error);
      if (epoch !== viewEpoch || currentView !== viewId) return;
      main.innerHTML = `
        <div class="section">
          <div class="empty">
            <div>${WorkerFormat.escapeHtml(WorkerI18n.t("common.error"))}</div>
            <div class="muted">${WorkerFormat.escapeHtml(
              (window.WorkerToast && WorkerToast.friendlyError(error)) || error.message || String(error)
            )}</div>
          </div>
        </div>`;
      return;
    }

    try {
      await renderView({ main, user, refresh });
      if (epoch !== viewEpoch || currentView !== viewId) return;
    } catch (error) {
      if (epoch !== viewEpoch || currentView !== viewId) return;
      if (viewId === "dashboard") window.WorkerDashboard?.unmount?.();
      if (viewId === "sites") window.WorkerSites?.unmount?.();
      if (window.WorkerToast) WorkerToast.error(error);
      main.innerHTML = `
        <div class="section">
          <div class="empty">
            <div>${WorkerFormat.escapeHtml(WorkerI18n.t("common.error"))}</div>
            <div class="muted">${WorkerFormat.escapeHtml(
              (window.WorkerToast && WorkerToast.friendlyError(error)) ||
                error.message ||
                String(error)
            )}</div>
          </div>
        </div>`;
    }
  }

  async function refreshNotifBadge(preloaded) {
    if (window.WorkerNotifMenu) {
      if (preloaded) WorkerNotifMenu.updateBadge(preloaded);
      else await WorkerNotifMenu.refreshBadge();
      return;
    }
  }
  window.refreshNotifBadge = refreshNotifBadge;

  function syncNavTips() {
    sidebarController.sync();
  }

  function applyNavigationLabels() {
    const items = WorkerNav.buildItems(branchMembership);
    GarbonaSidebar.renderSidebarNav(nav, {
      groups: WorkerNav.GROUPS,
      items,
      resolveLabel: WorkerNav.label,
    });
    GarbonaSidebar.renderMoreSheet(document.getElementById("workerMobileNavList"), {
      groups: WorkerNav.GROUPS,
      items,
      resolveLabel: WorkerNav.label,
    });
    items
      .flatMap((item) =>
        Array.isArray(item.children) && item.children.length ? item.children : [item],
      )
      .filter((item) => item.mobilePrimary)
      .forEach((item) => {
        const labelEl = mobileNav?.querySelector(`[data-view="${item.id}"] span`);
        if (labelEl) labelEl.textContent = WorkerNav.label(item);
      });
    const moreLabel = mobileMoreBtn?.querySelector("span");
    if (moreLabel) moreLabel.textContent = WorkerI18n.t("nav.more");
    syncNav(currentView);
  }

  function applyShellI18n() {
    WorkerI18n.apply(document);
    applyNavigationLabels();
    updateUserHeader();
    updateDocumentTitle(currentView);
    syncNavTips();
    mobileNav?.setAttribute("aria-label", WorkerI18n.t("nav.primaryMenu"));
    mobileMoreSheet?.setAttribute("aria-label", WorkerI18n.t("nav.moreMenu"));
    document
      .getElementById("workerMobileMoreBackdrop")
      ?.setAttribute("aria-label", WorkerI18n.t("nav.closeMore"));
    document
      .getElementById("workerMobileMoreClose")
      ?.setAttribute("aria-label", WorkerI18n.t("nav.closeMore"));
    workspaceSwitcher.render?.();
  }

  WorkerPrefs.onChange((_prefs, meta = {}) => {
    const keys = meta.keys || [];
    if (keys.length === 1 && keys[0] === "sidebarCollapsed") {
      sidebarController.sync();
      return;
    }
    applyShellI18n();
    if (currentView === "settings") {
      showView("settings", { refresh: true });
      return;
    }
    showView(currentView, { refresh: false });
  });

  sidebarLogoutBtn?.addEventListener("click", logout);

  topbarBalance?.addEventListener("click", (e) => {
    e.stopPropagation();
    setBalanceMenuOpen(!balanceMenuOpen);
  });

  topbarWithdrawBtn?.addEventListener("click", () => {
    setBalanceMenuOpen(false);
    showView("wallet", { historyMode: "push" });
  });

  document.addEventListener("click", (e) => {
    if (!balanceMenuOpen) return;
    if (topbarBalanceWrap?.contains(e.target)) return;
    setBalanceMenuOpen(false);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && balanceMenuOpen) setBalanceMenuOpen(false);
  });

  function navigateFromButton(btn, historyMode = "push") {
    if (!btn || btn.disabled) return;
    const viewId = btn.dataset.view;
    if (!viewId) return;
    if (viewId === "branch") {
      const section = String(btn.dataset.branchSection || "").trim();
      WorkerViews.branchSection = BRANCH_SECTIONS.has(section)
        ? section
        : branchMembership === "none"
          ? "catalog"
          : "overview";
    }
    showView(viewId, { historyMode });
  }

  nav?.addEventListener("click", (e) => {
    const toggle = e.target.closest("[data-nav-toggle]");
    if (toggle) {
      e.preventDefault();
      const tree = toggle.closest(".nav-tree");
      if (!tree) return;
      tree.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(tree.classList.contains("is-open")));
      return;
    }
    const btn = e.target.closest("[data-view]");
    if (!btn || !nav.contains(btn)) return;
    navigateFromButton(btn, "push");
  });

  mobileNav?.addEventListener("click", (e) => {
    const btn = e.target.closest(".mobile-nav-item");
    if (!btn || btn.disabled) return;
    if (btn.dataset.menu === "more") {
      moreSheet.setOpen(!moreSheet.isOpen());
      return;
    }
    navigateFromButton(btn, "push");
  });

  mobileMoreSheet?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-view]");
    if (!btn || btn.disabled) return;
    navigateFromButton(btn, "push");
  });

  document
    .getElementById("workerMobileMoreBackdrop")
    ?.addEventListener("click", () => moreSheet.setOpen(false));
  document
    .getElementById("workerMobileMoreClose")
    ?.addEventListener("click", () => moreSheet.setOpen(false));
  document.getElementById("workerMobileSupportBtn")?.addEventListener("click", openSupport);
  document.getElementById("workerMobileLogoutBtn")?.addEventListener("click", logout);
  document.getElementById("workerMobileGettingStarted")?.addEventListener("click", () => {
    moreSheet.setOpen(false, { restoreFocus: false });
  });

  if (typeof mobileQuery.addEventListener === "function") {
    mobileQuery.addEventListener("change", syncMobileStructure);
  } else {
    mobileQuery.addListener(syncMobileStructure);
  }

  setupHelpLinks();
  syncMobileStructure();
  applyShellI18n();

  if (window.WorkerNotif) {
    WorkerNotif.setUserContext(user);
  }
  if (window.WorkerNotifMenu) {
    WorkerNotifMenu.bind();
    WorkerNotifMenu.refreshBadge();
  }

  function routeFromLocation() {
    const hashRaw = (location.hash || "").replace(/^#/, "");
    const [viewId, sub] = hashRaw.split("/");
    if (viewId === "settings" && SETTINGS_TABS.has(sub)) {
      WorkerViews.settingsTab = sub;
    }
    if (viewId === "branch") {
      if (BRANCH_SECTIONS.has(sub)) {
        WorkerViews.branchSection = sub;
      } else if (branchMembership === "owner" || branchMembership === "member") {
        WorkerViews.branchSection = "overview";
      } else {
        WorkerViews.branchSection = "catalog";
      }
    }
    return viewId === "notifications" || viewId === "logs" ? "dashboard" : viewId || "dashboard";
  }

  let routeSyncQueued = false;
  function syncViewFromLocation() {
    if (routeSyncQueued) return;
    routeSyncQueued = true;
    queueMicrotask(() => {
      routeSyncQueued = false;
      showView(routeFromLocation(), { historyMode: "none" });
    });
  }

  window.addEventListener("popstate", syncViewFromLocation);
  window.addEventListener("hashchange", syncViewFromLocation);
  window.WorkerShell = {
    navigate(viewId, options = {}) {
      return showView(viewId, {
        ...options,
        historyMode: options.historyMode || "push",
      });
    },
    currentView() {
      return currentView;
    },
    refreshBranchNav,
    branchMembership() {
      return branchMembership;
    },
  };

  updateUserHeader();
  await refreshBranchNav();
  await showView(routeFromLocation(), { historyMode: "replace" });
})();
