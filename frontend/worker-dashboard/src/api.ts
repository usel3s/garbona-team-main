import type {
  ActivityEvent,
  ActivityType,
  DashboardApi,
  DashboardOverview,
  DashboardPeriod,
  GameSummary,
  InventoryGroup,
  InventoryItem,
  OverviewKpi,
  OverviewUser,
  TrendPoint,
} from "./types";
import { resolveSkinRarity } from "./utils";

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

function steamIconUrl(raw: unknown): string | undefined {
  const value = string(raw).trim();
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value) || value.startsWith("data:")) return value;
  // Uproject отдаёт economy hash; тот же CDN, что в workerLogActionsService.
  const hash = value
    .replace(/^https?:\/\/[^/]+\/economy\/image\//i, "")
    .replace(/\/\d+fx\d+f$/i, "");
  if (!hash) return undefined;
  return `https://community.cloudflare.steamstatic.com/economy/image/${hash}/256fx256f`;
}

function normalizeItem(raw: unknown): InventoryItem {
  const item = record(raw);
  const nested = record(item.asset_description || item.assetDescription || item.description);
  const name = string(
    item.name ||
      item.itemHashName ||
      item.market_hash_name ||
      item.hash_name ||
      nested.market_hash_name,
    "Item",
  );
  const priceUsd = number(
    item.priceUsd ??
      item.price_usd ??
      record(item.price).usd ??
      record(item.price).value ??
      item.price,
  );
  const nameColor = string(
    item.nameColor ||
      item.name_color ||
      nested.name_color ||
      nested.nameColor ||
      "",
  ).replace(/^#/, "");
  const rarityRaw = string(
    item.rarity ||
      item.rarityName ||
      item.quality ||
      nested.rarity ||
      nested.type ||
      "",
  );
  return {
    name,
    iconUrl:
      steamIconUrl(item.iconUrl) ||
      steamIconUrl(item.icon_url) ||
      steamIconUrl(item.icon) ||
      steamIconUrl(item.image) ||
      steamIconUrl(item.imageUrl) ||
      steamIconUrl(nested.icon_url) ||
      undefined,
    priceUsd,
    amount: Math.max(1, number(item.amount ?? item.quantity ?? item.count, 1)),
    nameColor: nameColor || undefined,
    rarity: resolveSkinRarity({
      rarity: rarityRaw || undefined,
      nameColor: nameColor || undefined,
      name,
      priceUsd,
    }),
  };
}

function normalizeInventoryGroup(raw: unknown, key: string): InventoryGroup {
  const group = record(raw);
  const items = list(group.items).map(normalizeItem);
  return {
    appid: number(group.appid, number(key)),
    name: string(group.name, number(group.appid, number(key)) ? `App ${number(group.appid, number(key))}` : "Steam"),
    itemCount: number(group.itemCount, items.length),
    totalUsd: number(group.totalUsd, number(group.inventoryUsd)),
    inventoryUsd: number(group.inventoryUsd),
    items,
    vac: Boolean(group.vac),
  };
}

function steamAppFallback(appid: number): string {
  if (!appid || appid === 753) return "";
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/capsule_231x87.jpg`;
}

function steamGameIconUrl(appid: number, icon?: string): string | undefined {
  const hash = String(icon || "").trim();
  if (!appid) return undefined;
  if (/^https?:\/\//i.test(hash)) return hash;
  if (hash) {
    return `https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/${appid}/${hash}.jpg`;
  }
  return steamAppFallback(appid);
}

function normalizeGames(raw: unknown): GameSummary[] {
  return list(raw).map((value) => {
    const game = record(value);
    const vac = game.vac;
    const appid = number(game.appid || game.appId);
    const directIcon =
      steamIconUrl(game.iconUrl) ||
      steamIconUrl(game.icon_url) ||
      steamIconUrl(game.logoUrl) ||
      undefined;
    return {
      appid,
      name: string(game.name || game.title || game.gameName, appid ? `App ${appid}` : "Steam"),
      itemCount: number(game.itemCount),
      inventoryUsd: number(game.inventoryUsd ?? game.totalUsd),
      playtime: number(game.playtime ?? game.playtimeForever ?? game.playtime_forever),
      iconUrl:
        directIcon ||
        steamGameIconUrl(appid, string(game.icon || game.img_icon_url || game.imgIconUrl)),
      imageUrl:
        steamIconUrl(game.imageUrl) ||
        steamIconUrl(game.headerUrl) ||
        steamIconUrl(game.header_image) ||
        (appid && appid !== 753
          ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`
          : undefined),
      vac:
        typeof vac === "object" && vac !== null
          ? {
              count: number(record(vac).count, 1),
              games: list(record(vac).games).map((entry) => string(entry)),
            }
          : Boolean(vac),
    };
  });
}

