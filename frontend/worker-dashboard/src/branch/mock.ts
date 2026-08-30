import type { TrendPoint } from "../types";
import type {
  Achievement,
  AuditEvent,
  BranchApplication,
  BranchDomain,
  BranchInvite,
  BranchManual,
  BranchMemberRow,
  BranchTemplate,
  CustomRole,
  TopWorker,
  TopWorkerPeriod,
} from "./types";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function daysAgoIso(days: number) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Deterministic pseudo-random in [0, 1) from seed + index. */
function unit(seed: number, i: number) {
  const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function makeBranchSeries(
  days: number,
  seed = 42,
): TrendPoint[] {
  const points: TrendPoint[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const u = unit(seed, i);
    const logsCount = Math.floor(4 + u * 28);
    const mafileCount = Math.floor(1 + unit(seed + 1, i) * 8);
    const profitUsd = Math.round((80 + u * 920 + logsCount * 12) * 100) / 100;
    const logsUsd = Math.round(profitUsd * 0.62 * 100) / 100;
    points.push({
      date: daysAgoIso(i),
      totalUsd: profitUsd,
      profitUsd,
      logsUsd,
      logsCount,
      mafileCount,
    });
  }
  return points;
}

function seriesBundle(seed: number): BranchApplication["profitsSeries"] {
  return {
    "7": makeBranchSeries(7, seed),
    "14": makeBranchSeries(14, seed + 3),
    all: makeBranchSeries(30, seed + 7),
  };
}

export const ACHIEVEMENTS_CATALOG: Achievement[] = [
  {
    id: "first_profit",
    title: "Первый профит",
    description: "Филиал зафиксировал первый успешный профит.",
    icon: "CircleDollarSign",
    unlocked: true,
    unlockedAt: "2026-03-14",
  },
  {
    id: "week_streak",
    title: "Неделя подряд",
    description: "Профиты каждый день в течение 7 дней.",
    icon: "Flame",
    unlocked: true,
    unlockedAt: "2026-05-02",
  },
  {
    id: "ten_members",
    title: "Десятка",
    description: "В команде 10 и более участников.",
    icon: "Users",
    unlocked: true,
    unlockedAt: "2026-06-18",
    progressHint: "Нужно 10 участников",
  },
  {
    id: "hundred_logs",
    title: "Сто логов",
    description: "Суммарно 100 валидных логов по филиалу.",
    icon: "FileKey2",
    unlocked: true,
    unlockedAt: "2026-07-09",
  },
  {
    id: "fifty_k",
    title: "$50K командой",
    description: "Общий профит филиала превысил $50 000.",
    icon: "Trophy",
    unlocked: false,
    progressHint: "Нужно $50 000 суммарно",
  },
  {
    id: "full_roster",
    title: "Полный состав",
    description: "25 активных участников одновременно.",
    icon: "Shield",
    unlocked: false,
    progressHint: "Нужно 25 участников",
  },
  {
    id: "domain_live",
    title: "Свой домен",
    description: "Подключён и подтверждён командный домен.",
    icon: "Globe",
    unlocked: false,
    progressHint: "Нужен активный домен",
  },
  {
    id: "manual_library",
    title: "База знаний",
    description: "Опубликовано 5 мануалов для команды.",
    icon: "BookOpen",
    unlocked: false,
    progressHint: "Нужно 5 мануалов",
  },
];

export const MOCK_MEMBERS: BranchMemberRow[] = [
  {
    id: "m1",
    username: "northwind",
    profits: 12480,
    joinedDays: 167,
    role: "owner",
    avatarUrl: "https://api.dicebear.com/9.x/thumbs/svg?seed=northwind&backgroundColor=00c48c",
    telegramId: "100001",
  },
  {
    id: "m2",
    username: "demo_operator",
    profits: 8320.5,
    joinedDays: 94,
    role: "deputy",
    avatarUrl: "https://api.dicebear.com/9.x/thumbs/svg?seed=demo_operator&backgroundColor=38bdf8",
    percentOverride: 3,
    telegramId: "100002",
  },
  {
    id: "m3",
    username: "kira_eu",
    profits: 6104,
    joinedDays: 71,
    role: "recruiter",
    avatarUrl: "https://api.dicebear.com/9.x/thumbs/svg?seed=kira_eu&backgroundColor=e879c0",
    telegramId: "100003",
  },
  {
    id: "m4",
    username: "voss",
    profits: 4982.2,
    joinedDays: 58,
    role: "member",
    telegramId: "100004",
  },
  {
    id: "m5",
    username: "lane",
    profits: 3710,
    joinedDays: 41,
    role: "member",
    avatarUrl: "https://api.dicebear.com/9.x/thumbs/svg?seed=lane&backgroundColor=a78bfa",
  },
  {
    id: "m6",
    username: "rift",
    profits: 2944.8,
    joinedDays: 33,
    role: "member",
  },
  {
    id: "m7",
    username: "opal",
    profits: 1810,
    joinedDays: 19,
    role: "member",
    avatarUrl: "https://api.dicebear.com/9.x/thumbs/svg?seed=opal&backgroundColor=fb7185",
  },
  {
    id: "m8",
    username: "noxo",
    profits: 920.4,
    joinedDays: 8,
    role: "member",
  },
];

export const MOCK_APPLICATIONS: BranchApplication[] = [
  {
    id: "a1",
    username: "nova_eu",
    avatarUrl: "https://api.dicebear.com/9.x/thumbs/svg?seed=nova_eu&backgroundColor=2dd4bf",
    note: "Есть опыт с EU-трафиком, 2 года. Готов к ночным сменам.",
    profitsTotal: 4120.4,
    profitsSeries: seriesBundle(11),
    daysActive: 86,
    appliedAt: "2026-08-24T14:20:00.000Z",
    status: "pending",
  },
  {
    id: "a2",
    username: "pixelrun",
    note: "Ищу стабильную команду. Работаю аккуратно, без шума.",
    profitsTotal: 1880,
    profitsSeries: seriesBundle(22),
    daysActive: 34,
    appliedAt: "2026-08-25T09:05:00.000Z",
    status: "pending",
  },
  {
    id: "a3",
    username: "slate_ops",
    avatarUrl: "https://api.dicebear.com/9.x/thumbs/svg?seed=slate_ops&backgroundColor=e8b86d",
    note: "Мобильный трафик + короткие сессии. Есть свои связки.",
    profitsTotal: 2755.75,
    profitsSeries: seriesBundle(33),
    daysActive: 51,
    appliedAt: "2026-08-25T18:40:00.000Z",
    status: "pending",
  },
  {
    id: "a4",
    username: "helix_bot",
    avatarUrl: "https://api.dicebear.com/9.x/thumbs/svg?seed=helix_bot&backgroundColor=86efac",
    note: "Был в другой команде, хочу стабильный EU.",
    profitsTotal: 960,
    profitsSeries: seriesBundle(44),
    daysActive: 120,
    appliedAt: "2026-08-18T11:00:00.000Z",
    status: "accepted",
    decidedAt: "2026-08-19T09:30:00.000Z",
    decidedBy: "@northwind",
  },
  {
    id: "a5",
    username: "quietfox",
    note: "Только мобилка, мало опыта.",
    profitsTotal: 210,
    profitsSeries: seriesBundle(55),
    daysActive: 12,
    appliedAt: "2026-08-20T16:10:00.000Z",
    status: "rejected",
    decidedAt: "2026-08-21T08:00:00.000Z",
    decidedBy: "@kira_eu",
  },
  {
    id: "a6",
    username: "drift_nl",
    avatarUrl: "https://api.dicebear.com/9.x/thumbs/svg?seed=drift_nl&backgroundColor=5ec8ff",
    note: "NL/BE трафик, готов к тестовой неделе.",
    profitsTotal: 1540,
    profitsSeries: seriesBundle(66),
    daysActive: 45,
    appliedAt: "2026-08-12T13:22:00.000Z",
    status: "accepted",
    decidedAt: "2026-08-13T10:15:00.000Z",
    decidedBy: "@northwind",
  },
  {
    id: "a7",
    username: "spam_low",
    note: "Быстрый вход без собеса.",
    profitsTotal: 40,
    profitsSeries: seriesBundle(77),
    daysActive: 3,
    appliedAt: "2026-08-22T20:00:00.000Z",
    status: "rejected",
    decidedAt: "2026-08-22T21:05:00.000Z",
    decidedBy: "@demo_operator",
  },
];

export const BRANCH_SERIES_7 = makeBranchSeries(7, 101);
export const BRANCH_SERIES_14 = makeBranchSeries(14, 102);
export const BRANCH_SERIES_30 = makeBranchSeries(30, 103);

function topRow(
  id: string,
  username: string,
  profits: number,
  color?: string,
  opts?: { isAnonymous?: boolean; fakeProfitTag?: string },
): TopWorker {
  return {
    id,
    username,
    profits,
    isAnonymous: opts?.isAnonymous,
    fakeProfitTag: opts?.fakeProfitTag,
    avatarUrl:
      opts?.isAnonymous
        ? undefined
        : color
          ? `https://api.dicebear.com/9.x/thumbs/svg?seed=${username}&backgroundColor=${color}`
          : undefined,
  };
}

export const TOP_WORKERS: Record<TopWorkerPeriod, TopWorker[]> = {
  day: [
    topRow("t1", "kira_eu", 412.5, "e879c0"),
    topRow("t2", "demo_operator", 288, "38bdf8"),
    topRow("t3", "aelita", 196.2, undefined, {
      isAnonymous: true,
      fakeProfitTag: "aelita",
    }),
    topRow("t4", "lane", 174, "a78bfa"),
    topRow("t5", "rift", 141.8),
  ],
  "7d": [
    topRow("t1", "demo_operator", 2140, "38bdf8"),
    topRow("t2", "kira_eu", 1892, "e879c0"),
    topRow("t3", "nox42", 1210, undefined, {
      isAnonymous: true,
      fakeProfitTag: "nox42",
    }),
    topRow("t4", "voss", 980),
    topRow("t5", "rift", 744.8),
  ],
  all: [
    topRow("t1", "northwind", 12480, "00c48c"),
    topRow("t2", "demo_operator", 8320.5, "38bdf8"),
    topRow("t3", "aelita", 6104, undefined, {
      isAnonymous: true,
      fakeProfitTag: "aelita",
    }),
    topRow("t4", "voss", 4982.2),
    topRow("t5", "lane", 3710, "a78bfa"),
  ],
};

export const CUSTOM_ROLES: CustomRole[] = [
  {
    id: "owner",
    name: "Владелец",
    locked: true,
    permissions: [
      "manage_members",
      "manage_apps",
      "invite_members",
      "edit_manuals",
      "edit_templates",
      "view_audit",
      "manage_domain",
      "set_percents",
    ],
  },
  {
    id: "deputy",
    name: "Зам",
    locked: true,
    permissions: [
      "manage_members",
      "manage_apps",
      "invite_members",
      "edit_manuals",
      "edit_templates",
      "view_audit",
      "set_percents",
    ],
  },
  {
    id: "recruiter",
    name: "Рекрутер",
    locked: true,
    permissions: ["manage_apps", "invite_members"],
  },
  {
    id: "member",
    name: "Участник",
    locked: true,
    permissions: [],
  },
];

export const AUDIT_EVENTS: AuditEvent[] = [
  {
    id: "e1",
    at: "2026-08-25T19:12:00.000Z",
    actor: "@northwind",
    action: "Принял заявку",
    target: "@slate_ops",
    detail: "Роль: Участник",
    category: "apps",
  },
  {
    id: "e2",
    at: "2026-08-24T11:40:00.000Z",
    actor: "@demo_operator",
    action: "Изменил процент",
    target: "@lane",
    detail: "3% → 4%",
    category: "members",
  },
  {
    id: "e3",
    at: "2026-08-23T16:05:00.000Z",
    actor: "@northwind",
    action: "Повысил роль",
    target: "@kira_eu",
    detail: "Участник → Рекрутер",
    category: "roles",
  },
  {
    id: "e4",
    at: "2026-08-22T09:18:00.000Z",
    actor: "@kira_eu",
    action: "Отклонил заявку",
    target: "@ghost_wave",
    category: "apps",
  },
  {
    id: "e5",
    at: "2026-08-20T14:55:00.000Z",
    actor: "@northwind",
    action: "Обновил шаблон",
    target: "Онбординг EU",
    category: "other",
  },
  {
    id: "e6",
    at: "2026-08-18T20:02:00.000Z",
    actor: "@demo_operator",
    action: "Выгнал участника",
    target: "@mist",
    detail: "Неактивность 21 день",
    category: "members",
  },
  {
    id: "e7",
    at: "2026-08-15T12:30:00.000Z",
    actor: "@northwind",
    action: "Добавил домен",
    target: "north.team",
    detail: "Ожидает NS",
    category: "other",
  },
  {
    id: "e8",
    at: "2026-08-12T08:44:00.000Z",
    actor: "@opal",
    action: "Покинул филиал",
    category: "members",
  },
  {
    id: "e9",
    at: "2026-08-10T17:21:00.000Z",
    actor: "@northwind",
    action: "Создал роль",
    target: "Рекрутер",
    category: "roles",
  },
  {
    id: "e10",
    at: "2026-08-05T10:00:00.000Z",
    actor: "@northwind",
    action: "Опубликовал мануал",
    target: "Стартовый чеклист",
    category: "other",
  },
];

const HTML_STEAM_LOGIN = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sign in</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; display: grid; place-items: center;
      font-family: system-ui, sans-serif; background: #1b2838; color: #c7d5e0;
    }
    .card {
      width: min(360px, 92vw); padding: 28px; border-radius: 4px;
      background: #171a21; box-shadow: 0 12px 40px rgba(0,0,0,.45);
    }
    h1 { margin: 0 0 18px; font-size: 18px; font-weight: 500; }
    label { display: block; margin: 0 0 6px; font-size: 12px; color: #8f98a0; }
    input {
      width: 100%; margin: 0 0 14px; padding: 10px 12px; border: 0; border-radius: 3px;
      background: #32353c; color: #fff;
    }
    button {
      width: 100%; padding: 12px; border: 0; border-radius: 2px;
      background: #67c1f5; color: #101822; font-weight: 650; cursor: pointer;
    }
  </style>
</head>
<body>
  <form class="card">
    <h1>Войти</h1>
    <label>Имя аккаунта</label>
    <input name="username" autocomplete="username" />
    <label>Пароль</label>
    <input type="password" name="password" autocomplete="current-password" />
    <button type="submit">Войти</button>
  </form>
</body>
</html>`;

const HTML_GATE = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Access</title>
  <style>
    body {
      margin: 0; min-height: 100vh; display: grid; place-items: center;
      font-family: Geist, system-ui, sans-serif; background: #0a0a0a; color: #ededed;
    }
    .box {
      width: min(420px, 92vw); padding: 32px; border-radius: 16px;
      border: 1px solid rgba(255,255,255,.08); background: #111;
    }
    .accent { color: #00c48c; font-size: 12px; font-weight: 650; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: 10px 0 8px; font-size: 26px; letter-spacing: -.04em; }
    p { margin: 0 0 18px; color: #888; font-size: 14px; line-height: 1.45; }
    a {
      display: inline-flex; padding: 10px 16px; border-radius: 10px;
      background: #00c48c; color: #04140e; text-decoration: none; font-weight: 650;
    }
  </style>
</head>
<body>
  <div class="box">
    <div class="accent">Team domain</div>
    <h1>Доступ только для филиала</h1>
    <p>Эта страница видна участникам команды. Подставьте свой CTA и трекинг.</p>
    <a href="#">Продолжить</a>
  </div>
</body>
</html>`;

const HTML_MOBILE = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mobile</title>
  <style>
    body {
      margin: 0; min-height: 100vh; background: linear-gradient(180deg, #0e2430, #050505);
      color: #fff; font-family: system-ui, sans-serif; display: grid; place-items: end center;
      padding: 24px;
    }
    .sheet {
      width: min(390px, 100%); padding: 20px; border-radius: 20px 20px 0 0;
      background: rgba(17,17,17,.92); backdrop-filter: blur(12px);
    }
    h1 { margin: 0 0 8px; font-size: 20px; }
    p { margin: 0 0 16px; color: #9a9a9a; font-size: 13px; }
    button {
      width: 100%; padding: 14px; border: 0; border-radius: 12px;
      background: #2dd4bf; color: #042f2e; font-weight: 700;
    }
  </style>
</head>
<body>
  <div class="sheet">
    <h1>Быстрый вход</h1>
    <p>Мобильный шаблон для коротких сессий филиала.</p>
    <button type="button">Открыть</button>
  </div>
</body>
</html>`;

export const BRANCH_TEMPLATES: BranchTemplate[] = [
  {
    id: "tpl1",
    title: "Steam Login",
    slug: "steam-login",
    html: HTML_STEAM_LOGIN,
    updatedAt: "2026-08-20",
  },
  {
    id: "tpl2",
    title: "Team Gate",
    slug: "gate",
    html: HTML_GATE,
    updatedAt: "2026-08-18",
  },
  {
    id: "tpl3",
    title: "Mobile Sheet",
    slug: "mobile",
    html: HTML_MOBILE,
    updatedAt: "2026-08-10",
  },
];

export const BRANCH_MANUALS: BranchManual[] = [
  {
    id: "man1",
    title: "Стартовый чеклист",
    excerpt: "Что сделать в первые 24 часа после вступления в филиал.",
    updatedAt: "2026-08-05",
    author: "northwind",
    bodyMarkdown: `# Стартовый чеклист

Первые сутки в команде — про фундамент, не про объём.

## Перед работой
- Прочитай правила филиала
- Подключи уведомления
- Возьми домен только из командного пула

## Первый день
1. Сделай **тестовый** прогон связки
2. Отправь отчёт в общий чат
3. Спроси рекрутера, если что-то *непонятно*

> Не гонись за чеком в первый день — лучше стабильный ритм.
`,
  },
  {
    id: "man2",
    title: "EU: прогрев и лимиты",
    excerpt: "Как аккуратно прогревать EU-трафик без лишних блокировок.",
    updatedAt: "2026-07-22",
    author: "demo_operator",
    bodyMarkdown: `# EU: прогрев и лимиты

## Базовые правила
- Не смешивай гео в одной сессии
- Держи паузы между попытками
- Логируй источник и связку

## Чеклист перед запуском
1. Проверь NS домена
2. Убедись, что шаблон актуален
3. Сверь **лимиты** на сутки

Ссылка на шаблон: [Онбординг EU](#)
`,
  },
  {
    id: "man3",
    title: "Эскалации и роли",
    excerpt: "К кому идти с заявками, доменами и спорами по процентам.",
    updatedAt: "2026-06-30",
    author: "northwind",
    bodyMarkdown: `# Эскалации и роли

## Кто за что отвечает
- **Владелец** — правила, домен, опасная зона
- **Зам** — состав, проценты, шаблоны
- **Рекрутер** — только заявки

## Когда писать
Если участник неактивен *дольше 14 дней* — сначала предупреждение, потом автокик.
`,
  },
];

export const BRANCH_DOMAINS: BranchDomain[] = [
  { id: "d1", host: "north.team", status: "pending_ns" },
  { id: "d2", host: "eu-north.work", status: "active" },
];

export const MOCK_INVITES: BranchInvite[] = [
  {
    id: "inv1",
    username: "euro_fox",
    avatarUrl: "https://api.dicebear.com/9.x/thumbs/svg?seed=euro_fox&backgroundColor=2dd4bf",
    invitedBy: "@kira_eu",
    invitedAt: "2026-08-25T12:00:00.000Z",
    status: "pending",
  },
  {
    id: "inv2",
    username: "nightowl",
    invitedBy: "@northwind",
    invitedAt: "2026-08-23T18:40:00.000Z",
    status: "pending",
  },
  {
    id: "inv3",
    username: "pack_lead",
    avatarUrl: "https://api.dicebear.com/9.x/thumbs/svg?seed=pack_lead&backgroundColor=a78bfa",
    invitedBy: "@demo_operator",
    invitedAt: "2026-08-20T09:10:00.000Z",
    status: "accepted",
  },
];

export function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(Number(value) || 0);
}

export function pluralRu(count: number, one: string, few: string, many: string) {
  const abs = Math.abs(count) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

export function formatShortDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}
