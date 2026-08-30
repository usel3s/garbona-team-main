window.GarbonaPanelAuth = (function () {
  // Last /me payload, so callers can read bootstrap data (workspaces, …)
  // without a second authenticated round-trip.
  let lastSession = null;

  async function getConfig() {
    return PanelAPI.get("/config");
  }

  async function me() {
    lastSession = await PanelAPI.get("/me");
    return lastSession;
  }

  function session() {
    return lastSession;
  }

  async function loginPassword(username, password) {
    return PanelAPI.post("/auth/login", { username, password });
  }

  async function logout() {
    return PanelAPI.post("/auth/logout", {});
  }

  async function requireAuth() {
    try {
      const data = await me();
      return data.user;
    } catch (_) {
      try {
        const cfg = await getConfig();
        if (cfg.authDisabled) {
          location.replace("index.html");
          return null;
        }
      } catch (__) {
        /* ignore */
      }
      if (!/login\.html$/i.test(location.pathname)) {
        try {
          const payoutPath = location.pathname.match(/\/payouts\/([a-fA-F0-9]{24})\/?$/i);
          sessionStorage.setItem(
            "garbona-admin-return",
            payoutPath ? `#payouts/${payoutPath[1]}` : location.hash || ""
          );
        } catch (_) {
          /* ignore */
        }
        location.replace("login.html");
      }
      return null;
    }
  }

  return { getConfig, me, session, loginPassword, logout, requireAuth };
})();
