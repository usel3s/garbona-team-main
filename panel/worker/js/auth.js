window.WorkerAuth = (function () {
  let lastSession = null;

  async function getConfig() {
    return WorkerAPI.get("/config");
  }

  async function me() {
    lastSession = await WorkerAPI.get("/me");
    return lastSession;
  }

  function session() {
    return lastSession;
  }

  async function loginTelegram(payload) {
    return WorkerAPI.post("/auth/telegram", payload);
  }

  async function loginWebApp(initData) {
    return WorkerAPI.post("/auth/webapp", { initData });
  }

  async function loginPassword(login, password, code = "") {
    return WorkerAPI.post("/auth/password", { login, password, code });
  }

  async function logout() {
    return WorkerAPI.post("/auth/logout", {});
  }

  function getTelegramWebApp() {
    return window.Telegram?.WebApp || null;
  }

  async function tryWebAppLogin() {
    const tg = getTelegramWebApp();
    if (!tg) return false;
    try {
      tg.ready?.();
      tg.expand?.();
    } catch (_) {}
    const initData = String(tg.initData || "").trim();
    if (!initData) return false;
    await loginWebApp(initData);
    return true;
  }

  async function requireAuth() {
    try {
      const data = await me();
      return data.user;
    } catch (_) {
      try {
        if (await tryWebAppLogin()) {
          const data = await me();
          return data.user;
        }
      } catch (_) {}
      if (!/\/login$/i.test(location.pathname)) {
        location.replace("/app/login");
      }
      return null;
    }
  }

  return {
    getConfig,
    me,
    session,
    loginTelegram,
    loginWebApp,
    loginPassword,
    tryWebAppLogin,
    getTelegramWebApp,
    logout,
    requireAuth,
  };
})();
