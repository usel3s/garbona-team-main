import { useState, type CSSProperties } from "react";
import {
  BookOpen,
  CircleDollarSign,
  FileKey2,
  Flame,
  GitBranch,
  Globe,
  LogOut,
  Settings2,
  Shield,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { DynamicsChart } from "../components/DynamicsChart";
import type { BranchRecord } from "../Branch";
import type { DashboardPeriod, TrendPoint } from "../types";
import {
  ACHIEVEMENTS_CATALOG,
  BRANCH_SERIES_14,
  BRANCH_SERIES_30,
  BRANCH_SERIES_7,
  MOCK_APPLICATIONS,
  TOP_WORKERS,
  formatUsd,
  pluralRu,
} from "./mock";
import type { Achievement, BranchSection, TopWorker, TopWorkerPeriod } from "./types";
import "./branch-cabinet.css";
import "../dashboard.css";

const PERIOD_SERIES: Record<DashboardPeriod, typeof BRANCH_SERIES_7> = {
  7: BRANCH_SERIES_7,
  14: BRANCH_SERIES_14,
  30: BRANCH_SERIES_30,
};

const TOP_TABS: { id: TopWorkerPeriod; label: string }[] = [
  { id: "day", label: "Сегодня" },
  { id: "7d", label: "7 дней" },
  { id: "all", label: "Всё время" },
];

const ICON_MAP: Record<string, typeof Trophy> = {
  CircleDollarSign,
  Flame,
  Users,
  FileKey2,
  Trophy,
  Shield,
  Globe,
  BookOpen,
};

function branchAgeDays(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
}

function formatBranchAge(value: string) {
  const days = branchAgeDays(value);
  if (days == null) return "—";
  return `${days} ${pluralRu(days, "день", "дня", "дней")}`;
}

function PersonAvatar({
  name,
  avatarUrl,
  size = "md",
  accent = "#00c48c",
}: {
  name: string;
  avatarUrl?: string;
  size?: "sm" | "md" | "lg" | "hero";
  accent?: string;
}) {
  const [failed, setFailed] = useState(false);
  const initial = (name.trim().charAt(0) || "?").toUpperCase();
  const show = Boolean(avatarUrl) && !failed;

  return (
    <div
      className={`gbc-avatar gbc-avatar--${size}`}
      style={
        {
          "--gbr-from": "#06352c",
          "--gbr-to": accent,
        } as CSSProperties
      }
    >
      {show ? (
        <img src={avatarUrl} alt="" onError={() => setFailed(true)} />
      ) : (
        <span aria-hidden="true">{initial}</span>
      )}
    </div>
  );
}

function AchievementIcon({ icon }: { icon: string }) {
  const Icon = ICON_MAP[icon] || Trophy;
  return <Icon size={20} strokeWidth={1.7} />;
}

function AchievementsModal({
  items,
  onClose,
}: {
  items: Achievement[];
  onClose(): void;
}) {
  return (
    <div className="gbc-overlay" role="dialog" aria-modal="true">
      <div className="gbc-modal">
        <div className="gbc-modal__head">
          <div>
            <h2>Все достижения</h2>
            <p className="gbc__head" style={{ margin: "6px 0 0" }}>
              <span style={{ color: "var(--muted)", fontSize: 13 }}>
                Разблокированные и цели филиала
              </span>
            </p>
          </div>
          <button type="button" className="gbc-icon-btn" aria-label="Закрыть" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="gbc-ach-list">
          {items.map((item) => (
            <article
              key={item.id}
              className={`gbc-ach-row${!item.unlocked ? " is-locked" : ""}`}
            >
              <div className={`gbc-ach${!item.unlocked ? " is-locked" : ""}`}>
                <AchievementIcon icon={item.icon} />
              </div>
              <div>
                <strong>{item.title}</strong>
                <small>{item.description}</small>
                {!item.unlocked && item.progressHint ? (
                  <div className="gbc-hint">{item.progressHint}</div>
                ) : null}
                {item.unlocked && item.unlockedAt ? (
                  <div className="gbc-hint">Открыто {item.unlockedAt}</div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

export function OverviewPanel({
  branch,
  isOwner,
  onNavigate,
  onLeave,
  pendingApplications,
  series,
  topWorkers,
}: {
  branch: BranchRecord;
  isOwner: boolean;
  onNavigate(section: BranchSection): void;
  onLeave?(): void;
  pendingApplications?: number;
  series?: Partial<Record<DashboardPeriod, TrendPoint[]>>;
  topWorkers?: Partial<Record<TopWorkerPeriod, TopWorker[]>>;
}) {
  const [period, setPeriod] = useState<DashboardPeriod>(14);
  const [topTab, setTopTab] = useState<TopWorkerPeriod>("7d");
  const [showAchievements, setShowAchievements] = useState(false);

  const unlocked = ACHIEVEMENTS_CATALOG.filter((item) => item.unlocked);
  const pendingApps =
    pendingApplications ??
    MOCK_APPLICATIONS.filter((item) => item.status === "pending").length;
  const chartSeries = series?.[period] ?? PERIOD_SERIES[period];
  const top = (topWorkers?.[topTab] ?? TOP_WORKERS[topTab]).slice(0, 5);

  return (
    <div className="gbc">
      <header className="gbc__head">
        <div>
          <p className="gbc__kicker">
            <GitBranch size={14} strokeWidth={1.7} />
            Личный кабинет
          </p>
          <h1>Обзор филиала</h1>
          <p>{isOwner ? "Вы владелец этой команды." : "Вы участник филиала."}</p>
        </div>
      </header>

      <section
        className="gbc-hero"
        style={{ "--gbr-accent": "#00c48c" } as CSSProperties}
      >
        <div className="gbc-hero__glow" aria-hidden="true" />
        <PersonAvatar
          name={branch.name}
          avatarUrl={branch.avatarUrl}
          size="hero"
        />
        <div className="gbc-hero__body">
          <div className="gbc-hero__chips">
            <span className="gbc-chip is-accent">{branch.percent}%</span>
            <span className="gbc-chip is-own">
              {isOwner ? "Владелец" : "Участник"}
            </span>
            <span className="gbc-chip">{formatBranchAge(branch.createdAt)}</span>
            {branch.acceptingApplications === false ? (
              <span className="gbc-chip">Заявки закрыты</span>
            ) : (
              <span className="gbc-chip is-accent">Приём открыт</span>
            )}
          </div>
          <h2>{branch.name}</h2>
          <p>{branch.description.trim() || "Описание пока не указано."}</p>
        </div>
      </section>

      <div className="gbc-kpi">
        <div className="gbc-kpi__item">
          <span>Участники</span>
          <strong>{branch.members}</strong>
        </div>
        <div className="gbc-kpi__item">
          <span>Профиты</span>
          <strong>{formatUsd(branch.total)}</strong>
        </div>
        <div className="gbc-kpi__item">
          <span>Комиссия</span>
          <strong>{branch.percent}%</strong>
        </div>
        <div className="gbc-kpi__item">
          <span>Заявки</span>
          <strong>{isOwner ? pendingApps : "—"}</strong>
        </div>
      </div>

      <div className="gbc-grid-2 gbc-grid-2--analytics">
        <div className="gbc-card gbc-card--chart" style={{ marginTop: 0 }}>
          <div className="gbc-card__head">
            <h3>Динамика филиала</h3>
            <div className="gbc-period" role="tablist" aria-label="Период">
              {([7, 14, 30] as DashboardPeriod[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  className={period === value ? "is-active" : undefined}
                  onClick={() => setPeriod(value)}
                >
                  {value}д
                </button>
              ))}
            </div>
          </div>
          <div className="gbd-dashboard gbc-chart-host">
            <DynamicsChart series={chartSeries} compact />
          </div>
        </div>

        <div className="gbc-card gbc-card--top" style={{ marginTop: 0 }}>
          <div className="gbc-card__head">
            <h3>Топ воркеров</h3>
            <div className="gbc-period" role="tablist" aria-label="Топ за период">
              {TOP_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  className={topTab === tab.id ? "is-active" : undefined}
                  onClick={() => setTopTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <div className="gbc-top__list">
            {top.map((worker, index) => {
              const tag = String(worker.fakeProfitTag || "")
                .trim()
                .replace(/^#+/, "");
              const label = worker.isAnonymous
                ? tag
                  ? `#${tag}`
                  : "Аноним"
                : `@${worker.username}`;
              return (
                <div key={`${topTab}-${worker.id}`} className="gbc-top__row">
                  <span className="gbc-top__rank">{index + 1}</span>
                  <PersonAvatar
                    name={label}
                    avatarUrl={worker.isAnonymous ? undefined : worker.avatarUrl}
                    size="sm"
                  />
                  <strong className={worker.isAnonymous ? "is-anon" : undefined}>
                    {label}
                  </strong>
                  <span>{formatUsd(worker.profits)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="gbc-card">
        <div className="gbc-card__head">
          <h3>Достижения</h3>
          <button
            type="button"
            className="gbc__btn is-ghost is-sm"
            onClick={() => setShowAchievements(true)}
          >
            Все достижения
          </button>
        </div>
        <div className="gbc-achievements">
          {unlocked.map((item) => (
            <button
              key={item.id}
              type="button"
              className="gbc-ach-tile"
              onClick={() => setShowAchievements(true)}
            >
              <span className="gbc-ach">
                <AchievementIcon icon={item.icon} />
              </span>
              <span className="gbc-ach-tile__name">{item.title}</span>
            </button>
          ))}
          {unlocked.length === 0 ? (
            <p className="gbc-hint">Пока нет открытых достижений.</p>
          ) : null}
        </div>
      </div>

      <div className="gbc-actions">
        {isOwner ? (
          <>
            <button
              type="button"
              className="gbc__btn"
              onClick={() => onNavigate("members")}
            >
              <Users size={15} strokeWidth={2} />
              Участники
            </button>
            <button
              type="button"
              className="gbc__btn is-ghost"
              onClick={() => onNavigate("settings")}
            >
              <Settings2 size={15} strokeWidth={2} />
              Настройки
            </button>
            <button
              type="button"
              className="gbc__btn is-ghost"
              onClick={() => onNavigate("manuals")}
            >
              <BookOpen size={15} strokeWidth={2} />
              Мануалы
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="gbc__btn is-ghost"
              onClick={() => onNavigate("manuals")}
            >
              <BookOpen size={15} strokeWidth={2} />
              Мануалы
            </button>
            <button
              type="button"
              className="gbc__btn is-danger-ghost"
              onClick={() => onLeave?.()}
            >
              <LogOut size={15} strokeWidth={2} />
              Покинуть филиал
            </button>
          </>
        )}
      </div>

      {showAchievements ? (
        <AchievementsModal
          items={ACHIEVEMENTS_CATALOG}
          onClose={() => setShowAchievements(false)}
        />
      ) : null}
    </div>
  );
}
