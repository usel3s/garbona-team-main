(async function () {
  if (!["localhost", "127.0.0.1", "garbona.cc"].includes(location.hostname)) {
    const dest = new URL(location.pathname + location.search + location.hash, "https://garbona.cc");
    location.replace(dest.toString());
    return;
  }

  WorkerPrefs.init();
  const byId = (id) => document.getElementById(id);
  const errorEl = byId("loginError");
  const errorText = byId("loginErrorText");
  const passwordForm = byId("passwordForm");
  const twoFactorForm = byId("twoFactorForm");
  const alternative = byId("loginAlternative");
  const loginInput = byId("loginInput");
  const passwordInput = byId("passwordInput");
  const consentInput = byId("consentInput");
  const passwordSubmit = byId("passwordSubmit");
  const twoFactorInput = byId("twoFactorInput");
  const twoFactorSubmit = byId("twoFactorSubmit");
  const authBtn = byId("tgAuthBtn");
  const langSelect = byId("langSelect");
  const themeBtn = byId("themeBtn");
  let credentials = null;

  function applyLoginI18n() {
    WorkerI18n.apply(document);
    const { lang, theme } = WorkerPrefs.get();
    langSelect.value = lang;
    themeBtn.textContent = theme === "dark" ? "☾" : "☀";
    document.title = `${WorkerI18n.t("login.title")} — ${WorkerI18n.t("brand.name")}`;
  }
  function showError(key) {
    errorText.textContent = WorkerI18n.t(key);
    errorEl.classList.add("is-visible");
  }
  function clearError() {
    errorEl.classList.remove("is-visible");
  }
  function setPending(button, pending) {
    button.disabled = pending;
    button.classList.toggle("is-pending", pending);
  }
  function safeNextPath() {
    const next = new URLSearchParams(location.search).get("next") || "";
    return /^\/app\/discord\?token=[A-Za-z0-9_-]{16,64}$/.test(next) ? next : "";
  }
  function goApp() {
    const next = safeNextPath();
    if (next) return location.replace(next);
    const hash = location.hash.replace(/^#/, "");
    location.replace(hash ? `/app/#${hash}` : "/app/#dashboard");
  }
  function showTwoFactor() {
    passwordForm.hidden = true;
    alternative.hidden = true;
    twoFactorForm.hidden = false;
    twoFactorInput.value = "";
    twoFactorInput.focus();
  }
  function showPasswordStep() {
    twoFactorForm.hidden = true;
    passwordForm.hidden = false;
    alternative.hidden = false;
    credentials = null;
    clearError();
    passwordInput.focus();
  }

  langSelect.addEventListener("change", () => {
    WorkerPrefs.set({ lang: langSelect.value });
    applyLoginI18n();
  });
  themeBtn.addEventListener("click", () => {
    WorkerPrefs.toggleTheme();
    applyLoginI18n();
  });
  byId("passwordToggle").addEventListener("click", (event) => {
    const visible = passwordInput.type === "text";
    passwordInput.type = visible ? "password" : "text";
    event.currentTarget.setAttribute("aria-label", WorkerI18n.t(visible ? "login.showPassword" : "login.hidePassword"));
    passwordInput.focus();
  });
  byId("twoFactorBack").addEventListener("click", showPasswordStep);
  twoFactorInput.addEventListener("input", () => {
    twoFactorInput.value = twoFactorInput.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 14);
    twoFactorInput.classList.toggle("is-recovery", /[A-Z-]/.test(twoFactorInput.value));
  });

  passwordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearError();
    if (!loginInput.value.trim() || !passwordInput.value) return showError("login.errorFields");
    if (!consentInput.checked) {
      showError("login.errorConsent");
      consentInput.focus();
      return;
    }
    credentials = { login: loginInput.value.trim(), password: passwordInput.value };
    setPending(passwordSubmit, true);
    try {
      const result = await WorkerAuth.loginPassword(credentials.login, credentials.password);
      if (result?.requiresTwoFactor) showTwoFactor();
      else goApp();
    } catch (error) {
      const map = { invalid_credentials: "login.errorCredentials", access_denied: "login.errorNotTeam" };
      showError(map[error.message] || "login.errorDefault");
    } finally {
      setPending(passwordSubmit, false);
    }
  });

  twoFactorForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearError();
    const normalizedCode = twoFactorInput.value.replace(/[^A-Z0-9]/g, "");
    if (!credentials || (!/^\d{6}$/.test(normalizedCode) && !/^[A-Z0-9]{12}$/.test(normalizedCode))) return showError("login.errorTwoFactorFormat");
    setPending(twoFactorSubmit, true);
    try {
      await WorkerAuth.loginPassword(credentials.login, credentials.password, twoFactorInput.value);
      goApp();
    } catch (error) {
      showError(error.message === "invalid_two_factor" ? "login.errorTwoFactor" : "login.errorDefault");
      twoFactorInput.select();
    } finally {
      setPending(twoFactorSubmit, false);
    }
  });

  applyLoginI18n();
  if (new URLSearchParams(location.search).get("error")) showError("login.errorSession");
  try {
    const cfg = await WorkerAuth.getConfig();
    if (cfg.usdRubRate) WorkerPrefs.setRate(cfg.usdRubRate);
    if (cfg.authDisabled) return goApp();
  } catch (_) {}
  try {
    await WorkerAuth.me();
    return goApp();
  } catch (_) {}
  try {
    if (await WorkerAuth.tryWebAppLogin()) return goApp();
  } catch (error) {
    const map = { not_team_member: "login.errorNotTeam", bad_hash: "login.errorBadHash", expired: "login.errorExpired" };
    showError(map[error.message] || "login.errorDefault");
  }

  window.onTelegramAuth = async function (data) {
    if (!data) return showError("login.errorCancelled");
    clearError();
    authBtn.disabled = true;
    try {
      await WorkerAuth.loginTelegram(data);
      goApp();
    } catch (error) {
      authBtn.disabled = false;
      const map = { not_team_member: "login.errorNotTeam", bad_hash: "login.errorBadHash", expired: "login.errorExpired" };
      showError(map[error.message] || "login.errorDefault");
    }
  };

  let botId = "";
  try {
    botId = String((await WorkerAuth.getConfig()).botId || "").trim();
  } catch (_) {
    showError("login.errorConfig");
    return;
  }
  if (!/^\d+$/.test(botId)) return showError("login.errorBotToken");

  authBtn.hidden = false;
  authBtn.disabled = true;
  authBtn.addEventListener("click", () => {
    if (!consentInput.checked) {
      showError("login.errorConsent");
      consentInput.focus();
      return;
    }
    if (!window.Telegram?.Login?.auth) return showError("login.errorWidget");
    clearError();
    window.Telegram.Login.auth({ bot_id: botId, request_access: true }, (data) => window.onTelegramAuth(data));
  });
  try {
    await new Promise((resolve, reject) => {
      if (window.Telegram?.Login?.auth) return resolve();
      const script = document.createElement("script");
      script.async = true;
      script.src = "https://telegram.org/js/telegram-widget.js?22";
      script.onload = resolve;
      script.onerror = () => reject(new Error("widget_load_failed"));
      document.body.appendChild(script);
    });
    if (!window.Telegram?.Login?.auth) throw new Error("widget_missing");
    authBtn.disabled = false;
  } catch (_) {
    showError("login.errorWidgetLoad");
    authBtn.disabled = false;
  }
})();
