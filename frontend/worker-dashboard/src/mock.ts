import type {
  ActivityEvent,
  DashboardOverview,
  DashboardPeriod,
  InventoryItem,
} from "./types";

/**
 * Uproject отдаёт hash в поле `icon`.
 * CDN и сборка URL — как в workerLogActionsService.serializeInventoryItem.
 */
function uprojectIconUrl(icon: string): string {
  const value = String(icon || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  const hash = value.replace(/\/\d+fx\d+f$/i, "");
  return `https://community.cloudflare.steamstatic.com/economy/image/${hash}/256fx256f`;
}

function fromUproject(input: {
  name: string;
  icon: string;
  priceUsd: number;
  amount?: number;
  rarity?: InventoryItem["rarity"];
  nameColor?: string;
}): InventoryItem {
  return {
    name: input.name,
    iconUrl: uprojectIconUrl(input.icon),
    priceUsd: input.priceUsd,
    amount: Math.max(1, input.amount || 1),
    rarity: input.rarity,
    nameColor: input.nameColor,
  };
}

/** Реальные icon-hash из Steam/Uproject (cs2SkinCatalog). */
const cs2Items: InventoryItem[] = [
  fromUproject({
    name: "PP-Bizon | Rust Coat (Battle-Scarred)",
    icon: "i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLzl4zv8x1a_s29fKFoLM-RHGaGztF-teB_VmewzE1zsmjdy936eSrDalJzCMF3ELZY50G6k9KzZryxsgPZiooUzX_7kGoXuQ0xTEKG",
    priceUsd: 37,
    rarity: "consumer",
    nameColor: "b0c3d9",
  }),
  fromUproject({
    name: "StatTrak™ M4A1-S | Nightmare (Well-Worn)",
    icon: "i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyL8ypexwjFS4_ega6F_H_OGMWrEwL9lj-9gSCGnmBw1tgKIn4vwNCaJaAJ1WZNwE-Rft0G8kIKyNui24lPcjoNFn3n3iCtMuHo447tWVfcjqbqX0V8N9uh_hA",
    priceUsd: 26.96,
    rarity: "covert",
    nameColor: "eb4b4b",
  }),
  fromUproject({
    name: "SG 553 | Ultraviolet (Well-Worn)",
    icon: "i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLimcO1qx1I4M2-fbZ9LPWsA2KUyPt7_uU-GXm2xB936mvVy9yqIijGbVNzCZZ0FOYNshDpltazP--24AHfiNhbjXKp9xIZCfI",
    priceUsd: 17.44,
    amount: 2,
    rarity: "classified",
    nameColor: "d32ce6",
  }),
  fromUproject({
    name: "Souvenir Sawed-Off | Rust Coat (Well-Worn)",
    icon: "i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLin4Hl-S1d6c2veZt-NPWWAlidxOp_pewnHnDqxk9-5jiEwtqueH-SP1AnCMQhFrQCtBC5xNznN-jq5Q3ajo8RnjK-0H1rgz-Cxw",
    priceUsd: 11.36,
    amount: 3,
    rarity: "industrial",
    nameColor: "5e98d9",
  }),
];

const extraItems: InventoryItem[] = [
  fromUproject({
    name: "StatTrak™ Five-SeveN | Nightshade (Well-Worn)",
    icon: "i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyL3l4Dl7idN6vyRYL1SJvycGWKC0tF7teVgWiT9lkt-tW3cmYyscH-XOFUmDpp0QeJcthHskIayY-Lk5FeI2ooRySqq3DQJsHhtu6HKAQ",
    priceUsd: 8.06,
    rarity: "restricted",
    nameColor: "8847ff",
  }),
  fromUproject({
    name: "PP-Bizon | Rust Coat (Battle-Scarred)",
    icon: "i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLzl4zv8x1a_s29fKFoLM-RHGaGztF-teB_VmewzE1zsmjdy936eSrDalJzCMF3ELZY50G6k9KzZryxsgPZiooUzX_7kGoXuQ0xTEKG",
    priceUsd: 5.6,
    rarity: "consumer",
    nameColor: "b0c3d9",
  }),
];

const baseEvents: ActivityEvent[] = [
  {
    id: "58319",
    sourceId: "58319",
    eventType: "log",
    username: "northwind_77",
    sourcePage: "falconspro.org/",
    status: "Валид",
    createdAt: "",
    priceUsd: 96.48,
    country: "DE",
    level: 42,
    accountTag: "priority",
    steamId: "76561199081304231",
    balanceUsd: 31.2,
    inventoryUsd: 65.28,
    saleStatus: "none",
    gamesCount: 38,
    lastPlayed: "",
    inventoryBreakdown: { tradable: 52.1, marketable: 47.82 },
    games: [
      {
        appid: 730,
        name: "Counter-Strike 2",
        itemCount: 7,
        inventoryUsd: 51.48,
        playtime: 18420,
        iconUrl:
          "https://cdn.cloudflare.steamstatic.com/steam/apps/730/library_600x900.jpg",
        imageUrl:
          "https://cdn.cloudflare.steamstatic.com/steam/apps/730/header.jpg",
      },
      {
        appid: 570,
        name: "Dota 2",
        itemCount: 3,
        inventoryUsd: 13.8,
        playtime: 6420,
        iconUrl:
          "https://cdn.cloudflare.steamstatic.com/steam/apps/570/library_600x900.jpg",
        imageUrl:
          "https://cdn.cloudflare.steamstatic.com/steam/apps/570/header.jpg",
      },
      {
        appid: 252490,
        name: "Rust",
        itemCount: 0,
        inventoryUsd: 0,
        playtime: 2100,
        iconUrl:
          "https://cdn.cloudflare.steamstatic.com/steam/apps/252490/library_600x900.jpg",
        imageUrl:
          "https://cdn.cloudflare.steamstatic.com/steam/apps/252490/header.jpg",
      },
      {
        appid: 440,
        name: "Team Fortress 2",
        itemCount: 0,
        inventoryUsd: 0,
        playtime: 980,
        iconUrl:
          "https://cdn.cloudflare.steamstatic.com/steam/apps/440/library_600x900.jpg",
        imageUrl:
          "https://cdn.cloudflare.steamstatic.com/steam/apps/440/header.jpg",
      },
    ],
    inventoryByAppid: {
      "730": {
        appid: 730,
        name: "Counter-Strike 2",
        itemCount: 7,
        totalUsd: 51.48,
        items: cs2Items,
      },
      "570": {
        appid: 570,
        name: "Dota 2",
        itemCount: 3,
        totalUsd: 13.8,
        items: extraItems,
      },
    },
  },
  {
    id: "58312",
    sourceId: "58312",
    eventType: "mafile",
    username: "orbit_signal",
    sourcePage: "demo-shop.example/login",
    status: "MaFile",
    createdAt: "",
    priceUsd: 74.2,
    country: "PL",
    level: 28,
    steamId: "76561199043940364",
    balanceUsd: 12.4,
    inventoryUsd: 38.6,
    processStatus: "none",
    mafileTime: new Date(Date.now() + 45 * 3600_000).toISOString(),
    sessionInvalid: true,
    sessionCheckedAt: "2026-08-26T10:33:00.000Z",
    gamesCount: 24,
    games: [
      {
        appid: 730,
        name: "Counter-Strike 2",
        itemCount: 2,
        inventoryUsd: 18.2,
        playtime: 4200,
      },
      {
        appid: 570,
        name: "Dota 2",
        itemCount: 1,
        inventoryUsd: 4.1,
        playtime: 1800,
      },
    ],
  },
  {
    id: "58298",
    sourceId: "58298",
    eventType: "log",
    username: "quiet_harbor",
    sourcePage: "steemcommunity.com/auth",
    status: "Валид",
    createdAt: "",
    priceUsd: 51.9,
    country: "NL",
    level: 17,
    steamId: "76561199112233445",
    balanceUsd: 8.15,
    inventoryUsd: 43.75,
    saleStatus: "pending",
    accountTag: "review",
    gamesCount: 11,
    inventoryBreakdown: { tradable: 31.2, marketable: 28.4 },
    games: [
      {
        appid: 730,
        name: "Counter-Strike 2",
        itemCount: 4,
        inventoryUsd: 43.75,
        playtime: 9100,
      },
    ],
  },
  {
    id: "58283",
    sourceId: "58283",
    eventType: "log",
    username: "helium_lane",
    sourcePage: "falconspro.org/offer",
    status: "Невалид",
    createdAt: "",
    priceUsd: 0,
    country: "SE",
    level: 9,
    steamId: "76561198887766554",
    balanceUsd: 0,
    inventoryUsd: 0,
  },
  {
    id: "58271",
    sourceId: "58271",
    eventType: "mafile",
    username: "pixel_station",
    sourcePage: "demo-shop.example/gift",
    status: "MaFile",
    createdAt: "",
    priceUsd: 42.36,
    country: "CZ",
    level: 21,
    steamId: "76561198776655443",
    balanceUsd: 3.2,
    inventoryUsd: 19.4,
    processStatus: "done",
    gamesCount: 9,
  },
  {
    id: "58255",
    sourceId: "58255",
    eventType: "log",
    username: "nova_drift",
    sourcePage: "steemcommunity.com/trade",
    status: "Валид",
    createdAt: "",
    priceUsd: 128.4,
    country: "US",
    level: 55,
    steamId: "76561198001122334",
    balanceUsd: 44.1,
    inventoryUsd: 84.3,
    saleStatus: "done",
    accountTag: "prime",
    gamesCount: 52,
    inventoryBreakdown: { tradable: 61.0, marketable: 55.2 },
    games: [
      {
        appid: 730,
        name: "Counter-Strike 2",
        itemCount: 12,
        inventoryUsd: 71.2,
        playtime: 22000,
      },
      {
        appid: 252490,
        name: "Rust",
        itemCount: 3,
        inventoryUsd: 13.1,
        playtime: 5400,
      },
    ],
  },
  {
    id: "58240",
    sourceId: "58240",
    eventType: "log",
    username: "ashen_relay",
    sourcePage: "falconspro.org/",
    status: "Валид",
    createdAt: "",
    priceUsd: 33.8,
    country: "FR",
    level: 14,
    steamId: "76561198990011223",
    balanceUsd: 5.6,
    inventoryUsd: 28.2,
    saleStatus: "none",
    gamesCount: 7,
  },
  {
    id: "58228",
    sourceId: "58228",
    eventType: "mafile",
    username: "copper_lane",
    sourcePage: "demo-shop.example/login",
    status: "MaFile",
    createdAt: "",
    priceUsd: 61.05,
    country: "UA",
    level: 33,
    steamId: "76561198665544332",
    balanceUsd: 1.1,
    inventoryUsd: 22.8,
    processStatus: "pending",
    gamesCount: 15,
  },
  {
    id: "58211",
    sourceId: "58211",
    eventType: "log",
    username: "mira_vault",
    sourcePage: "falconspro.org/login",
    status: "Валид",
    createdAt: "",
    priceUsd: 19.7,
    country: "IT",
    level: 6,
    steamId: "76561198554433221",
    balanceUsd: 0.74,
    inventoryUsd: 1.52,
    saleStatus: "pending",
    inventoryBreakdown: { tradable: 1.52, marketable: 1.52 },
    gamesCount: 4,
    games: [
      {
        appid: 730,
        name: "Counter-Strike 2",
        itemCount: 1,
        inventoryUsd: 1.52,
        playtime: 800,
      },
    ],
  },
  {
    id: "58199",
    sourceId: "58199",
    eventType: "log",
    username: "khuuchuur",
    sourcePage: "steemcommunity.com/",
    status: "Валид",
    createdAt: "",
    priceUsd: 21.02,
    country: "MN",
    level: 21,
    steamId: "76561198443322110",
    balanceUsd: 2.26,
    inventoryUsd: 18.76,
    saleStatus: "none",
    gamesCount: 16,
    games: [
      {
        appid: 730,
        name: "Counter-Strike 2",
        itemCount: 5,
        inventoryUsd: 18.76,
        playtime: 6400,
      },
    ],
  },
];

function withRelativeDates(
  events: ActivityEvent[],
  now = Date.now(),
): ActivityEvent[] {
  return events.map((event, index) => ({
    ...event,
    createdAt: new Date(now - (index * 3 + 1) * 3600_000).toISOString(),
    lastPlayed:
      event.lastPlayed ||
      new Date(now - (index * 5 + 8) * 3600_000).toISOString(),
  }));
}

export function createMockOverview(period: DashboardPeriod): DashboardOverview {
  const events = withRelativeDates(baseEvents);
  return {
    currency: { rate: 1, globalCurrency: "USD" },
    user: {
      telegramId: "1029384756",
      username: "demo_operator",
      firstName: "Алекс",
      profitPercent: 18,
      daysWithTeam: 47,
      walletUsd: 1842.68,
      profitTotalUsd: 12840.55,
      operationsTotal: 312,
      maxShareUsd: 420,
    },
    kpi: {
      profitTodayUsd: 186.4,
      profitTotalDeltaPct: 8.2,
      profitPeriodDeltaPct: 12.4,
      logsDeltaPct: 6.1,
      mafileDeltaPct: -2.4,
      profitPeriodUsd: period === 7 ? 842.1 : period === 14 ? 1640.2 : 3120.5,
      totalLogs: 1840,
      todayLogs: 12,
      logsPeriod: period === 7 ? 86 : period === 14 ? 164 : 312,
      mafileTotal: 420,
      todayMafile: 3,
      mafilePeriod: period === 7 ? 18 : period === 14 ? 34 : 62,
    },
    days: period,
    series: Array.from({ length: period }, (_, index) => {
      const date = new Date();
      date.setHours(12, 0, 0, 0);
      date.setDate(date.getDate() - (period - 1 - index));
      return {
        date: date.toISOString().slice(0, 10),
        totalUsd: 40 + index * 3.2 + (index % 4) * 8,
        profitUsd: 18 + index * 1.4 + (index % 3) * 4,
        logsUsd: 12 + index * 0.8,
        logsCount: 2 + (index % 5),
        mafileCount: index % 3,
      };
    }),
    recentLogs: events.filter((event) => event.eventType === "log"),
    recentMafiles: events.filter((event) => event.eventType === "mafile"),
    panelUsername: "demo_operator",
    logsError: null,
  };
}

export function findMockEvent(sourceId: string): ActivityEvent | undefined {
  return withRelativeDates(baseEvents).find(
    (event) => event.sourceId === sourceId || event.id === sourceId,
  );
}
