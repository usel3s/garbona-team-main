window.WorkerNotif = (function () {
  const READ_KEY = "worker_notif_read_v1";
  const MIGRATED_KEY = "worker_notif_migrated_v1";

  let userCtx = { telegramId: "anon" };
  let migratePromise = null;

  function userScope() {
    return String(userCtx.telegramId || "anon");
  }

  function storageKey(base) {
    return `${base}:${userScope()}`;
  }

  function readLocalIdSet() {
    try {
      const raw = localStorage.getItem(storageKey(READ_KEY));
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr.map(String) : []);
    } catch (_) {
      return new Set();
    }
  }

  function clearLocalReadIds() {
    try {
      localStorage.removeItem(storageKey(READ_KEY));
    } catch (_) {}
  }

  function isMigrated() {
    try {
      return localStorage.getItem(storageKey(MIGRATED_KEY)) === "1";
    } catch (_) {
      return false;
    }
  }

  function markMigrated() {
    try {
      localStorage.setItem(storageKey(MIGRATED_KEY), "1");
    } catch (_) {}
  }

  async function migrateLocalReadState() {
    if (isMigrated()) return;
    const ids = [...readLocalIdSet()];
    markMigrated();
    clearLocalReadIds();
    if (!ids.length) return;
    try {
      await WorkerAPI.post("/alerts/read", { ids });
      WorkerAPI.bust("/alerts");
    } catch (_) {
      /* server is source of truth; ignore migration errors */
    }
  }

  async function ensureMigrated() {
    if (!migratePromise) {
      migratePromise = migrateLocalReadState().finally(() => {
        migratePromise = null;
      });
    }
    await migratePromise;
  }

  async function persistRead(ids) {
    const list = [...new Set((ids || []).map(String).filter(Boolean))];
    if (!list.length) return;
    const data = await WorkerAPI.post("/alerts/read", { ids: list });
    WorkerAPI.bust("/alerts");
    return Array.isArray(data?.alerts) ? sortNewestFirst(data.alerts) : null;
  }

  async function markRead(id) {
    const alertId = String(id || "").trim();
    if (!alertId) return null;
    return persistRead([alertId]);
  }

  async function markAllRead(ids) {
    return persistRead(ids || []);
  }

  function unreadCount(items) {
    return (items || []).filter((item) => !item.read).length;
  }

  function alertTimestamp(item) {
    if (!item?.createdAt) return Number.NEGATIVE_INFINITY;
    const timestamp = new Date(item.createdAt).getTime();
    return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
  }

  function sortNewestFirst(items) {
    return (items || [])
      .map((item, index) => ({ item, index, timestamp: alertTimestamp(item) }))
      .sort((a, b) => b.timestamp - a.timestamp || a.index - b.index)
      .map(({ item }) => item);
  }

  async function fetchAlerts({ force = false } = {}) {
    await ensureMigrated();
    const data = await WorkerAPI.get("/alerts", { force });
    return sortNewestFirst(Array.isArray(data?.alerts) ? data.alerts : []);
  }

  function setUserContext(userOrId) {
    if (userOrId && typeof userOrId === "object") {
      userCtx = {
        telegramId: String(userOrId.telegramId || "anon"),
      };
      return;
    }
    userCtx = {
      telegramId: userOrId ? String(userOrId) : "anon",
    };
  }

  return {
    fetchAlerts,
    markRead,
    markAllRead,
    unreadCount,
    setUserContext,
    sortNewestFirst,
  };
})();