function inferType(status: unknown, requestedType?: ActivityType, eventType?: unknown): ActivityType {
  if (requestedType) return requestedType;
  if (eventType === "mafile" || eventType === "log") return eventType;
  return /mafile/i.test(string(status)) ? "mafile" : "log";
}

export function normalizeActivity(
  raw: unknown,
  requestedType?: ActivityType,
): ActivityEvent {
  const event = record(raw);
  const inventorySource = record(event.inventoryByAppid);
  const inventoryByAppid = Object.fromEntries(
    Object.entries(inventorySource).map(([key, value]) => [
      key,
      normalizeInventoryGroup(value, key),
    ]),
  );
  const inventoryBreakdown = record(event.inventoryBreakdown);
  const vac = event.vac;

  return {
    id: string(event.id, string(event.sourceId)),
    sourceId: string(event.sourceId, string(event.id)),
    eventType: inferType(
      event.status,
      requestedType,
      event.eventType,
    ),
    username: string(event.username),
    sourcePage: string(event.sourcePage) || undefined,
    status: string(event.status),
    createdAt: string(event.createdAt),
    priceUsd: number(event.priceUsd),
    country: string(event.country) || undefined,
    level: event.level == null ? undefined : number(event.level),
    accountTag: string(event.accountTag) || undefined,
    steamId: string(event.steamId) || undefined,
    steamProfileUrl: string(event.steamProfileUrl) || undefined,
    balanceUsd: event.balanceUsd == null ? undefined : number(event.balanceUsd),
    inventoryUsd: event.inventoryUsd == null ? undefined : number(event.inventoryUsd),
    saleStatus: string(event.saleStatus) || undefined,
    processStatus: string(event.processStatus) || undefined,
    gamesCount: event.gamesCount == null ? undefined : number(event.gamesCount),
    games: normalizeGames(event.games),
    topItems: list(event.topItems).map(normalizeItem),
    inventoryBreakdown: {
      tradable: number(inventoryBreakdown.tradable),
      marketable: number(inventoryBreakdown.marketable),
    },
    inventoryByAppid,
    lastPlayed: string(event.lastPlayed) || undefined,
    mafileTime: string(event.mafileTime || event.mafileSessionAvailableAt) || undefined,
    mafileSessionHoursLeft:
      event.mafileSessionHoursLeft == null
        ? undefined
        : number(event.mafileSessionHoursLeft),
    mafileSessionUnlocked:
      event.mafileSessionUnlocked == null
        ? undefined
        : Boolean(event.mafileSessionUnlocked),
    sessionInvalid: Boolean(event.sessionInvalid),
    sessionCheckedAt: string(event.sessionCheckedAt) || undefined,
    vac:
      typeof vac === "object" && vac !== null
        ? {
            count: number(record(vac).count, 1),
            games: list(record(vac).games).map((entry) => string(entry)),
          }
        : Boolean(vac),
  };
}

function normalizeUser(raw: unknown): OverviewUser {
  const user = record(raw);
  return {
    telegramId: string(user.telegramId),
    username: string(user.username),
    firstName: string(user.firstName),
    profitPercent: number(user.profitPercent),
    daysWithTeam: number(user.daysWithTeam),
    walletUsd: number(user.walletUsd),
    profitTotalUsd: number(user.profitTotalUsd, number(user.walletUsd)),
    operationsTotal: number(user.operationsTotal),
    maxShareUsd: number(user.maxShareUsd),
  };
}

