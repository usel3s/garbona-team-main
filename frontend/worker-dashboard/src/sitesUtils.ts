import type {
  BanCheckResult,
  CountRow,
  CountryRow,
  DomainBanChecks,
  LinkWindowType,
  SiteDomain,
  SiteLink,
  SitesFilters,
  SiteStats,
} from "./sitesTypes";
import { sitesText } from "./sitesCopy";

/** Distribute `targetTotal` across rows in the same proportions as the source. */
export function scaleCountRows<T extends { count: number }>(
  rows: T[] | undefined,
  targetTotal: number,
): T[] {
  if (!rows?.length || targetTotal <= 0) return [];
  const sum = rows.reduce((acc, row) => acc + Math.max(0, Number(row.count || 0)), 0);
  if (sum <= 0) return [];

  const scaled = rows.map((row) => ({
    ...row,
    count: Math.max(0, Math.round((Math.max(0, Number(row.count || 0)) / sum) * targetTotal)),
  }));
  const scaledSum = scaled.reduce((acc, row) => acc + row.count, 0);
  const drift = targetTotal - scaledSum;
  if (drift !== 0 && scaled.length) {
    const pivot = scaled.reduce(
      (best, row, index) => (row.count > scaled[best].count ? index : best),
      0,
    );
    scaled[pivot] = {
      ...scaled[pivot],
      count: Math.max(0, scaled[pivot].count + drift),
    };
  }
  return scaled.filter((row) => row.count > 0);
}

export function scaleCountries(
  rows: CountryRow[] | undefined,
  targetTotal: number,
): CountryRow[] {
  return scaleCountRows(rows, targetTotal);
}

export function scaleDevices(
  rows: CountRow[] | undefined,
  targetTotal: number,
): CountRow[] {
  return scaleCountRows(rows, targetTotal);
}

export function linkPathLabel(link: SiteLink): string {
  const path = String(link.path || "").replace(/^\/+/, "");
  return path ? `/${path}` : "/";
}

export function safeSiteStats(source?: { stats?: SiteStats | null } | null): SiteStats {
  const stats = source?.stats;
  if (!stats || typeof stats !== "object") {
    return { views: 0, clicks: 0, auths: 0, logs: 0, mafiles: 0 };
  }
  return {
    views: Number(stats.views || 0),
    clicks: Number(stats.clicks || 0),
    auths: Number(stats.auths || 0),
    logs: Number(stats.logs || 0),
    mafiles: Number(stats.mafiles || 0),
    desktopPercent:
      stats.desktopPercent == null ? null : Number(stats.desktopPercent),
  };
}

export function filterDomains(
  domains: SiteDomain[],
  filters: SitesFilters,
): SiteDomain[] {
  const q = String(filters.q || "").trim().toLowerCase();
  return domains.filter((domain) => {
    if (q && !String(domain.domain || "").toLowerCase().includes(q)) {
      return false;
    }
    if (filters.status === "active" && domain.isPaused) return false;
    if (filters.status === "paused" && !domain.isPaused) return false;
    if (filters.status === "own" && !domain.isOwn) return false;
    if (filters.status === "team" && !domain.isTeamPublic) return false;
    return true;
  });
}

export function summarizeDomains(domains: SiteDomain[]) {
  const activeCount = domains.filter((domain) => !domain.isPaused).length;
  const pausedCount = domains.length - activeCount;
  const linksCount = domains.reduce(
    (sum, domain) => sum + Number(domain.linksCount || 0),
    0,
  );
  return { activeCount, pausedCount, linksCount };
}

export function windowTypeLabel(type?: LinkWindowType | string): string {
  const map: Record<string, string> = {
    FakeWindow: sitesText("windowFakeWindow"),
    CurrentWindow: sitesText("windowCurrentWindow"),
    NewWindow: sitesText("windowNewWindow"),
    AboutBlank: sitesText("windowAboutBlank"),
  };
  return map[String(type || "")] || String(type || "—");
}

export function linkDisplayUrl(link: SiteLink, domainName?: string): string {
  const raw = String(link.url || link.link || "").trim();
  if (raw) {
    return raw.startsWith("http") ? raw : `https://${raw.replace(/^\/+/, "")}`;
  }
  const path = String(link.path || "").replace(/^\/+/, "");
  const host = String(domainName || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  if (!host) return path ? `/${path}` : "—";
  return path ? `https://${host}/${path}` : `https://${host}/`;
}

export function normalizeRedirectInput(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

export function banStatusText(
  type: "google" | "cloudflare" | "whois",
  check?: BanCheckResult,
): string {
  if (!check) return sitesText("banUnknown");
  if (check.banned) {
    if (type === "google") return sitesText("banGoogleBad");
    if (type === "cloudflare") return sitesText("banCloudflareBad");
    return sitesText("banWhoisBad");
  }
  if (check.clean) {
    if (type === "google") return sitesText("banGoogleOk");
    if (type === "cloudflare") return sitesText("banCloudflareOk");
    return sitesText("banWhoisOk");
  }
  return sitesText("banUnknown");
}

export function formatBanCheckedAt(banChecks?: DomainBanChecks): string {
  const value = banChecks?.updatedAt;
  if (!value) return "—";
  if (window.WorkerFormat?.checkDateTime) {
    return window.WorkerFormat.checkDateTime(value);
  }
  return value;
}

export function formatShortDateTime(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (window.WorkerFormat?.shortDayTime) {
    const formatted = window.WorkerFormat.shortDayTime(value);
    // Preview stubs sometimes echo the raw ISO string.
    if (formatted && formatted !== value && !/^\d{4}-\d{2}-\d{2}T/.test(formatted)) {
      return formatted;
    }
  }
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
