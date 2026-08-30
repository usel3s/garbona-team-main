"use strict";

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function looksLikeHost(value) {
  const raw = String(value || "").trim();
  if (!raw || /^\d+$/.test(raw)) return false;
  return raw.includes(".") || raw.includes("/");
}

function hostFromUrlLike(value) {
  const raw = String(value || "").trim();
  if (!raw || /^\d+$/.test(raw)) return "";
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProto);
    return String(url.host || "")
      .trim()
      .replace(/^www\./i, "");
  } catch {
    return raw
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split("/")[0]
      .trim();
  }
}

function hostFromUnknown(value) {
  if (value == null || value === false) return "";
  if (typeof value === "object") {
    const row = asRecord(value);
    if (!row) return "";
    return (
      hostFromUnknown(row.domain) ||
      hostFromUnknown(row.domainName) ||
      hostFromUnknown(row.domain_name) ||
      hostFromUnknown(row.host) ||
      hostFromUnknown(row.hostname) ||
      hostFromUnknown(row.linkUrl) ||
      hostFromUnknown(row.link_url) ||
      hostFromUnknown(row.url) ||
      hostFromUnknown(row.pageUrl) ||
      hostFromUnknown(row.sourceUrl) ||
      hostFromUnknown(row.website) ||
      hostFromUnknown(row.name)
    );
  }
  const raw = String(value).trim();
  if (!raw || /^\d+$/.test(raw) || !looksLikeHost(raw)) return "";
  return hostFromUrlLike(raw);
}

function pathFromUnknown(value) {
  if (value == null || value === false) return "";
  if (typeof value === "object") {
    const row = asRecord(value);
    if (!row) return "";
    return (
      pathFromUnknown(row.path) ||
      pathFromUnknown(row.linkPath) ||
      pathFromUnknown(row.linkUrl) ||
      pathFromUnknown(row.link_url) ||
      pathFromUnknown(typeof row.link === "string" ? row.link : "")
    );
  }
  let raw = String(value).trim();
  if (!raw || /^\d+$/.test(raw)) return "";
  if (/^https?:\/\//i.test(raw) || looksLikeHost(raw)) {
    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      raw = url.pathname || "/";
    } catch {
      raw = raw.replace(/^https?:\/\//i, "").replace(/^[^/]+\//, "");
    }
  }
  raw = raw.replace(/^\/+/, "");
  return raw;
}

function domainIdOf(row = {}) {
  const nestedDomain = asRecord(row.domain);
  const nestedLink = asRecord(row.link);
  const nestedSite = asRecord(row.site);
  const candidates = [
    row.domainId,
    row.domain_id,
    row.siteId,
    row.site_id,
    typeof row.domain === "number" ? row.domain : null,
    /^\d+$/.test(String(row.domain || "")) ? row.domain : null,
    nestedDomain?.id,
    nestedDomain?.domainId,
    nestedLink?.domainId,
    nestedLink?.domain_id,
    nestedLink?.domain,
    nestedSite?.id,
    nestedSite?.domainId,
  ];
  for (const value of candidates) {
    const id = Number(value);
    if (Number.isFinite(id) && id > 0) return id;
  }
  return 0;
}

function domainRowsFromPayload(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  const nested =
    payload.rows ||
    payload.data ||
    payload.domains ||
    payload.list ||
    payload.items;
  if (Array.isArray(nested)) return nested;
  const map = asRecord(nested) || asRecord(payload);
  if (!map) return [];
  const keys = Object.keys(map);
  if (!keys.length) return [];
  if (keys.every((key) => /^\d+$/.test(key))) {
    return keys.map((id) => {
      const value = map[id];
      if (value && typeof value === "object") return { id, ...value };
      return { id, domain: value };
    });
  }
  return [];
}

function buildDomainLookup(domains = []) {
  const map = new Map();
  for (const row of domainRowsFromPayload(domains) || []) {
    const id = Number(row?.id ?? row?.domainId);
    const host = hostFromUnknown(row?.domain || row?.domainName || row?.host || row);
    if (!Number.isFinite(id) || id < 1 || !host) continue;
    map.set(id, host);
    map.set(String(id), host);
  }
  return map;
}

