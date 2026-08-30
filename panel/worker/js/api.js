window.WorkerAPI = (function () {
  const GET_TTL_MS = 8000;
  const cache = new Map();
  const inflight = new Map();

  function cacheKey(path) {
    return String(path || "");
  }

  function withForceParam(path) {
    const raw = String(path || "");
    if (/[?&]force=/.test(raw)) return raw;
    return raw + (raw.includes("?") ? "&" : "?") + "force=1";
  }

  function getCached(path) {
    const entry = cache.get(cacheKey(path));
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      cache.delete(cacheKey(path));
      return undefined;
    }
    return entry.data;
  }

  function setCached(path, data) {
    cache.set(cacheKey(path), { data, expiresAt: Date.now() + GET_TTL_MS });
    return data;
  }

  function bust(match) {
    const m = String(match || "");
    for (const key of [...cache.keys()]) {
      if (!m || key.includes(m)) cache.delete(key);
    }
  }

  async function request(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const res = await fetch(`/api/user${path}`, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      ...options,
      body:
        options.body && typeof options.body === "object"
          ? JSON.stringify(options.body)
          : options.body,
    });

    let data = null;
    let rawText = "";
    try {
      rawText = await res.text();
      data = rawText ? JSON.parse(rawText) : null;
    } catch (_) {
      data = null;
    }

    if (!res.ok) {
      const fallback =
        /cannot\s+get|cannot\s+post/i.test(rawText)
          ? `Cannot ${method} ${path}`
          : `HTTP ${res.status}`;
      const err = new Error(data?.error || fallback);
      err.status = res.status;
      err.data = data;
      throw err;
    }

    if (method !== "GET") bust("");
    return data;
  }

  async function get(path, { force = false } = {}) {
    const requestPath = force ? withForceParam(path) : path;
    const storeKey = cacheKey(path);
    if (!force) {
      const hit = getCached(path);
      if (hit !== undefined) return hit;
      if (inflight.has(storeKey)) return inflight.get(storeKey);
    } else {
      bust(path.split("?")[0]);
      inflight.delete(storeKey);
    }

    const pending = request(requestPath)
      .then((data) => setCached(path, data))
      .finally(() => inflight.delete(storeKey));
    inflight.set(storeKey, pending);
    return pending;
  }

  return {
    get,
    post: (path, body) => request(path, { method: "POST", body }),
    patch: (path, body) => request(path, { method: "PATCH", body }),
    del: (path) => request(path, { method: "DELETE" }),
    bust,
  };
})();
