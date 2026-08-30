window.GarbonaAuth = (function () {
  const KEY = "garbona_steam_session_v1";

  function getSession() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function isLoggedIn() {
    return Boolean(getSession());
  }

  function login(nickname) {
    const session = {
      id: `steam_${Date.now().toString(36)}`,
      nickname: nickname || `Player_${Math.floor(1000 + Math.random() * 9000)}`,
      avatar: "assets/logo.png?v=gb3",
      loggedAt: Date.now(),
    };
    localStorage.setItem(KEY, JSON.stringify(session));
    window.dispatchEvent(new CustomEvent("garbona:auth", { detail: session }));
    return session;
  }

  function logout() {
    localStorage.removeItem(KEY);
    window.dispatchEvent(new CustomEvent("garbona:auth", { detail: null }));
  }

  function requireAuth(onOk) {
    if (isLoggedIn()) {
      if (typeof onOk === "function") onOk(getSession());
      return true;
    }
    window.dispatchEvent(new CustomEvent("garbona:need-auth"));
    return false;
  }

  return { getSession, isLoggedIn, login, logout, requireAuth };
})();
