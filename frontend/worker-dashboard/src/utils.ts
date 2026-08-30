import { dashboardLanguage } from "./copy";
import type {
  ActivityEvent,
  ActivityFilters,
  ActivityStatus,
  DashboardOverview,
  DashboardRenderContext,
  InventoryGroup,
  SkinRarity,
} from "./types";

export function formatMoney(value: number): string {
  if (window.WorkerFormat?.money) return window.WorkerFormat.money(value);
  return new Intl.NumberFormat(dashboardLanguage() === "ru" ? "ru-RU" : "en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

export function formatDate(value: string): string {
  if (window.WorkerFormat?.date) return window.WorkerFormat.date(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(dashboardLanguage() === "ru" ? "ru-RU" : "en-US", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function shortDate(value: string): string {
  if (window.WorkerFormat?.shortDayLabel) {
    return window.WorkerFormat.shortDayLabel(value);
  }
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(dashboardLanguage() === "ru" ? "ru-RU" : "en-US", {
    day: "numeric",
    month: "short",
  });
}

export function chartDayLabel(isoDate: string): string {
  if (window.WorkerFormat?.chartDayLabel) {
    return window.WorkerFormat.chartDayLabel(isoDate);
  }
  if (!isoDate) return "";
  const date = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}`;
}

export function moneyTick(usdAmount: number): string {
  if (window.WorkerFormat?.moneyTick) {
    return window.WorkerFormat.moneyTick(usdAmount);
  }
  return `$${Math.round(Number(usdAmount) || 0)}`;
}

export function displayName(
  context: DashboardRenderContext,
  overview?: DashboardOverview | null,
): string {
  return (
    context.user.firstName ||
    context.user.username ||
    overview?.user.firstName ||
    overview?.user.username ||
    String(context.user.telegramId || overview?.user.telegramId || "—")
  );
}

export type AccountStatusKind =
  | "invalid"
  | "mafile"
  | "valid"
  | "on_sale"
  | "sold"
  | "empty"
  | "hold"
  | "processing"
  | "processed"
  | "locked"
  | "other";

function compactStatus(status: string): string {
  return String(status || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");
}

export function classifyAccountStatus(status: string): AccountStatusKind {
  const raw = compactStatus(status);
  if (!raw || raw === "—" || raw === "-" || raw === "none") return "other";
  if (
    /invalidsession|invalid session|невалидная сессия/.test(raw) ||
    /invalidrcode|invalid rcode|неверн\w* rcode/.test(raw) ||
    /невалид|invalid|declined|error/.test(raw)
  ) {
    return "invalid";
  }
  if (/(^sold$|продан)/.test(raw) && !/продаж|прода[её]тся/.test(raw)) return "sold";
  if (/onsell|on sell|на продаж|прода[её]тся/.test(raw)) return "on_sale";
  if (/^empty$|пуст/.test(raw)) return "empty";
  if (/onhold|on hold|удержан|холд/.test(raw)) return "hold";
  if (/^processed$|^обработан$/.test(raw)) return "processed";
  if (
    /processing|on processing|onhandle|on handle|на снятии|в обработ|обрабатыва/.test(
      raw,
    )
  ) {
    return "processing";
  }
  if (/mafile/.test(raw)) return "mafile";
  if (/^(ok|valid|валид|лог)$|approved/.test(raw)) return "valid";
  if (/redlocked|^кт$|locked|заблок/.test(raw)) return "locked";
  return "other";
}

export function normalizeActivityStatus(status: string): ActivityStatus {
  const kind = classifyAccountStatus(status);
  if (kind === "invalid") return "invalid";
  if (kind === "mafile") return "mafile";
  if (kind === "valid") return "valid";
  return "other";
}

export function isSoldEvent(
  row: Pick<ActivityEvent, "saleStatus" | "status">,
): boolean {
  const sale = String(row.saleStatus || "").toLowerCase();
  return (
    sale === "done" ||
    sale === "sold" ||
    /продан|sold/.test(sale) ||
    classifyAccountStatus(row.status) === "sold"
  );
}

export function isOnSaleEvent(
  row: Pick<ActivityEvent, "saleStatus" | "status">,
): boolean {
  if (classifyAccountStatus(row.status) === "on_sale") return true;
  const sale = String(row.saleStatus || "").toLowerCase();
  return (
    sale === "pending" ||
    sale === "onsell" ||
    sale === "on_sell" ||
    sale === "on_sale" ||
    /на\s*продаж|onsell|on[_-]?sell|прода[её]тся/.test(sale)
  );
}

export function isProcessedEvent(
  row: Pick<ActivityEvent, "processStatus">,
): boolean {
  const process = String(row.processStatus || "").toLowerCase();
  return (
    process === "done" ||
    process === "processed" ||
    /отработан|processed/.test(process)
  );
}

export function matchesActivityFilter(
  row: ActivityEvent,
  status: ActivityFilters["status"],
): boolean {
  if (status === "all") return true;
  if (status === "sold") return isSoldEvent(row);
  if (status === "on_sale") return isOnSaleEvent(row);
  if (status === "processed") return isProcessedEvent(row);
  if (status === "invalid") {
    return (
      Boolean(row.sessionInvalid) ||
      normalizeActivityStatus(row.status) === "invalid"
    );
  }
  if (status === "mafile") {
    return (
      classifyAccountStatus(row.status) === "mafile" ||
      (row.eventType === "mafile" && classifyAccountStatus(row.status) === "other")
    );
  }
  if (status === "other") {
    if (isSoldEvent(row) || isOnSaleEvent(row) || isProcessedEvent(row)) {
      return false;
    }
    const kind = classifyAccountStatus(row.status);
    return kind === "other" || kind === "empty" || kind === "hold" || kind === "locked";
  }
  return normalizeActivityStatus(row.status) === status;
}

export function lifecycleBadge(
  row: ActivityEvent,
):
  | { key: "sold"; labelKey: "activity.sold" }
  | { key: "on_sale"; labelKey: "activity.onSale" }
  | { key: "processed"; labelKey: "activity.processed" }
  | null {
  if (isSoldEvent(row)) return { key: "sold", labelKey: "activity.sold" };
  if (isOnSaleEvent(row)) return { key: "on_sale", labelKey: "activity.onSale" };
  if (isProcessedEvent(row)) {
    return { key: "processed", labelKey: "activity.processed" };
  }
  return null;
}

export function combineActivity(overview: DashboardOverview): ActivityEvent[] {
  const rows = [...overview.recentLogs, ...overview.recentMafiles];
  const unique = new Map<string, ActivityEvent>();
  for (const row of rows) {
    unique.set(`${row.eventType}:${row.id || row.sourceId}`, row);
  }
  return [...unique.values()].sort(
    (left, right) =>
      new Date(right.createdAt || 0).getTime() -
      new Date(left.createdAt || 0).getTime(),
  );
}

export function activityLookupId(query: string): string {
  const raw = String(query || "").trim().replace(/^#/, "");
  return /^\d{4,}$/.test(raw) ? raw : "";
}

export function mergeLookupActivity(
  base: ActivityEvent[],
  extra: ActivityEvent[],
): ActivityEvent[] {
  if (!extra.length) return base;
  const seen = new Set(
    base.map((row) => String(row.sourceId || row.id || "")).filter(Boolean),
  );
  const prepend = extra.filter((row) => {
    const key = String(row.sourceId || row.id || "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return prepend.length ? [...prepend, ...base] : base;
}

export function filterActivities(
  rows: ActivityEvent[],
  filters: ActivityFilters,
): ActivityEvent[] {
  const query = filters.query.trim().toLowerCase().replace(/^#/, "");
  const filtered = rows.filter((row) => {
    if (filters.type !== "all" && row.eventType !== filters.type) return false;
    if (!matchesActivityFilter(row, filters.status)) return false;
    if (!query) return true;
    return [
      row.id,
      row.sourceId,
      row.username,
      row.sourcePage,
      row.accountTag,
      row.country,
      row.steamId,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });

  return filtered.sort((left, right) => {
    if (filters.sort.startsWith("price")) {
      const direction = filters.sort === "price-asc" ? 1 : -1;
      return (left.priceUsd - right.priceUsd) * direction;
    }
    const direction = filters.sort === "date-asc" ? 1 : -1;
    return (
      (new Date(left.createdAt || 0).getTime() -
        new Date(right.createdAt || 0).getTime()) *
      direction
    );
  });
}

export function mergeActivity(
  original: ActivityEvent,
  patch: Partial<ActivityEvent>,
): ActivityEvent {
  return {
    ...original,
    ...patch,
    id: patch.id || original.id,
    sourceId: patch.sourceId || original.sourceId,
    eventType: patch.eventType || original.eventType,
    mafileTime: patch.mafileTime || original.mafileTime,
    mafileSessionHoursLeft:
      patch.mafileSessionHoursLeft ?? original.mafileSessionHoursLeft,
    sessionInvalid:
      patch.sessionInvalid ?? original.sessionInvalid,
    sessionCheckedAt: patch.sessionCheckedAt || original.sessionCheckedAt,
    inventoryByAppid:
      patch.inventoryByAppid || original.inventoryByAppid || {},
    games: patch.games || original.games || [],
    topItems: patch.topItems || original.topItems || [],
  };
}

export function inventoryGroups(event: ActivityEvent): InventoryGroup[] {
  const groups = new Map<string, InventoryGroup>();
  for (const [key, value] of Object.entries(event.inventoryByAppid || {})) {
    groups.set(String(value.appid || key || value.name), {
      ...value,
      items: value.items || [],
      itemCount: value.itemCount || value.items?.length || 0,
    });
  }
  for (const game of event.games || []) {
    const key = String(game.appid || game.name);
    if (groups.has(key)) continue;
    groups.set(key, {
      appid: game.appid,
      name: game.name,
      itemCount: game.itemCount || 0,
      totalUsd: game.inventoryUsd || 0,
      inventoryUsd: game.inventoryUsd || 0,
      items: [],
      vac: Boolean(game.vac),
    });
  }
  return [...groups.values()].sort(
    (left, right) =>
      right.totalUsd - left.totalUsd || right.itemCount - left.itemCount,
  );
}

export function hoursSince(value: string): number {
  const stamp = new Date(value || 0).getTime();
  if (!Number.isFinite(stamp) || stamp <= 0) return 0;
  return Math.max(0, Math.floor((Date.now() - stamp) / 3_600_000));
}

/** Remaining MaFile session hours from UProject `mafileTime`, not log createdAt. */
export function mafileHoursLeft(
  event: Pick<
    ActivityEvent,
    "mafileTime" | "mafileSessionHoursLeft"
  >,
  now = Date.now(),
): number {
  const raw = String(event.mafileTime || "").trim();
  if (raw) {
    const asNumber = Number(raw);
    const looksNumeric =
      Number.isFinite(asNumber) && !/[T:-]/i.test(raw) && asNumber < 10000;
    if (looksNumeric) return Math.max(0, Math.ceil(asNumber));
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
      return Math.max(0, Math.ceil((date.getTime() - now) / 3_600_000));
    }
  }
  const cached = Number(event.mafileSessionHoursLeft);
  return Number.isFinite(cached) && cached > 0 ? Math.ceil(cached) : 0;
}

const COUNTRY_ALIASES: Record<string, string> = {
  UK: "GB",
  EN: "GB",
  GB: "GB",
  USA: "US",
  US: "US",
  RUSSIA: "RU",
  RF: "RU",
  "РОССИЯ": "RU",
  РФ: "RU",
  UKRAINE: "UA",
  "УКРАИНА": "UA",
  BELARUS: "BY",
  "БЕЛАРУСЬ": "BY",
  KAZAKHSTAN: "KZ",
  "КАЗАХСТАН": "KZ",
  POLAND: "PL",
  "ПОЛЬША": "PL",
  GERMANY: "DE",
  "ГЕРМАНИЯ": "DE",
};

export function normalizeCountryCode(code?: string): string {
  const raw = String(code || "").trim().toUpperCase();
  if (!raw) return "";
  if (COUNTRY_ALIASES[raw]) return COUNTRY_ALIASES[raw];
  return /^[A-Z]{2}$/.test(raw) ? raw : "";
}

/** Unicode regional indicators — often render as letters on Windows. Prefer CountryFlag img. */
export function countryFlag(code?: string): string {
  const raw = normalizeCountryCode(code);
  if (!raw) return String(code || "").trim();
  return String.fromCodePoint(
    ...[...raw].map((char) => 127397 + char.charCodeAt(0)),
  );
}

export function countryFlagUrl(code?: string, size: "w20" | "w40" = "w20"): string {
  const raw = normalizeCountryCode(code).toLowerCase();
  if (!raw) return "";
  return `https://flagcdn.com/${size}/${raw}.png`;
}

export function countryFlagFallbackUrl(code?: string): string {
  const raw = normalizeCountryCode(code);
  if (!raw) return "";
  return `https://purecatamphetamine.github.io/country-flag-icons/3x2/${raw}.svg`;
}

export function signedPercent(value: number): string {
  const rounded = Number(value || 0).toFixed(1).replace(/\.0$/, "");
  return `${value > 0 ? "+" : ""}${rounded}%`;
}

const NAME_COLOR_RARITY: Record<string, SkinRarity> = {
  b0c3d9: "consumer",
  "5e98d9": "industrial",
  "4b69ff": "milspec",
  "8847ff": "restricted",
  d32ce6: "classified",
  eb4b4b: "covert",
  e4ae39: "extraordinary",
  ffd700: "contraband",
  cf6a32: "contraband",
};

const RARITY_ALIASES: Record<string, SkinRarity> = {
  consumer: "consumer",
  "consumer grade": "consumer",
  industrial: "industrial",
  "industrial grade": "industrial",
  milspec: "milspec",
  "mil-spec": "milspec",
  "mil-spec grade": "milspec",
  restricted: "restricted",
  classified: "classified",
  covert: "covert",
  extraordinary: "extraordinary",
  contraband: "contraband",
  rare: "extraordinary",
  "exceedingly rare": "extraordinary",
  ancient: "extraordinary",
  immortal: "extraordinary",
  arcana: "extraordinary",
};

/** Soft Steam-market glow behind skin icons. */
export function resolveSkinRarity(input: {
  rarity?: SkinRarity | string | null;
  nameColor?: string | null;
  name?: string;
  priceUsd?: number;
}): SkinRarity {
  const explicit = String(input.rarity || "")
    .trim()
    .toLowerCase();
  if (explicit && RARITY_ALIASES[explicit]) return RARITY_ALIASES[explicit];

  const hex = String(input.nameColor || "")
    .trim()
    .replace(/^#/, "")
    .toLowerCase();
  if (hex && NAME_COLOR_RARITY[hex]) return NAME_COLOR_RARITY[hex];

  const name = String(input.name || "");
  if (
    /\b(★|knife|gloves|karambit|bayonet|butterfly|talon|skeleton|nomad|paracord|survival|ursus|stiletto|navaja|shadow daggers|classic knife|kukri|sport gloves|driver gloves|hand wraps|moto gloves|specialist gloves|hydra gloves|broken fang|bloodhound)\b/i.test(
      name,
    )
  ) {
    return "extraordinary";
  }
  if (/\b(covert|ножа|нож)\b/i.test(name)) return "covert";
  if (/\b(classified|засекречен)\b/i.test(name)) return "classified";
  if (/\b(restricted|запрещён|запрещен)\b/i.test(name)) return "restricted";
  if (/\b(mil-?spec|армейск)\b/i.test(name)) return "milspec";

  if (/nightmare|asiimov|howl|fade|doppler|marble fade|crimson web/i.test(name)) {
    return "covert";
  }
  if (/ultraviolet|redline|vulcan|cyrex|hyper beast|neon revolution/i.test(name)) {
    return "classified";
  }
  if (/nightshade|torque|fuel injector|frontside misty|brain drain/i.test(name)) {
    return "restricted";
  }
  if (/rust coat|safari mesh|forest ddpat|urban ddpat|groundwater/i.test(name)) {
    return "consumer";
  }

  const price = Number(input.priceUsd) || 0;
  if (price >= 80) return "extraordinary";
  if (price >= 25) return "covert";
  if (price >= 12) return "classified";
  if (price >= 5) return "restricted";
  if (price >= 1.5) return "milspec";
  if (price >= 0.4) return "industrial";
  return "consumer";
}

export function skinRarityRank(rarity: SkinRarity | string | undefined): number {
  const key = String(rarity || "").toLowerCase() as SkinRarity;
  const rank: Record<SkinRarity, number> = {
    contraband: 0,
    extraordinary: 1,
    covert: 2,
    classified: 3,
    restricted: 4,
    milspec: 5,
    industrial: 6,
    consumer: 7,
  };
  return rank[key] ?? 8;
}

export function compareInventoryByRarity(
  left: { rarity?: SkinRarity | string; name?: string; nameColor?: string; priceUsd?: number },
  right: { rarity?: SkinRarity | string; name?: string; nameColor?: string; priceUsd?: number },
): number {
  const leftRank = skinRarityRank(resolveSkinRarity(left));
  const rightRank = skinRarityRank(resolveSkinRarity(right));
  return leftRank - rightRank || Number(right.priceUsd || 0) - Number(left.priceUsd || 0);
}

