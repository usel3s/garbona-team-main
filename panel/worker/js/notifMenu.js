window.WorkerNotifMenu = (function () {
  let open = false;
  let loading = false;

  function els() {
    return {
      wrap: document.getElementById("notifWrap"),
      bell: document.getElementById("notifBell"),
      menu: document.getElementById("notifMenu"),
      list: document.getElementById("notifMenuList"),
      badge: document.getElementById("notifBellBadge"),
      markAll: document.getElementById("notifMarkAllBtn"),
    };
  }

  function setOpen(next) {
    open = !!next;
    const { wrap, bell, menu } = els();
    if (!wrap || !bell || !menu) return;
    menu.hidden = !open;
    bell.setAttribute("aria-expanded", String(open));
    wrap.classList.toggle("is-open", open);
    document.body.classList.toggle("notif-popover-open", open);
    if (open) {
      if (typeof window.closeWorkerProfileMenu === "function") {
        window.closeWorkerProfileMenu();
      }
      if (typeof window.closeWorkerBalanceMenu === "function") {
        window.closeWorkerBalanceMenu();
      }
      refreshList({ force: true });
    } else {
      menu.querySelectorAll(".notif-menu-item").forEach((item) => item.blur());
    }
  }

  function toggle() {
    setOpen(!open);
  }

  function updateBadge(items) {
    const { badge, wrap } = els();
    const menuDot = document.getElementById("menuNotifDot");
    const count = WorkerNotif.unreadCount(items || []);
    const hasUnread = count > 0;
    const topbarDot = Boolean(wrap?.classList.contains("is-topbar"));

    if (badge) {
      badge.hidden = !hasUnread;
      // Topbar uses a status dot; the numeric count lives in the popover header.
      badge.textContent = topbarDot || !hasUnread ? "" : count > 99 ? "99+" : String(count);
      badge.setAttribute("aria-hidden", hasUnread ? "false" : "true");
      badge.classList.toggle("is-dot", topbarDot);
    }
    if (wrap) wrap.classList.toggle("has-unread", hasUnread);
    if (menuDot) menuDot.hidden = !hasUnread;
  }

  function severityClass(item) {
    if (item.severity === "danger") return "is-danger";
    if (item.severity === "warn") return "is-warn";
    if (item.severity === "info") return "is-info";
    return "";
  }

  function severityIcon(item) {
    const severity = String(item?.severity || "info");
    if (severity === "danger") {
      return '<svg viewBox="0 0 24 24" fill="none"><path d="M12 4 21 20H3L12 4Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 9v5M12 17h.01" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
    }
    if (severity === "warn") {
      return '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.5"/><path d="M12 8v5M12 16h.01" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.5"/><path d="M12 11v5M12 8h.01" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
  }

  function updateMenuMeta(items, { isLoading = false } = {}) {
    const { count, markAll } = {
      count: document.getElementById("notifMenuCount"),
      markAll: document.getElementById("notifMarkAllBtn"),
    };
    const unread = WorkerNotif.unreadCount(items || []);
    if (count) {
      count.hidden = !(items || []).length;
      count.textContent = (items || []).length ? String((items || []).length) : "";
    }
    if (markAll) markAll.disabled = isLoading || unread === 0;
  }

  function renderLoading() {
    const { list } = els();
    if (!list) return;
    list.setAttribute("aria-busy", "true");
    list.innerHTML = `
      <div class="notif-menu-loading" aria-label="${WorkerFormat.escapeHtml(
        WorkerI18n.t("common.loading")
      )}">
        ${Array.from({ length: 3 }, () => '<div class="notif-menu-skeleton"></div>').join("")}
      </div>`;
    updateMenuMeta([], { isLoading: true });
  }

  function renderEmpty() {
    const { list } = els();
    if (!list) return;
    list.innerHTML = `
      <div class="notif-menu-state">
        <span class="notif-menu-state-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><path d="M12 4.5a5 5 0 0 1 5 5v2.2c0 .8.3 1.6.8 2.2l.7.8H5.5l.7-.8c.5-.6.8-1.4.8-2.2V9.5a5 5 0 0 1 5-5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 18.2a2.2 2.2 0 0 0 4 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </span>
        <strong>${WorkerFormat.escapeHtml(WorkerI18n.t("notif.empty"))}</strong>
        <span>${WorkerFormat.escapeHtml(WorkerI18n.t("notif.subtitle"))}</span>
      </div>`;
    updateMenuMeta([]);
  }

  function renderError(error) {
    const { list } = els();
    if (!list) return;
    const message =
      (window.WorkerToast && WorkerToast.friendlyError(error)) ||
      error?.message ||
      WorkerI18n.t("common.error");
    list.innerHTML = `
      <div class="notif-menu-state is-error" role="alert">
        <span class="notif-menu-state-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.5"/><path d="M12 8v5M12 16h.01" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
        </span>
        <strong>${WorkerFormat.escapeHtml(WorkerI18n.t("common.error"))}</strong>
        <span>${WorkerFormat.escapeHtml(message)}</span>
        <button type="button" class="btn btn-ghost notif-menu-retry">${WorkerFormat.escapeHtml(
          WorkerI18n.t("common.retry")
        )}</button>
      </div>`;
    list.querySelector(".notif-menu-retry")?.addEventListener("click", () =>
      refreshList({ force: true })
    );
    updateMenuMeta([]);
  }

  function openExternalUrl(url) {
    const href = String(url || "").trim();
    if (!href) return;
    const tg = window.Telegram?.WebApp;
    if (tg?.openLink) {
      tg.openLink(href);
      return;
    }
    window.open(href, "_blank", "noopener,noreferrer");
  }

  function navigateNotifItem(btn) {
    const linkType = String(btn.dataset.linkType || "").trim();
    if (linkType === "view" && btn.dataset.linkView) {
      setOpen(false);
      document.querySelector(`.nav-item[data-view="${btn.dataset.linkView}"]`)?.click();
      return;
    }
    if (linkType === "url" && btn.dataset.linkUrl) {
      setOpen(false);
      openExternalUrl(btn.dataset.linkUrl);
      return;
    }
    if (btn.dataset.domainId) {
      setOpen(false);
      if (WorkerViews.sitesState) {
        WorkerViews.sitesState.selectedId = Number(btn.dataset.domainId);
      }
      document.querySelector('.nav-item[data-view="sites"]')?.click();
    }
  }

  function renderItems(items) {
    const { list } = els();
    if (!list) return;
    const orderedItems = WorkerNotif.sortNewestFirst(items || []);
    list.setAttribute("aria-busy", "false");

    if (!orderedItems.length) {
      renderEmpty();
      return;
    }

    updateMenuMeta(orderedItems);
    list.innerHTML = orderedItems
      .map((item) => {
        const sev = severityClass(item);
        const msgHtml = item.messageHtml
          ? `<span class="notif-menu-msg notif-menu-msg-html">${item.messageHtml}</span>`
          : `<span class="notif-menu-msg">${WorkerFormat.escapeHtml(item.message || "")}</span>`;
        const linkType = item.linkType || (item.domainId ? "domain" : "none");
        const actionable = linkType !== "none";
        return `
          <button type="button" class="notif-menu-item ${sev}${item.read ? " is-read" : " is-unread"}${actionable ? " is-actionable" : ""}" data-notif-id="${WorkerFormat.escapeHtml(String(item.id))}" data-link-type="${WorkerFormat.escapeHtml(linkType)}" data-link-view="${WorkerFormat.escapeHtml(String(item.linkView || ""))}" data-link-url="${WorkerFormat.escapeHtml(String(item.linkUrl || ""))}" data-domain-id="${WorkerFormat.escapeHtml(String(item.domainId || ""))}">
            <span class="notif-menu-accent" aria-hidden="true"></span>
            <span class="notif-menu-icon" aria-hidden="true">${severityIcon(item)}</span>
            <span class="notif-menu-body">
              <span class="notif-menu-item-head">
                <span class="notif-menu-item-title">
                  <span class="notif-menu-unread-dot" aria-hidden="true"></span>
                  ${WorkerFormat.escapeHtml(item.title || "")}
                </span>
                <time class="notif-menu-time" datetime="${WorkerFormat.escapeHtml(
                  String(item.createdAt || "")
                )}">${WorkerFormat.escapeHtml(WorkerFormat.shortDayTime(item.createdAt))}</time>
              </span>
              ${msgHtml}
            </span>
            ${
              actionable
                ? '<svg class="notif-menu-chevron" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 6 6 6-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
                : ""
            }
          </button>`;
      })
      .join("");

    list.querySelectorAll(".notif-menu-item").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        if (e.target.closest("a")) return;
        const alertId = btn.dataset.notifId;
        btn.classList.add("is-read");
        btn.classList.remove("is-unread");
        try {
          const itemsAfter = await WorkerNotif.markRead(alertId);
          if (itemsAfter) updateBadge(itemsAfter);
          else refreshBadgeOnly();
        } catch (error) {
          if (window.WorkerToast) WorkerToast.error(error);
          btn.classList.remove("is-read");
          btn.classList.add("is-unread");
          return;
        }
        navigateNotifItem(btn);
      });
    });
  }

  async function refreshBadgeOnly() {
    try {
      const items = await WorkerNotif.fetchAlerts();
      updateBadge(items);
    } catch (_) {
      updateBadge([]);
    }
  }

  async function refreshList({ force = false } = {}) {
    const { list } = els();
    if (!list || loading) return;
    loading = true;
    renderLoading();
    try {
      const items = await WorkerNotif.fetchAlerts({ force });
      updateBadge(items);
      renderItems(items);
    } catch (error) {
      if (window.WorkerToast) WorkerToast.error(error);
      list.setAttribute("aria-busy", "false");
      renderError(error);
    } finally {
      loading = false;
    }
  }

  function bind() {
    const { bell, markAll, menu, wrap } = els();
    if (!bell || !menu || !wrap) return;

    bell.addEventListener("click", (e) => {
      e.stopPropagation();
      toggle();
    });

    markAll?.addEventListener("click", async (e) => {
      e.stopPropagation();
      markAll.disabled = true;
      try {
        const items = await WorkerNotif.fetchAlerts({ force: true });
        const unreadIds = items.filter((item) => !item.read).map((item) => item.id);
        const updated = await WorkerNotif.markAllRead(unreadIds);
        const next = updated || items.map((i) => ({ ...i, read: true }));
        updateBadge(next);
        renderItems(next);
        if (window.WorkerToast) WorkerToast.success(WorkerI18n.t("notif.marked"));
      } catch (error) {
        if (window.WorkerToast) WorkerToast.error(error);
      } finally {
        const remaining = document.querySelectorAll(".notif-menu-item.is-unread").length;
        markAll.disabled = remaining === 0;
      }
    });

    document.addEventListener("click", (e) => {
      if (!open) return;
      if (wrap.contains(e.target)) return;
      setOpen(false);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && open) setOpen(false);
    });
  }

  return {
    bind,
    setOpen,
    refreshList,
    refreshBadge: refreshBadgeOnly,
    updateBadge,
  };
})();
