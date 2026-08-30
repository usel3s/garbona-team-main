window.PanelAPI = (function () {
  const GET_TTL_MS = 30000;
  const cache = new Map();
  const inflight = new Map();

  function getCached(path) {
    const entry = cache.get(path);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      cache.delete(path);
      return undefined;
    }
    return entry.data;
  }

  function setCached(path, data) {
    cache.set(path, { data, expiresAt: Date.now() + GET_TTL_MS });
    return data;
  }

  function bust(match) {
    const m = String(match || "");
    for (const key of [...cache.keys()]) {
      if (!m || key.includes(m)) cache.delete(key);
    }
  }

  function bustAfterMutation(path) {
    if (/\/admin\/sites\//.test(path)) bust("/admin/sites/");
    else if (/\/admin\/steam/.test(path)) bust("/admin/steam");
    else bust("");
  }

  async function request(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const res = await fetch(`/api${path}`, {
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

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("text/plain")) {
      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
      if (method !== "GET") bustAfterMutation(path);
      return text;
    }

    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      data = null;
    }

    if (!res.ok) {
      const err = new Error(data?.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }

    if (method !== "GET") bustAfterMutation(path);
    return data;
  }

  async function get(path, { force = false } = {}) {
    if (!force) {
      const hit = getCached(path);
      if (hit !== undefined) return hit;
      if (inflight.has(path)) return inflight.get(path);
    }

    const pending = request(path)
      .then((data) => setCached(path, data))
      .finally(() => inflight.delete(path));
    inflight.set(path, pending);
    return pending;
  }

  return {
    get,
    post: (path, body) => request(path, { method: "POST", body }),
    patch: (path, body) => request(path, { method: "PATCH", body }),
    del: (path) => request(path, { method: "DELETE" }),
    request,
    bust,
  };
})();