function normalizeKpi(raw: unknown): OverviewKpi {
  const kpi = record(raw);
  return {
    profitTodayUsd: number(kpi.profitTodayUsd),
    profitTotalDeltaPct: number(kpi.profitTotalDeltaPct),
    profitPeriodDeltaPct: number(kpi.profitPeriodDeltaPct),
    logsDeltaPct: number(kpi.logsDeltaPct),
    mafileDeltaPct: number(kpi.mafileDeltaPct),
    profitPeriodUsd: number(kpi.profitPeriodUsd),
    totalLogs: number(kpi.totalLogs),
    todayLogs: number(kpi.todayLogs),
    logsPeriod: number(kpi.logsPeriod),
    mafileTotal: number(kpi.mafileTotal),
    todayMafile: number(kpi.todayMafile),
    mafilePeriod: number(kpi.mafilePeriod),
  };
}

function normalizeTrendPoint(raw: unknown): TrendPoint {
  const point = record(raw);
  return {
    date: string(point.date),
    totalUsd: number(point.totalUsd),
    profitUsd: number(point.profitUsd),
    logsUsd: number(point.logsUsd),
    logsCount: number(point.logsCount),
    mafileCount: number(point.mafileCount),
  };
}

export function normalizeOverview(
  raw: unknown,
  requestedDays: DashboardPeriod,
): DashboardOverview {
  const overview = record(raw);
  const currency = record(overview.currency);
  const resolvedDays = [7, 14, 30].includes(number(overview.days))
    ? (number(overview.days) as DashboardPeriod)
    : requestedDays;

  return {
    currency: {
      rate: number(currency.rate, 1),
      globalCurrency: string(currency.globalCurrency, "USD"),
    },
    user: normalizeUser(overview.user),
    kpi: normalizeKpi(overview.kpi),
    days: resolvedDays,
    series: list(overview.series).map(normalizeTrendPoint),
    recentLogs: list(overview.recentLogs).map((event) =>
      normalizeActivity(event, "log"),
    ),
    recentMafiles: list(overview.recentMafiles).map((event) =>
      normalizeActivity(event, "mafile"),
    ),
    panelUsername: string(overview.panelUsername),
    logsError: overview.logsError ? string(overview.logsError) : null,
  };
}

function requireWorkerApi() {
  if (!window.WorkerAPI) {
    throw new Error("Dashboard API is unavailable");
  }
  return window.WorkerAPI;
}

export const dashboardApi: DashboardApi = {
  async getOverview(days, force = false) {
    const raw = await requireWorkerApi().get(`/overview?days=${days}`, { force });
    return normalizeOverview(raw, days);
  },

  async getLogDetail(sourceId) {
    const raw = await requireWorkerApi().get(
      `/logs/${encodeURIComponent(sourceId)}`,
      { force: true },
    );
    return normalizeActivity(raw);
  },

  async runLogAction(sourceId, action) {
    const raw = await requireWorkerApi().post(
      `/logs/${encodeURIComponent(sourceId)}/${action}`,
    );
    const payload = record(raw);
    if (action === "check-valid") {
      return {
        ok: payload.ok == null ? true : Boolean(payload.ok),
        taskId: string(payload.taskId) || undefined,
        pending: payload.pending == null ? true : Boolean(payload.pending),
      };
    }
    return payload as Partial<ActivityEvent> & { ok?: boolean; taskId?: string; pending?: boolean };
  },

  async pollCheckValid(sourceId, taskId) {
    const query = taskId ? `?taskId=${encodeURIComponent(taskId)}` : "";
    const raw = await requireWorkerApi().get(
      `/logs/${encodeURIComponent(sourceId)}/check-valid${query}`,
      { force: true },
    );
    const payload = record(raw);
    const logRaw = payload.log;
    return {
      pending: payload.pending == null ? true : Boolean(payload.pending),
      done: Boolean(payload.done),
      failed: Boolean(payload.failed),
      state: string(payload.state) || undefined,
      log: logRaw ? normalizeActivity(logRaw) : undefined,
    };
  },
};

export function isDashboardDemoRequested(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return (
    params.get("dashboardDemo") === "1" ||
    params.get("dashboard-demo") === "1"
  );
}

export function readableApiError(error: unknown): string {
  const friendly = window.WorkerToast?.friendlyError?.(error);
  if (friendly) return friendly;
  if (error instanceof Error && error.message) return error.message;
  return "Не удалось загрузить данные Dashboard";
}
