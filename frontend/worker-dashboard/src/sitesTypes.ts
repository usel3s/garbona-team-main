import type { DashboardRenderContext } from "./types";

export type SitesStatusFilter = "all" | "active" | "paused" | "own" | "team";

export type LinkWindowType =
  | "FakeWindow"
  | "CurrentWindow"
  | "NewWindow"
  | "AboutBlank";

export interface SitesFilters {
  q: string;
  status: SitesStatusFilter;
}

export interface SitesState {
  selectedId: number | null;
  filters: SitesFilters;
}

export interface SiteStats {
  views: number;
  clicks: number;
  auths: number;
  logs: number;
  mafiles: number;
  desktopPercent?: number | null;
}

export interface CountRow {
  name: string;
  count: number;
}

export interface CountryRow {
  code: string;
  name?: string;
  count: number;
}

export type AuthJournalTone = "default" | "error" | "info" | "success";

export interface AuthJournalEvent {
  id: string;
  text: string;
  tone?: AuthJournalTone;
  tag?: string;
  at: string;
}

export interface AuthJournalSession {
  id: string;
  ip: string;
  language?: string;
  browser?: string;
  os?: string;
  device?: string;
  duration?: string;
  at: string;
  online?: boolean;
  events?: AuthJournalEvent[];
}

export interface BanCheckResult {
  banned?: boolean;
  clean?: boolean;
}

export interface DomainBanChecks {
  google?: BanCheckResult;
  cloudflare?: BanCheckResult;
  whois?: BanCheckResult;
  updatedAt?: string;
}

export interface SiteDomain {
  id: number;
  domain: string;
  online: number;
  owner?: string;
  isOwn: boolean;
  isTeamPublic: boolean;
  ip?: string;
  service?: string;
  status?: string;
  isPaused: boolean;
  createdAt: string;
  linksCount: number;
  stats: SiteStats;
  ns?: string[];
  banChecks?: DomainBanChecks;
  bindType?: string;
  bindNs?: string[];
  countries?: CountryRow[];
  devices?: CountRow[];
}

export interface SiteLinkSteam {
  logError?: boolean;
  mafileError?: boolean;
  mafileSteamRedirect?: boolean;
  tradeError?: boolean;
  logRedirect?: string;
  tradeRedirect?: string;
  mafileRedirect?: string;
}

export interface SiteLink {
  id: number;
  path: string;
  url?: string;
  link?: string;
  windowType: LinkWindowType;
  template?: string | number;
  templateName?: string;
  online?: boolean;
  stats: SiteStats;
  iframe?: boolean;
  cloaking?: boolean;
  ban_vpn?: boolean;
  randPath?: boolean;
  isPaused?: boolean;
  steam?: SiteLinkSteam;
  countries?: CountryRow[];
  devices?: CountRow[];
}

export interface SiteTemplate {
  id: number;
  name: string;
  preview?: string;
  mine?: boolean;
  isPublic?: boolean;
}

export interface SitesListResponse {
  domains: SiteDomain[];
  totalOnline?: number;
  ownCount?: number;
}

export interface SiteDetailResponse {
  domain: SiteDomain;
  links: SiteLink[];
}

export interface DomainCheckResponse {
  existing?: boolean;
  message?: string;
  ip?: string;
  ns?: string[];
}

export interface DomainBindInfo {
  ip?: string;
  ns?: string[];
  cloudflareAvailable?: boolean;
}

export interface DomainCreatePayload {
  domain: string;
  bindType?: "ip" | "cloudflare" | string;
  isTransit?: boolean;
}

export interface DomainCreateResponse {
  existing?: boolean;
  created?: SiteDomain;
  bindIp?: string;
  bindNs?: string[];
  bindType?: string;
}

export interface LinkPayload {
  path?: string;
  templateId: string | number;
  windowType: LinkWindowType;
  iframe?: boolean;
  cloaking?: boolean;
  ban_vpn?: boolean;
  randPath?: boolean;
  logError?: boolean;
  mafileError?: boolean;
  mafileSteamRedirect?: boolean;
  tradeError?: boolean;
  logRedirect?: string;
  tradeRedirect?: string;
  mafileRedirect?: string;
}

export interface SitesApi {
  listDomains(force?: boolean): Promise<SitesListResponse>;
  getDomain(id: number, force?: boolean): Promise<SiteDetailResponse>;
  checkDomain(domain: string): Promise<DomainCheckResponse>;
  getBindInfo(): Promise<DomainBindInfo>;
  createDomain(payload: DomainCreatePayload | string): Promise<DomainCreateResponse>;
  deleteDomain(id: number): Promise<{ ok?: boolean }>;
  listTemplates(force?: boolean): Promise<SiteTemplate[]>;
  createTemplate(payload: {
    name: string;
    code: string;
    isPublic?: boolean;
  }): Promise<SiteTemplate>;
  deleteTemplate(id: number): Promise<{ ok?: boolean }>;
  createLink(domainId: number, payload: LinkPayload): Promise<unknown>;
  updateLink(
    domainId: number,
    linkId: number,
    payload: LinkPayload,
  ): Promise<unknown>;
  deleteLink(domainId: number, linkId: number): Promise<{ ok?: boolean }>;
  getLinkJournal?(
    domainId: number,
    linkId: number,
  ): Promise<{ sessions: AuthJournalSession[] }>;
}

export interface SitesRenderContext extends DashboardRenderContext {}
