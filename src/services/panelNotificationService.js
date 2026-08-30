const PanelNotification = require("../models/PanelNotification");

const PANEL_VIEWS = new Set([
  "dashboard",
  "sites",
  "analytics",
  "top",
  "wallet",
  "settings",
  "support",
]);

function stripHtml(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizePanelHtml(raw) {
  let html = String(raw || "").trim();
  if (!html) return "";

  html = html.replace(/<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "");
  html = html.replace(/<\s*(script|style|iframe|object|embed)[^>]*\/\s*>/gi, "");
  html = html.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  html = html.replace(/javascript:/gi, "");

  html = html.replace(/<\/?([a-z0-9]+)(\s[^>]*)?>/gi, (match, tagName, attrs = "") => {
    const tag = String(tagName || "").toLowerCase();
    if (tag === "br") return "<br>";
    if (!["b", "strong", "i", "em", "u", "ins", "s", "strike", "del", "code", "pre", "a"].includes(tag)) {
      return "";
    }
    if (tag === "a") {
      if (match.startsWith("</")) return "</a>";
      const hrefMatch = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
      const href = String(hrefMatch?.[2] || hrefMatch?.[3] || hrefMatch?.[4] || "").trim();
      if (!/^https?:\/\//i.test(href)) return "";
      const safeHref = href.replace(/"/g, "&quot;");
      return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">`;
    }
    return match;
  });

  return html.slice(0, 4000);
}

function normalizeLink(payload = {}) {
  const linkType = ["none", "view", "url", "domain"].includes(payload.linkType)
    ? payload.linkType
    : "none";

  if (linkType === "view") {
    const view = String(payload.linkView || payload.linkTarget || "").trim();
    if (!PANEL_VIEWS.has(view)) {
      throw new Error("Некорректный раздел панели для перехода.");
    }
    return { linkType, linkView: view, linkUrl: "", linkDomainId: null };
  }

  if (linkType === "url") {
    const url = String(payload.linkUrl || payload.linkTarget || "").trim();
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("Ссылка должна начинаться с http:// или https://");
    }
    return { linkType, linkView: "", linkUrl: url.slice(0, 500), linkDomainId: null };
  }

  if (linkType === "domain") {
    const domainId = Number(payload.linkDomainId ?? payload.linkTarget);
    if (!Number.isFinite(domainId) || domainId <= 0) {
      throw new Error("Укажите корректный ID домена.");
    }
    return { linkType, linkView: "", linkUrl: "", linkDomainId: Math.floor(domainId) };
  }

  return { linkType: "none", linkView: "", linkUrl: "", linkDomainId: null };
}

async function createPanelNotification(payload, adminTelegramId) {
  const title = String(payload.title || "").trim().slice(0, 120);
  if (!title) throw new Error("Укажите заголовок уведомления.");

  const rawMessage = String(payload.messageHtml || payload.message || "").trim();
  const messageHtml = sanitizePanelHtml(rawMessage);
  if (!stripHtml(messageHtml || rawMessage)) {
    throw new Error("Укажите текст уведомления.");
  }

  const severity = ["info", "warn", "danger"].includes(payload.severity) ? payload.severity : "info";
  const link = normalizeLink(payload);

  const doc = await PanelNotification.create({
    title,
    messageHtml,
    severity,
    ...link,
    adminTelegramId: String(adminTelegramId || ""),
    active: true,
  });

  return doc;
}

async function listActivePanelNotifications(limit = 50) {
  return PanelNotification.find({ active: true })
    .sort({ createdAt: -1, _id: -1 })
    .limit(Math.min(100, Math.max(1, Number(limit) || 50)))
    .lean();
}

function panelNotificationToAlert(row) {
  return {
    id: `panel:${row._id}`,
    type: "panel",
    severity: row.severity || "info",
    title: row.title || "",
    message: stripHtml(row.messageHtml || ""),
    messageHtml: row.messageHtml || "",
    linkType: row.linkType || "none",
    linkView: row.linkView || "",
    linkUrl: row.linkUrl || "",
    domainId: row.linkDomainId || null,
    createdAt: row.createdAt || null,
  };
}

module.exports = {
  createPanelNotification,
  listActivePanelNotifications,
  panelNotificationToAlert,
  sanitizePanelHtml,
  PANEL_VIEWS,
};
