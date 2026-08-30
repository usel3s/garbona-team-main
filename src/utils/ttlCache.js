/**
 * Simple in-memory TTL cache for panel/uproject responses.
 * Keys are opaque strings; values are cloned on get to avoid accidental mutation.
 */
function createTtlCache({ defaultTtlMs = 45000, maxEntries = 500 } = {}) {
  const store = new Map();

  function prune() {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.expiresAt <= now) store.delete(key);
    }
    if (store.size <= maxEntries) return;
    const overflow = store.size - maxEntries;
    let i = 0;
    for (const key of store.keys()) {
      store.delete(key);
      i += 1;
      if (i >= overflow) break;
    }
  }

  function get(key) {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  function set(key, value, ttlMs = defaultTtlMs) {
    prune();
    store.set(key, {
      value,
      expiresAt: Date.now() + Math.max(1000, ttlMs),
    });
    return value;
  }

  async function getOrSet(key, loader, ttlMs = defaultTtlMs) {
    const hit = get(key);
    if (hit !== undefined) return hit;
    const value = await loader();
    set(key, value, ttlMs);
    return value;
  }

  function invalidate(key) {
    store.delete(key);
  }

  function invalidatePrefix(prefix) {
    const p = String(prefix || "");
    for (const key of store.keys()) {
      if (key.startsWith(p)) store.delete(key);
    }
  }

  function clear() {
    store.clear();
  }

  return { get, set, getOrSet, invalidate, invalidatePrefix, clear, size: () => store.size };
}

module.exports = { createTtlCache };
