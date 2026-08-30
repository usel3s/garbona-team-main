export type DashboardPeriod = 7 | 14 | 30;
export type ActivityType = "log" | "mafile";
export type ActivityStatus = "valid" | "invalid" | "mafile" | "other";
export type ActivityLifecycle = "sold" | "on_sale" | "processed";
export type ActivityStatusFilter = "all" | ActivityStatus | ActivityLifecycle;
export type ActivitySort = "date-desc" | "date-asc" | "price-desc" | "price-asc";

export interface DashboardRenderContext {
  main: HTMLElement;
  user: {
    telegramId?: string | number;
    username?: string;
    firstName?: string;
    photoUrl?: string;
    walletUsd?: number;
  };
  refresh?: boolean;
}

export interface OverviewUser {
  telegramId: string;
  username: string;
  firstName: string;
  profitPercent: number;
  daysWithTeam: number;
  walletUsd: number;
  profitTotalUsd: number;
  operationsTotal: number;
  maxShareUsd: number;
}

export interface OverviewKpi {
  profitTodayUsd: number;
  profitTotalDeltaPct: number;
  profitPeriodDeltaPct: number;
  logsDeltaPct: number;
  mafileDeltaPct: number;
  profitPeriodUsd: number;
  totalLogs: number;
  todayLogs: number;
  logsPeriod: number;
  mafileTotal: number;
  todayMafile: number;
  mafilePeriod: number;
}

export interface TrendPoint {
  date: string;
  totalUsd: number;
  profitUsd: number;
  logsUsd: number;
  logsCount: number;
  mafileCount: number;
}

export interface InventoryItem {
  name: string;
  iconUrl?: string;
  priceUsd: number;
  amount: number;
  /** CS2/Steam rarity key for glow tint behind the icon. */
  rarity?: SkinRarity;
  /** Steam `name_color` hex without #, if provided by API. */
  nameColor?: string;
}

export type SkinRarity =
  | "consumer"
  | "industrial"
  | "milspec"
  | "restricted"
  | "classified"
  | "covert"
  | "extraordinary"
  | "contraband";


export interface InventoryGroup {
  appid: number;
  name: string;
  itemCount: number;
  totalUsd: number;
  inventoryUsd?: number;
  items: InventoryItem[];
  vac?: boolean;
}

export interface GameSummary {
  appid: number;
  name: string;
  itemCount?: number;
  inventoryUsd?: number;
  playtime?: number;
  iconUrl?: string;
  imageUrl?: string;
  vac?: boolean | { count?: number; games?: string[] };
}

export interface ActivityEvent {
  id: string;
  sourceId: string;
  eventType: ActivityType;
  username: string;
  /** Domain + path where the log/profit was captured, e.g. falconspro.org/login */
  sourcePage?: string;
  status: string;
  createdAt: string;
  priceUsd: number;
  country?: string;
  level?: number;
  accountTag?: string;
  steamId?: string;
  steamProfileUrl?: string;
  balanceUsd?: number;
  inventoryUsd?: number;
  saleStatus?: string;
  processStatus?: string;
  gamesCount?: number;
  games?: GameSummary[];
  topItems?: InventoryItem[];
  inventoryBreakdown?: {
    tradable?: number;
    marketable?: number;
  };
  inventoryByAppid?: Record<string, InventoryGroup>;
  lastPlayed?: string;
  vac?: boolean | { count?: number; games?: string[] };
  /** UProject MaFile unlock time: ISO date or remaining hours. */
  mafileTime?: string;
  mafileSessionHoursLeft?: number;
  mafileSessionUnlocked?: boolean;
  /** UProject red-light: MaFile session provisionally invalid. */
  sessionInvalid?: boolean;
  sessionCheckedAt?: string;
}

export interface DashboardOverview {
  currency: {
    rate: number;
    globalCurrency: string;
  };
  user: OverviewUser;
  kpi: OverviewKpi;
  days: DashboardPeriod;
  series: TrendPoint[];
  recentLogs: ActivityEvent[];
  recentMafiles: ActivityEvent[];
  panelUsername: string;
  logsError: string | null;
}

export interface ActivityFilters {
  query: string;
  type: "all" | ActivityType;
  status: ActivityStatusFilter;
  sort: ActivitySort;
}

export interface DashboardApi {
  getOverview(days: DashboardPeriod, force?: boolean): Promise<DashboardOverview>;
  getLogDetail(sourceId: string): Promise<ActivityEvent>;
  runLogAction(
    sourceId: string,
    action: "refresh" | "check-valid" | "sell" | "process",
  ): Promise<Partial<ActivityEvent> & { ok?: boolean; taskId?: string; pending?: boolean }>;
  pollCheckValid?(
    sourceId: string,
    taskId?: string,
  ): Promise<{
    pending: boolean;
    done?: boolean;
    failed?: boolean;
    state?: string;
    log?: ActivityEvent;
  }>;
}

export interface DashboardCopy {
  [key: string]: string;
}
