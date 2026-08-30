/*
 * Shared sidebar behaviour for the admin and worker panels.
 *
 * Ports the shadcn/ui Sidebar architecture (provider state, rail, menu buttons,
 * groups, badges, mobile sheet) onto the panels' vanilla stack. Every panel
 * supplies its own navigation config, label resolver and persistence.
 */
window.GarbonaSidebar = (function () {
  const MOBILE_QUERY = "(max-width: 900px)";
  const TOGGLE_KEY = "b";

  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function mobileQuery() {
    return window.matchMedia(MOBILE_QUERY);
  }

  function onMediaChange(query, handler) {
    if (typeof query.addEventListener === "function") query.addEventListener("change", handler);
    else query.addListener(handler);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => {
      switch (char) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case '"':
          return "&quot;";
        default:
          return "&#39;";
      }
    });
  }

  function isTextEntry(node) {
    if (!(node instanceof HTMLElement)) return false;
    if (node.isContentEditable) return true;
    const tag = node.tagName;
    if (tag === "TEXTAREA" || tag === "SELECT") return true;
    if (tag !== "INPUT") return false;
    return !["button", "checkbox", "radio", "submit", "reset", "range", "color", "file"].includes(
      String(node.type || "text").toLowerCase()
    );
  }

  function visibleFocusable(root) {
    if (!root) return [];
    return Array.from(root.querySelectorAll(FOCUSABLE)).filter(
      (el) => !el.hidden && !el.closest("[hidden]") && el.getClientRects().length
    );
  }

  function trapTab(event, root) {
    if (event.key !== "Tab") return;
    const focusable = visibleFocusable(root);
    if (!focusable.length) {
      event.preventDefault();
      root.focus?.();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /* ——— Provider state ——— */

  /**
   * Owns the expanded/collapsed state on <html data-sidebar>, the rail and the
   * Ctrl/Cmd+B shortcut. Persistence stays with the caller.
   */
  function createController(options) {
    const {
      sidebar,
      rail,
      toggleButton,
      isCollapsed,
      setCollapsed,
      labels,
      tooltipTargets = () => [],
      lockExpanded,
    } = options;
    const media = mobileQuery();

    function currentLabels() {
      return typeof labels === "function" ? labels() : labels || {};
    }

    function sync() {
      const collapsed = lockExpanded ? false : !!isCollapsed();
      const text = currentLabels();
      document.documentElement.setAttribute("data-sidebar", collapsed ? "collapsed" : "expanded");

      const label = collapsed ? text.expand : text.collapse;
      if (toggleButton) {
        toggleButton.setAttribute("aria-pressed", String(collapsed));
        toggleButton.setAttribute("aria-label", label);
        toggleButton.dataset.tip = label;
      }
      if (rail) rail.setAttribute("aria-label", label);

      tooltipTargets().forEach(({ element, tip }) => {
        if (element && tip) element.dataset.tip = tip;
      });
    }

    function toggle() {
      if (lockExpanded || media.matches) return;
      setCollapsed(!isCollapsed());
      sync();
    }

    toggleButton?.addEventListener("click", toggle);
    rail?.addEventListener("click", toggle);

    document.addEventListener("keydown", (event) => {
      if (event.key?.toLowerCase() !== TOGGLE_KEY) return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (isTextEntry(document.activeElement)) return;
      event.preventDefault();
      toggle();
    });

    onMediaChange(media, sync);
    sync();

    return { sync, toggle, sidebar, media };
  }

  /* ——— Navigation rendering ——— */

  function labelOf(resolve, item, variant) {
    return resolve(item, variant) || item.id;
  }

  function navItemHtml(item, resolve) {
    if (Array.isArray(item.children) && item.children.length) {
      const label = labelOf(resolve, item, "full");
      const kids = item.children.map((child) => navItemHtml(child, resolve)).join("");
      const accent = item.accent ? " is-accent" : "";
      return `<div class="nav-tree${item.defaultOpen ? " is-open" : ""}${accent}">
        <button type="button" class="nav-item nav-item--parent${accent}" data-nav-toggle="true" data-tip="${escapeHtml(
          label
        )}" aria-expanded="${item.defaultOpen ? "true" : "false"}">
          ${item.icon}<span class="nav-item-label">${escapeHtml(label)}</span>
          <span class="nav-item-chevron" aria-hidden="true"></span>
        </button>
        <div class="nav-children">
          <div class="nav-children__inner">
            <div class="nav-children__rule" aria-hidden="true"></div>
            ${kids}
          </div>
        </div>
      </div>`;
    }

    const label = labelOf(resolve, item, "full");
    const badge = item.badgeId
      ? `<span class="nav-badge" id="${escapeHtml(item.badgeId)}" hidden></span>`
      : "";
    const sectionAttr = item.section
      ? ` data-branch-section="${escapeHtml(item.section)}"`
      : "";
    const childClass = item.section ? " nav-item--child" : "";
    const inner = `${item.icon}<span class="nav-item-label">${escapeHtml(label)}</span>${badge}`;
    if (item.href) {
      return `<a class="nav-item${childClass}" href="${escapeHtml(item.href)}" target="_blank" rel="noopener noreferrer" data-tip="${escapeHtml(
        label
      )}">${inner}</a>`;
    }
    return `<button type="button" class="nav-item${childClass}" data-view="${escapeHtml(item.id)}"${sectionAttr} data-tip="${escapeHtml(
      label
    )}">${inner}</button>`;
  }

  /** Renders the desktop sidebar navigation from the single nav config. */
  function renderSidebarNav(container, { groups, items, resolveLabel }) {
    if (!container) return;
    container.innerHTML = groups
      .map((group) => {
        const groupItems = items.filter((item) => item.group === group.id && !item.hideInSidebar);
        if (!groupItems.length) return "";
        const label = group.id
          ? `<div class="section-label">${escapeHtml(labelOf(resolveLabel, group, "group"))}</div>`
          : "";
        return `<div class="nav-group">${label}${groupItems
          .map((item) => navItemHtml(item, resolveLabel))
          .join("")}</div>`;
      })
      .join("");
  }

  function flattenItems(items) {
    const out = [];
    (items || []).forEach((item) => {
      if (Array.isArray(item.children) && item.children.length) {
        item.children.forEach((child) => out.push(child));
        return;
      }
      out.push(item);
    });
    return out;
  }

  /** Renders the mobile bottom bar: primary destinations plus the "more" trigger. */
  function renderMobileBar(container, { items, resolveLabel, more }) {
    if (!container) return;
    const primary = flattenItems(items)
      .filter((item) => item.mobilePrimary)
      .map(
        (item) =>
          `<button type="button" class="mobile-nav-item" data-view="${escapeHtml(item.id)}">${
            item.mobileIcon || item.icon
          }<span>${escapeHtml(labelOf(resolveLabel, item, "mobile"))}</span></button>`
      )
      .join("");
    const dot = more.dotId
      ? `<span class="mobile-nav-dot" id="${escapeHtml(more.dotId)}" hidden aria-hidden="true"></span>`
      : "";
    container.innerHTML = `${primary}<button type="button" class="mobile-nav-item" data-menu="more" id="${escapeHtml(
      more.id
    )}" aria-haspopup="dialog" aria-expanded="false" aria-controls="${escapeHtml(more.controls)}">${
      more.icon
    }<span>${escapeHtml(more.label)}</span>${dot}</button>`;
  }

  /** Renders the "more" sheet with every destination missing from the bottom bar. */
  function renderMoreSheet(container, { groups, items, resolveLabel }) {
    if (!container) return;
    const flat = flattenItems(items);
    container.innerHTML = groups
      .map((group) => {
        const groupItems = flat.filter(
          (item) => item.group === group.id && !item.mobilePrimary && !item.hideInMore
        );
        if (!groupItems.length) return "";
        const label = group.id
          ? `<div class="mobile-more-label">${escapeHtml(labelOf(resolveLabel, group, "group"))}</div>`
          : "";
        const list = groupItems
          .map((item) => {
            const sectionAttr = item.section
              ? ` data-branch-section="${escapeHtml(item.section)}"`
              : "";
            return `<button type="button" class="mobile-more-item" data-view="${escapeHtml(item.id)}"${sectionAttr}>${
              item.icon
            }<span>${escapeHtml(
              labelOf(resolveLabel, item, "full")
            )}</span><span class="mobile-more-chevron" aria-hidden="true"></span></button>`;
          })
          .join("");
        return `<div class="mobile-more-group">${label}<div class="mobile-more-list">${list}</div></div>`;
      })
      .join("");
  }

  /**
   * Marks the active destination everywhere it is rendered. `data-active` drives
   * the styling, `aria-current` the assistive-technology announcement.
   */
  function syncActive(viewId, { primaryIds, moreButton, section = "" } = {}) {
    const activeSection = String(section || "");

    function isActiveButton(el) {
      if (el.dataset.view !== viewId) return false;
      const itemSection = String(el.dataset.branchSection || "");
      if (!itemSection) {
        // Flat branch item: active for catalog-only (or any branch when no children).
        if (viewId === "branch" && activeSection && activeSection !== "catalog") {
          return false;
        }
        return true;
      }
      if (!activeSection) return itemSection === "catalog" || itemSection === "overview";
      return itemSection === activeSection;
    }

    document.querySelectorAll(".nav-item[data-view], .mobile-more-item[data-view]").forEach((el) => {
      const active = isActiveButton(el);
      el.dataset.active = String(active);
      if (active) el.setAttribute("aria-current", "page");
      else el.removeAttribute("aria-current");
    });

    document.querySelectorAll(".nav-tree").forEach((tree) => {
      const childActive = Boolean(tree.querySelector('.nav-item[data-active="true"]'));
      if (childActive) tree.classList.add("is-open");
      const toggle = tree.querySelector("[data-nav-toggle]");
      if (toggle) {
        toggle.setAttribute("aria-expanded", String(tree.classList.contains("is-open")));
        toggle.classList.toggle("is-branch-open", childActive);
      }
    });

    document.querySelectorAll(".mobile-nav-item[data-view]").forEach((el) => {
      const active = el.dataset.view === viewId;
      el.dataset.active = String(active);
      if (active) el.setAttribute("aria-current", "page");
      else el.removeAttribute("aria-current");
    });

    if (!moreButton) return;
    const inMore = primaryIds ? !primaryIds.has(viewId) : false;
    moreButton.dataset.active = String(inMore);
    if (inMore) moreButton.setAttribute("aria-current", "page");
    else moreButton.removeAttribute("aria-current");
  }

  /* ——— Mobile sheet ——— */

  function createMobileSheet({ root, sheet, trigger, onToggle }) {
    let open = false;
    let returnFocus = null;
    const media = mobileQuery();

    function setOpen(next, { restoreFocus = true } = {}) {
      const wanted = !!next && media.matches;
      if (wanted === open) return;
      open = wanted;

      root.classList.toggle("is-open", open);
      root.setAttribute("aria-hidden", String(!open));
      trigger?.setAttribute("aria-expanded", String(open));
      if (open) document.documentElement.setAttribute("data-sidebar-mobile-open", "true");
      else document.documentElement.removeAttribute("data-sidebar-mobile-open");
      onToggle?.(open);

      if (open) {
        returnFocus = document.activeElement;
        requestAnimationFrame(() => (visibleFocusable(sheet)[0] || sheet).focus());
        return;
      }
      if (restoreFocus && returnFocus instanceof HTMLElement) {
        returnFocus.focus({ preventScroll: true });
      }
      returnFocus = null;
    }

    document.addEventListener("keydown", (event) => {
      if (!open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      trapTab(event, sheet);
    });

    onMediaChange(media, () => {
      if (!media.matches) setOpen(false, { restoreFocus: false });
    });

    return {
      setOpen,
      isOpen: () => open,
    };
  }

  /* ——— Roving focus for menus ——— */

  /**
   * Adds arrow-key roving focus, Escape-to-close and a focus trap to a
   * `role="menu"` popover. Disabled items are skipped.
   */
  function attachRovingMenu({ menu, trigger, isOpen, setOpen, itemSelector = '[role="menuitem"]' }) {
    function items() {
      return Array.from(menu.querySelectorAll(itemSelector)).filter(
        (el) => !el.disabled && el.getAttribute("aria-disabled") !== "true" && el.getClientRects().length
      );
    }

    function focusAt(index) {
      const list = items();
      if (!list.length) return;
      const next = (index + list.length) % list.length;
      list[next].focus();
    }

    function move(step) {
      const list = items();
      if (!list.length) return;
      const current = list.indexOf(document.activeElement);
      focusAt(current === -1 ? (step > 0 ? 0 : list.length - 1) : current + step);
    }

    menu.addEventListener("keydown", (event) => {
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          move(1);
          break;
        case "ArrowUp":
          event.preventDefault();
          move(-1);
          break;
        case "Home":
          event.preventDefault();
          focusAt(0);
          break;
        case "End":
          event.preventDefault();
          focusAt(items().length - 1);
          break;
        case "Escape":
          event.preventDefault();
          setOpen(false);
          trigger?.focus();
          break;
        case "Tab":
          trapTab(event, menu);
          break;
        default:
          break;
      }
    });

    trigger?.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      if (!isOpen()) setOpen(true);
      requestAnimationFrame(() => focusAt(event.key === "ArrowDown" ? 0 : items().length - 1));
    });

    return { focusFirst: () => focusAt(0), items };
  }

  /* ——— Workspace switcher ——— */

  function workspaceInitials(name) {
    return String(name || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0])
      .join("")
      .toUpperCase();
  }

  function shortWorkspaceName(name) {
    return String(name || "")
      .replace(/^Garbona\s+/i, "")
      .trim();
  }

  function optionHtml(workspace, currentId, developmentLabel) {
    const current = workspace.id === currentId;
    const disabled = workspace.status === "development";
    const label = shortWorkspaceName(workspace.name) || workspace.name;
    const trailing = disabled
      ? `<span class="workspace-option-tag">${escapeHtml(developmentLabel)}</span>`
      : "";
    return `<button
        type="button"
        role="menuitem"
        class="workspace-option${current ? " is-current" : ""}"
        data-workspace="${escapeHtml(workspace.id)}"
        ${current ? 'aria-current="true"' : ""}
        ${disabled ? 'disabled aria-disabled="true"' : ""}
      >
        <span class="workspace-option-mark" aria-hidden="true">${escapeHtml(
          workspaceInitials(label)
        )}</span>
        <span class="workspace-option-name">${escapeHtml(label)}</span>
        ${trailing}
      </button>`;
  }

  const SETTINGS_ICON =
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 15.1a3.1 3.1 0 1 0 0-6.2 3.1 3.1 0 0 0 0 6.2Z" stroke="currentColor" stroke-width="1.6"/><path d="M18.7 14.2c.1-.4.2-.8.2-1.2s-.1-.8-.2-1.2l1.8-1.4-1.7-3-2.1.8c-.6-.5-1.3-.8-2-1.1L14.3 4h-4.6l-.4 2.1c-.7.3-1.4.6-2 1.1l-2.1-.8-1.7 3 1.8 1.4c-.1.4-.2.8-.2 1.2s.1.8.2 1.2L3.5 15.6l1.7 3 2.1-.8c.6.5 1.3.8 2 1.1l.4 2.1h4.6l.4-2.1c.7-.3 1.4-.6 2-1.1l2.1.8 1.7-3-1.8-1.4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';

  /**
   * Builds the sidebar header switcher. Workspaces (and therefore the cross-panel
   * origins) always come from the authenticated bootstrap payload — the client
   * never decides which panels a user may see.
   *
   * Optional `headerAction` renders a highlighted first row (e.g. Settings).
   */
  function createWorkspaceSwitcher({ mount, iconUrl, currentId, labels, headerAction }) {
    if (!mount) return { render() {} };

    const triggerId = `${mount.id || "workspace"}Trigger`;
    const menuId = `${mount.id || "workspace"}Menu`;
    let workspaces = [];
    let open = false;

    mount.classList.add("workspace");
    mount.innerHTML = `
      <button
        type="button"
        class="workspace-trigger"
        id="${escapeHtml(triggerId)}"
        aria-haspopup="menu"
        aria-expanded="false"
        aria-controls="${escapeHtml(menuId)}"
      >
        <span class="workspace-mark"><img src="${escapeHtml(iconUrl)}" alt="" width="28" height="28" /></span>
        <span class="workspace-text">
          <span class="workspace-name">GARBONA</span>
          <span class="workspace-role" data-workspace-current></span>
        </span>
        <svg class="workspace-chevron" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="m7 10 5 5 5-5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <div class="workspace-menu" id="${escapeHtml(menuId)}" role="menu" hidden></div>`;

    const trigger = mount.querySelector(".workspace-trigger");
    const menu = mount.querySelector(".workspace-menu");
    const currentLabel = mount.querySelector("[data-workspace-current]");
    const markImg = mount.querySelector(".workspace-mark img");
    if (markImg) {
      const svgFallback = String(iconUrl).includes("/app/")
        ? "/app/assets/logo.svg?v=gb4"
        : "/assets/logo.svg?v=gb4";
      markImg.addEventListener("error", () => {
        if (markImg.dataset.fallbackApplied === "1") return;
        markImg.dataset.fallbackApplied = "1";
        markImg.src = svgFallback;
      });
    }

    function text() {
      return typeof labels === "function" ? labels() : labels || {};
    }

    function setOpen(next) {
      open = !!next;
      menu.hidden = !open;
      trigger.setAttribute("aria-expanded", String(open));
    }

    function headerActionHtml(strings) {
      if (!headerAction) return "";
      const label = headerAction.label || strings.settings || "Настройки";
      const icon = headerAction.icon || SETTINGS_ICON;
      return `<button type="button" role="menuitem" class="workspace-option workspace-option-action" data-workspace-action="header">
        <span class="workspace-option-mark is-icon" aria-hidden="true">${icon}</span>
        <span class="workspace-option-name">${escapeHtml(label)}</span>
      </button>`;
    }

    function render() {
      const strings = text();
      const active = workspaces.find((item) => item.id === currentId);
      if (currentLabel) currentLabel.textContent = active ? shortWorkspaceName(active.name) : "";
      trigger.dataset.tip = strings.switcher || "";
      trigger.setAttribute("aria-label", strings.switcher || "");
      menu.setAttribute("aria-label", strings.switcher || "");
      menu.innerHTML = `${headerActionHtml(strings)}${workspaces
        .map((workspace) => optionHtml(workspace, currentId, strings.development || ""))
        .join("")}`;
    }

    function setWorkspaces(list) {
      workspaces = Array.isArray(list) ? list : [];
      render();
    }

    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      setOpen(!open);
    });

    trigger.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      setOpen(!open);
    });

    menu.addEventListener("click", (event) => {
      const action = event.target.closest("[data-workspace-action]");
      if (action) {
        setOpen(false);
        trigger.focus();
        headerAction?.onSelect?.();
        return;
      }
      const option = event.target.closest(".workspace-option[data-workspace]");
      if (!option || option.disabled) return;
      setOpen(false);
      trigger.focus();
      const target = workspaces.find((item) => item.id === option.dataset.workspace);
      if (!target || target.id === currentId || !target.url) return;
      window.location.assign(target.url);
    });

    document.addEventListener("click", (event) => {
      if (!open || mount.contains(event.target)) return;
      setOpen(false);
    });

    attachRovingMenu({
      menu,
      trigger,
      isOpen: () => open,
      setOpen,
    });

    render();
    return { setWorkspaces, render, setOpen };
  }

  return {
    MOBILE_QUERY,
    mobileQuery,
    onMediaChange,
    escapeHtml,
    visibleFocusable,
    trapTab,
    createController,
    renderSidebarNav,
    renderMobileBar,
    renderMoreSheet,
    syncActive,
    createMobileSheet,
    attachRovingMenu,
    createWorkspaceSwitcher,
  };
})();
