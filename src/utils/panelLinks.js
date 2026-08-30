const { env } = require("../config/env");

const DEFAULT_DOCS_URL = "https://docs.garbona.cc/docs/#overview";

/** Публичный URL Worker App (Telegram Mini App). */
function workerPanelAppUrl() {
  const base = String(env.panelPublicUrl || "").replace(/\/$/, "");
  if (!base) return "";
  return `${base}/app/`;
}

/** Публичный URL админ-панели. */
function adminPanelUrl() {
  const base = String(env.adminPanelUrl || "https://admin.garbona.cc").replace(/\/$/, "");
  return base ? `${base}/` : "https://admin.garbona.cc/";
}

/** Карточка заявки на выплату в админ-панели. */
function adminPayoutUrl(requestId) {
  const id = String(requestId || "").trim();
  const base = String(adminPanelUrl() || "").replace(/\/$/, "");
  if (!base) return "";
  if (!/^[a-f0-9]{24}$/i.test(id)) return `${base}/#payouts`;
  return `${base}/payouts/${id}`;
}

/** Абсолютный канонический URL документации для внешних интерфейсов. */
function docsSiteUrl(value = env.manualsDocsUrl || DEFAULT_DOCS_URL) {
  try {
    const url = new URL(String(value || DEFAULT_DOCS_URL).trim());
    if (!["http:", "https:"].includes(url.protocol)) return DEFAULT_DOCS_URL;
    const path = url.pathname.replace(/\/+$/, "") || "/docs";
    url.pathname = `${path}/`;
    if (!url.hash) url.hash = "overview";
    return url.toString();
  } catch (_) {
    return DEFAULT_DOCS_URL;
  }
}

module.exports = {
  workerPanelAppUrl,
  adminPanelUrl,
  adminPayoutUrl,
  docsSiteUrl,
};
