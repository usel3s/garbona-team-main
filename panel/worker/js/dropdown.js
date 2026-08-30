window.WorkerDropdown = (function () {
  let openState = null;

  function getPortalRoot(container) {
    const dialog = container.closest("dialog");
    if (dialog?.open) return dialog;
    const eventDrawer = container.closest(".event-card-drawer.is-open");
    if (eventDrawer) {
      return eventDrawer.querySelector(".event-card-drawer-sheet") || eventDrawer;
    }
    return document.body;
  }

  function resetMenuStyles(menu) {
    menu.classList.remove("is-drop-up");
    menu.style.position = "";
    menu.style.top = "";
    menu.style.left = "";
    menu.style.width = "";
    menu.style.zIndex = "";
  }

  function closeOpen() {
    if (!openState) return;
    const { container, menu, onClose } = openState;
    container.classList.remove("is-open");
    container.querySelector(".custom-select-trigger")?.setAttribute("aria-expanded", "false");
    menu.hidden = true;
    resetMenuStyles(menu);
    if (menu.parentElement !== container) {
      container.appendChild(menu);
    }
    openState = null;
    onClose?.();
  }

  function repositionMenu() {
    if (!openState) return;
    const { menu, trigger } = openState;
    const rect = trigger.getBoundingClientRect();
    const gap = 4;
    menu.style.position = "fixed";
    menu.style.left = `${rect.left}px`;
    menu.style.width = `${rect.width}px`;
    menu.style.zIndex = "10000";

    const menuHeight = menu.offsetHeight;
    const spaceBelow = window.innerHeight - rect.bottom - gap;
    const spaceAbove = rect.top - gap;

    if (spaceBelow >= menuHeight || spaceBelow >= spaceAbove) {
      menu.style.top = `${rect.bottom + gap}px`;
      menu.classList.remove("is-drop-up");
    } else {
      menu.style.top = `${Math.max(gap, rect.top - gap - menuHeight)}px`;
      menu.classList.add("is-drop-up");
    }
  }

  document.addEventListener("click", (e) => {
    if (!openState) return;
    const { container, menu } = openState;
    if (container.contains(e.target) || menu.contains(e.target)) return;
    closeOpen();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeOpen();
  });

  window.addEventListener("resize", repositionMenu);
  window.addEventListener("scroll", repositionMenu, true);

  function mount(container, { value, options = [], ariaLabel = "", onChange } = {}) {
    if (!container) return;

    const normalized = options.map((opt) =>
      typeof opt === "object"
        ? { value: String(opt.value), label: String(opt.label || opt.value) }
        : { value: String(opt), label: String(opt) }
    );

    let current = String(value ?? normalized[0]?.value ?? "");

    container.className = "custom-select";
    container.innerHTML = `
      <button type="button" class="custom-select-trigger" aria-haspopup="listbox" aria-expanded="false">
        <span class="custom-select-label"></span>
        <span class="custom-select-chevron" aria-hidden="true"></span>
      </button>
      <div class="custom-select-menu" role="listbox" hidden></div>
    `;

    const trigger = container.querySelector(".custom-select-trigger");
    const labelEl = container.querySelector(".custom-select-label");
    const menu = container.querySelector(".custom-select-menu");

    if (ariaLabel) trigger.setAttribute("aria-label", ariaLabel);

    function labelOf(val) {
      return normalized.find((o) => o.value === String(val))?.label || val;
    }

    function renderMenu() {
      menu.innerHTML = "";
      normalized.forEach((opt) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "custom-select-option";
        btn.dataset.value = opt.value;
        btn.textContent = opt.label;
        btn.setAttribute("role", "option");
        if (opt.value === current) {
          btn.classList.add("is-selected");
          btn.setAttribute("aria-selected", "true");
        } else {
          btn.setAttribute("aria-selected", "false");
        }
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          current = opt.value;
          labelEl.textContent = opt.label;
          closeOpen();
          renderMenu();
          onChange?.(current);
        });
        menu.appendChild(btn);
      });
    }

    function openMenu() {
      if (openState && openState.container !== container) closeOpen();
      const portalRoot = getPortalRoot(container);
      container.classList.add("is-open");
      trigger.setAttribute("aria-expanded", "true");
      portalRoot.appendChild(menu);
      menu.hidden = false;
      openState = { container, menu, trigger, portalRoot };
      repositionMenu();
    }

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      if (container.classList.contains("is-open")) closeOpen();
      else openMenu();
    });

    labelEl.textContent = labelOf(current);
    renderMenu();

    return {
      getValue: () => current,
      setValue: (next) => {
        current = String(next);
        labelEl.textContent = labelOf(current);
        renderMenu();
      },
      destroy: () => {
        if (openState?.container === container) closeOpen();
        container.innerHTML = "";
      },
    };
  }

  return { mount, close: closeOpen };
})();
