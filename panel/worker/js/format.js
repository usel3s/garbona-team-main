window.WorkerFormat = (function () {
  function prefs() {
    return WorkerPrefs.get();
  }

  function convertUsd(usdAmount) {
    const { currency, rate } = prefs();
    const usd = Number(usdAmount || 0);
    if (currency === "RUB") {
      return Number((usd * rate).toFixed(0));
    }
    return Number(usd.toFixed(2));
  }

  function money(usdAmount) {
    const { currency } = prefs();
    const value = convertUsd(usdAmount);
    if (currency === "RUB") {
      return `${value.toLocaleString(prefs().lang === "ru" ? "ru-RU" : "en-US")} ₽`;
    }
    return `$${value.toFixed(2)}`;
  }

  function date(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    const locale = prefs().lang === "ru" ? "ru-RU" : "en-US";
    return d.toLocaleString(locale, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function chartDayLabel(isoDate) {
    if (!isoDate) return "";
    const d = new Date(`${isoDate}T12:00:00`);
    if (Number.isNaN(d.getTime())) return isoDate;
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${dd}.${mm}`;
  }

  function moneyTick(usdAmount) {
    const { currency } = prefs();
    const value = convertUsd(usdAmount);
    if (currency === "RUB") {
      return `${Math.round(value)} ₽`;
    }
    return `$${Number(value).toFixed(0)}`;
  }

  function shortDayLabel(isoDate) {
    if (!isoDate) return "";
    const d = new Date(`${isoDate}T12:00:00`);
    if (Number.isNaN(d.getTime())) return isoDate;
    const locale = prefs().lang === "ru" ? "ru-RU" : "en-US";
    return d.toLocaleDateString(locale, { day: "numeric", month: "short" });
  }

  function shortDayTime(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    const locale = prefs().lang === "ru" ? "ru-RU" : "en-US";
    const day = d.toLocaleDateString(locale, { day: "numeric", month: "short" });
    const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
    return prefs().lang === "ru" ? `${day} в ${time}` : `${day}, ${time}`;
  }

  function checkDateTime(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    const locale = prefs().lang === "ru" ? "ru-RU" : "en-US";
    const day = d.toLocaleDateString(locale, { day: "numeric", month: "short" });
    const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
    return `${day} ${time}`;
  }

  function statusLabel(status) {
    const raw = String(status || "");
    if (/mafile/i.test(raw)) return WorkerI18n.t("status.mafile");
    if (/валид|valid|ok/i.test(raw) && !/невалид|invalid/i.test(raw)) {
      return WorkerI18n.t("status.valid");
    }
    if (/невалид|invalid/i.test(raw)) return WorkerI18n.t("status.invalid");
    if (/empty|пуст/i.test(raw)) return WorkerI18n.t("status.empty");
    if (/onsell|на\s*продаж|прода[её]тся/i.test(raw)) return WorkerI18n.t("status.onSale");
    if (/(^sold$|продан)/i.test(raw) && !/продаж|прода[её]тся/i.test(raw)) {
      return WorkerI18n.t("status.sold");
    }
    if (/onhold|удержан|холд/i.test(raw)) return WorkerI18n.t("status.hold");
    return raw || "—";
  }

  function statusBadgeClass(status) {
    const raw = String(status || "");
    if (/mafile/i.test(raw)) return "warn";
    if (/валид|valid|ok/i.test(raw)) return "ok";
    if (/невалид|invalid/i.test(raw)) return "bad";
    return "";
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const APP_BASE = "/app/";

  function appAsset(rel) {
    const clean = String(rel || "").replace(/^\/+/, "");
    return `${APP_BASE}${clean}`;
  }

  function logoUrl() {
    return appAsset("assets/logo-mark.png?v=gb4");
  }

  function kpiDeltaHtml(pct) {
    const value = pct == null ? 0 : Number(pct);
    const sign = value > 0 ? "+" : "";
    const cls = value > 0 ? "up" : value < 0 ? "down" : "neutral";
    const suffix = WorkerI18n.t("dashboard.deltaSuffix");
    return `<div class="kpi-delta ${cls}"><span class="kpi-delta-pct">${sign}${value}%</span><span class="kpi-delta-suffix">${escapeHtml(suffix)}</span></div>`;
  }

  return {
    money,
    convertUsd,
    date,
    shortDayLabel,
    shortDayTime,
    checkDateTime,
    chartDayLabel,
    moneyTick,
    statusLabel,
    statusBadgeClass,
    escapeHtml,
    kpiDeltaHtml,
    appAsset,
    logoUrl,
  };
})();
