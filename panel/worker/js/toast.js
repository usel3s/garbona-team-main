window.WorkerToast = (function () {
  const MAX_VISIBLE = 4;
  const DEFAULT_MS = 4200;

  let host = null;

  function ensureHost() {
    if (host && document.body.contains(host)) return host;
    host = document.createElement("div");
    host.className = "toast-host";
    host.setAttribute("aria-live", "polite");
    host.setAttribute("aria-relevant", "additions");
    document.body.appendChild(host);
    return host;
  }

  function friendlyError(error) {
    const status = Number(error?.status || 0);
    const raw = String(error?.message || error || "").trim();
    const lower = raw.toLowerCase();

    if (status === 401 || /unauthorized|session|сесси/i.test(raw)) {
      return WorkerI18n.t("toast.unauthorized") || "Сессия истекла. Войдите снова.";
    }
    if (status === 403 || /forbidden|нет доступа|access denied/i.test(raw)) {
      return WorkerI18n.t("toast.forbidden") || "Недостаточно прав для этого действия.";
    }
    if (
      status === 404 ||
      /http 404|not found|не найден|не найдено|account not found/i.test(lower)
    ) {
      if (/cannot get|cannot post|<!doctype|<html/i.test(lower)) {
        return (
          WorkerI18n.t("toast.endpointMissing") ||
          "Сервис временно недоступен. Обновите страницу или перезапустите панель."
        );
      }
      if (raw && !/^http\s*404$/i.test(raw) && raw.length > 3) {
        return raw;
      }
      return (
        WorkerI18n.t("toast.notFound") ||
        "Данные не найдены. Аккаунт мог быть удалён или временно недоступен."
      );
    }
    if (status === 429 || /rate|flood|слишком много/i.test(lower)) {
      return WorkerI18n.t("toast.rateLimit") || "Слишком много запросов. Подождите немного.";
    }
    if (
      status === 409 ||
      /request failed with status code 409/i.test(lower)
    ) {
      if (raw && !/^request failed with status code/i.test(raw) && raw.length > 8) {
        return raw;
      }
      return (
        WorkerI18n.t("toast.conflict") ||
        "Этот адрес уже занят. Укажи другой path или оставь поле пустым."
      );
    }
    if (status >= 500 || /http 5\d\d|internal|server error|ег?о недоступ/i.test(lower)) {
      return (
        WorkerI18n.t("toast.server") ||
        "Сервер временно недоступен. Попробуйте ещё раз чуть позже."
      );
    }
    if (/network|failed to fetch|load failed|offline/i.test(lower)) {
      return WorkerI18n.t("toast.network") || "Нет соединения. Проверьте интернет.";
    }
    if (/^http\s*\d{3}$/i.test(raw)) {
      return WorkerI18n.t("toast.generic") || "Не удалось выполнить действие.";
    }
    return raw || WorkerI18n.t("common.error") || "Ошибка";
  }

  function iconSvg(type) {
    if (type === "success") {
      return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7.5 12.2 2.8 2.8 6.2-6.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="8.25" stroke="currentColor" stroke-width="1.5"/></svg>`;
    }
    if (type === "error") {
      return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.25" stroke="currentColor" stroke-width="1.5"/><path d="M12 8v5.2M12 15.8h.01" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
    }
    return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.25" stroke="currentColor" stroke-width="1.5"/><path d="M12 11v5M12 8.2h.01" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
  }

  function show(message, type = "info", opts = {}) {
    const text = String(message || "").trim();
    if (!text) return;
    const root = ensureHost();
    while (root.children.length >= MAX_VISIBLE) {
      root.firstElementChild?.remove();
    }

    const el = document.createElement("div");
    el.className = `toast toast-${type}`;
    el.setAttribute("role", type === "error" ? "alert" : "status");
    el.innerHTML = `
      <span class="toast-icon">${iconSvg(type)}</span>
      <div class="toast-body">
        <div class="toast-msg"></div>
      </div>
      <button type="button" class="toast-close" aria-label="Close">✕</button>
    `;
    el.querySelector(".toast-msg").textContent = text;

    const ttl = Number(opts.ms ?? DEFAULT_MS);
    let timer = null;
    const dismiss = () => {
      if (timer) clearTimeout(timer);
      el.classList.add("is-leaving");
      setTimeout(() => el.remove(), 220);
    };

    el.querySelector(".toast-close").addEventListener("click", dismiss);
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add("is-in"));
    if (ttl > 0) timer = setTimeout(dismiss, ttl);
    return { dismiss };
  }

  return {
    show,
    info: (msg, opts) => show(msg, "info", opts),
    success: (msg, opts) => show(msg, "success", opts),
    error: (msgOrErr, opts) => {
      const msg =
        msgOrErr && typeof msgOrErr === "object"
          ? friendlyError(msgOrErr)
          : String(msgOrErr || "");
      return show(msg, "error", opts);
    },
    friendlyError,
  };
})();
