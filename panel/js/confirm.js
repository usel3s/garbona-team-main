(function () {
  let active = null;

  function close(result) {
    if (!active || active.closing) return;
    active.closing = true;
    const { overlay, resolve, trigger, onKeydown } = active;
    document.removeEventListener("keydown", onKeydown);
    overlay.classList.remove("is-open");
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      overlay.remove();
      active = null;
      if (trigger instanceof HTMLElement && document.contains(trigger)) {
        trigger.focus({ preventScroll: true });
      }
      resolve(result);
    };
    overlay.addEventListener("transitionend", finish, { once: true });
    setTimeout(finish, 220);
  }

  function open(message, options = {}) {
    if (active) return Promise.resolve(false);

    const overlay = document.createElement("div");
    overlay.className = "admin-confirm-backdrop";
    overlay.innerHTML = `
      <section class="admin-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="adminConfirmTitle" aria-describedby="adminConfirmMessage">
        <h2 id="adminConfirmTitle"></h2>
        <p id="adminConfirmMessage"></p>
        <div class="admin-confirm-actions">
          <button type="button" class="btn-ghost" data-admin-confirm-cancel></button>
          <button type="button" data-admin-confirm-ok></button>
        </div>
      </section>
    `;

    const okBtn = overlay.querySelector("[data-admin-confirm-ok]");
    okBtn.className = options.danger ? "btn-danger" : "btn-primary";
    overlay.querySelector("#adminConfirmTitle").textContent = options.title || "Подтвердите действие";
    overlay.querySelector("#adminConfirmMessage").textContent = String(message || "");
    overlay.querySelector("[data-admin-confirm-cancel]").textContent = options.cancelLabel || "Отмена";
    okBtn.textContent = options.confirmLabel || "Подтвердить";

    return new Promise((resolve) => {
      const trigger = document.activeElement;
      const onKeydown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close(false);
        }
      };

      active = { overlay, resolve, trigger, onKeydown, closing: false };
      overlay.addEventListener("click", (event) => {
        if (event.target.closest("[data-admin-confirm-ok]")) {
          event.preventDefault();
          close(true);
          return;
        }
        if (event.target.closest("[data-admin-confirm-cancel]")) {
          event.preventDefault();
          close(false);
        }
      });
      document.addEventListener("keydown", onKeydown);
      document.body.appendChild(overlay);
      requestAnimationFrame(() => {
        overlay.classList.add("is-open");
        const focusBtn = options.danger
          ? overlay.querySelector("[data-admin-confirm-cancel]")
          : okBtn;
        focusBtn.focus({ preventScroll: true });
      });
    });
  }

  window.GarbonaAdminConfirm = { open };
})();