function lookupDomain(domainById, id) {
  if (!domainById || !id) return "";
  if (typeof domainById.get === "function") {
    return String(domainById.get(id) || domainById.get(String(id)) || domainById.get(Number(id)) || "").trim();
  }
  return String(domainById[id] || domainById[String(id)] || "").trim();
}

function sourcePageBags(row = {}) {
  return [
    row,
    asRecord(row.data),
    asRecord(row.account),
    asRecord(row.result),
    asRecord(row.link),
    asRecord(row.site),
    asRecord(row.origin),
    asRecord(row.source),
    asRecord(row.steamLink),
    asRecord(row.referrer),
  ].filter(Boolean);
}

function formatAccountSourcePage(row = {}, domainById = null) {
  const bags = sourcePageBags(row);
  let domain = "";
  let pagePath = "";

  for (const bag of bags) {
    if (!domain) {
      domain = hostFromUnknown(
        bag.linkUrl ||
          bag.link_url ||
          bag.domain ||
          bag.domainName ||
          bag.domain_name ||
          bag.host ||
          bag.hostname ||
          bag.url ||
          bag.pageUrl ||
          bag.sourceUrl ||
          bag.website ||
          bag.landingUrl ||
          bag.referer ||
          bag.referrer ||
          bag.from ||
          (typeof bag.link === "string" ? bag.link : "")
      );
    }
    if (!pagePath) {
      pagePath = pathFromUnknown(
        bag.linkUrl ||
          bag.link_url ||
          bag.path ||
          bag.linkPath ||
          (typeof bag.link === "string" ? bag.link : "") ||
          bag.url ||
          bag.pageUrl ||
          bag.landingUrl
      );
    }
  }

  if (!domain) {
    for (const bag of bags) {
      domain = hostFromUnknown(lookupDomain(domainById, domainIdOf(bag)));
      if (domain) break;
    }
  }

  if (!domain && !pagePath) return "";
  if (!domain) return `/${pagePath}`;
  return pagePath ? `${domain}/${pagePath}` : `${domain}/`;
}

function preferSourcePage(...values) {
  for (const value of values) {
    const next = String(value || "").trim();
    if (next) return next;
  }
  return "";
}

function unwrapSteamAccount(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.id != null) return payload;
  const nested = [payload.data, payload.result, payload.account, payload.row].find(
    (row) => row && typeof row === "object" && row.id != null
  );
  return nested || payload;
}

function steamAccountRows(payload) {
  const unwrapped = unwrapSteamAccount(payload) || payload;
  if (Array.isArray(unwrapped)) return unwrapped;
  if (Array.isArray(unwrapped?.rows)) return unwrapped.rows;
  if (Array.isArray(unwrapped?.data)) return unwrapped.data;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.data)) return payload.data;
  if (unwrapped && typeof unwrapped === "object" && unwrapped.id != null) return [unwrapped];
  return [];
}

function sourcePageMapFromAccounts(accounts, domainById = null) {
  const map = new Map();
  for (const raw of accounts || []) {
    const account = unwrapSteamAccount(raw);
    const id = String(account?.id || account?.sourceId || "").trim();
    if (!/^\d+$/.test(id)) continue;
    const page = formatAccountSourcePage(account, domainById);
    if (!page) continue;
    map.set(id, page);
  }
  return map;
}

function missingSourcePageIds(sourceIds, pageBySourceId) {
  const seen = new Set();
  const missing = [];
  for (const value of sourceIds || []) {
    const id = String(value || "").trim();
    if (!/^\d+$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    if (!String(pageBySourceId?.get?.(id) || "").trim()) missing.push(id);
  }
  return missing;
}

function parseSourcePageParts(value) {
  const raw = String(value || "").trim();
  if (!raw) return { host: "", path: "" };
  return {
    host: String(hostFromUrlLike(raw) || "")
      .trim()
      .toLowerCase()
      .replace(/^www\./, ""),
    path: String(pathFromUnknown(raw) || "")
      .trim()
      .replace(/^\/+|\/+$/g, "")
      .toLowerCase(),
  };
}

module.exports = {
  domainRowsFromPayload,
  buildDomainLookup,
  formatAccountSourcePage,
  parseSourcePageParts,
  preferSourcePage,
  unwrapSteamAccount,
  steamAccountRows,
  sourcePageMapFromAccounts,
  missingSourcePageIds,
};
