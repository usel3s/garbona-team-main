(function () {
  const errorEl = document.getElementById("loginError");
  const errorText = document.getElementById("loginErrorText");
  const form = document.getElementById("loginForm");
  const submitBtn = document.getElementById("loginSubmit");
  const usernameEl = document.getElementById("loginUsername");
  const passwordEl = document.getElementById("loginPassword");
  const toggleBtn = document.getElementById("togglePassword");
  const labelEl = submitBtn?.querySelector(".login-submit-label");
  const waitEl = submitBtn?.querySelector(".login-submit-wait");

  let lockedUntil = 0;

  function showError(message) {
    errorText.textContent = message || "Не удалось войти";
    errorEl.classList.add("is-visible");
  }

  function clearError() {
    errorEl.classList.remove("is-visible");
  }

  function setBusy(busy) {
    submitBtn.disabled = busy;
    usernameEl.disabled = busy;
    passwordEl.disabled = busy;
    if (labelEl) labelEl.hidden = busy;
    if (waitEl) waitEl.hidden = !busy;
  }

  function lockLeftSec() {
    return Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
  }

  function goToPanel() {
    let hash = "";
    try {
      hash = sessionStorage.getItem("garbona-admin-return") || "";
      sessionStorage.removeItem("garbona-admin-return");
    } catch (_) {
      /* ignore */
    }
    if (!hash.startsWith("#")) hash = "";
    location.replace("index.html" + hash);
  }

  toggleBtn?.addEventListener("click", () => {
    const show = passwordEl.type === "password";
    passwordEl.type = show ? "text" : "password";
    toggleBtn.setAttribute("aria-pressed", show ? "true" : "false");
    toggleBtn.setAttribute("aria-label", show ? "Скрыть пароль" : "Показать пароль");
  });

  (async function boot() {
    try {
      const cfg = await GarbonaPanelAuth.getConfig();
      if (cfg.authDisabled) {
        goToPanel();
        return;
      }
    } catch (_) {
      /* continue */
    }

    try {
      await GarbonaPanelAuth.me();
      goToPanel();
      return;
    } catch (_) {
      /* need login */
    }

    usernameEl.focus();
  })();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearError();

    const left = lockLeftSec();
    if (left > 0) {
      showError(`Слишком много попыток. Повторите через ${left} с.`);
      return;
    }

    const username = String(usernameEl.value || "").trim();
    const password = String(passwordEl.value || "");
    if (!username || !password) {
      showError("Введите логин и пароль.");
      return;
    }
    if (username.length < 3 || username.length > 32) {
      showError("Неверный логин или пароль.");
      return;
    }
    if (password.length < 8 || password.length > 128) {
      showError("Неверный логин или пароль.");
      return;
    }

    setBusy(true);
    try {
      await GarbonaPanelAuth.loginPassword(username, password);
      goToPanel();
    } catch (err) {
      const code = err.message || "";
      const retry = Number(err.data?.retryAfterSec || 0);
      if (code === "too_many_attempts" || err.status === 429) {
        lockedUntil = Date.now() + Math.max(retry, 60) * 1000;
        showError(
          `Слишком много попыток. Повторите через ${Math.max(retry, lockLeftSec())} с.`
        );
      } else if (code === "missing_credentials") {
        showError("Введите логин и пароль.");
      } else if (code === "forbidden_origin") {
        showError("Запрос отклонён. Откройте панель по адресу admin.garbona.cc.");
      } else {
        showError("Неверный логин или пароль.");
      }
      setBusy(false);
      passwordEl.focus();
      passwordEl.select();
    }
  });
})();
