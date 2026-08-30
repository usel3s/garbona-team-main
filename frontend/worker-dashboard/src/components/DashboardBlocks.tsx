import type { ReactNode } from "react";
import {
  AlertTriangle,
  CloudOff,
  FileKey2,
  KeyRound,
  Layers,
  RefreshCw,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import type {
  DashboardOverview,
  DashboardPeriod,
  DashboardRenderContext,
} from "../types";
import { text } from "../copy";
import { displayName, formatMoney, signedPercent } from "../utils";

const PERIODS: DashboardPeriod[] = [7, 14, 30];

export function DashboardHeader({
  context,
  overview,
  period,
  loading,
  onPeriodChange,
  onRefresh,
}: {
  context: DashboardRenderContext;
  overview: DashboardOverview;
  period: DashboardPeriod;
  loading: boolean;
  onPeriodChange(period: DashboardPeriod): void;
  onRefresh(): void;
}) {
  return (
    <header className="gbd-header">
      <div className="gbd-header__copy">
        <p className="gbd-kicker">{text("header.eyebrow")}</p>
        <h1>{text("header.greeting", { name: displayName(context, overview) })}</h1>
      </div>

      <div className="gbd-header__actions">
        <div
          className="gbd-segment"
          role="group"
          aria-label={text("header.period")}
        >
          {PERIODS.map((days) => (
            <button
              key={days}
              type="button"
              className={period === days ? "is-active" : undefined}
              aria-pressed={period === days}
              onClick={() => onPeriodChange(days)}
            >
              {days}
              <span className="gbd-segment__unit">{text("header.days")}</span>
            </button>
          ))}
        </div>
        <button
          className="gbd-icon-btn"
          type="button"
          onClick={onRefresh}
          disabled={loading}
          aria-label={text("header.refresh")}
          title={text("header.refresh")}
        >
          <RefreshCw className={loading ? "is-spinning" : ""} size={15} />
        </button>
      </div>
    </header>
  );
}

export function OverviewPanel({ overview }: { overview: DashboardOverview }) {
  const { user, kpi } = overview;
  const negative = kpi.profitTotalDeltaPct < 0;

  return (
    <section className="gbd-overview" aria-labelledby="gbd-overview-title">
      <div className="gbd-overview__lead">
        <p className="gbd-kicker" id="gbd-overview-title">
          {text("hero.label")}
        </p>
        <div className="gbd-overview__value-row">
          <strong className="gbd-overview__value">
            {formatMoney(user.profitTotalUsd)}
          </strong>
          <span className={`gbd-delta ${negative ? "is-neg" : ""}`}>
            {signedPercent(kpi.profitTotalDeltaPct)}
          </span>
        </div>
        <p className="gbd-overview__caption">{text("hero.caption")}</p>
      </div>

      <div className="gbd-overview__grid">
        <OverviewStat
          label={text("hero.today")}
          value={formatMoney(kpi.profitTodayUsd)}
        />
        <OverviewStat
          label={text("hero.period", { days: overview.days })}
          value={formatMoney(kpi.profitPeriodUsd)}
          delta={kpi.profitPeriodDeltaPct}
        />
        <OverviewStat
          label={text("hero.share")}
          value={`${user.profitPercent}%`}
        />
      </div>
    </section>
  );
}

function OverviewStat({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta?: number;
}) {
  return (
    <div className="gbd-overview__stat">
      <span className="gbd-kicker">{label}</span>
      <strong>{value}</strong>
      {delta != null && (
        <em className={delta < 0 ? "is-neg" : undefined}>
          {signedPercent(delta)}
        </em>
      )}
    </div>
  );
}

export function StatRow({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <section className="gbd-stat-row" aria-label={label}>
      {children}
    </section>
  );
}

export function StatCell({
  label,
  value,
  hint,
  delta,
  tone = "neutral",
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  delta?: number;
  tone?: "logs" | "mafiles" | "operations" | "best" | "neutral";
  icon?: LucideIcon;
}) {
  return (
    <article className={`gbd-stat-cell gbd-stat-cell--${tone}`}>
      <div className="gbd-stat-cell__top">
        <span className="gbd-stat-cell__label">
          {Icon ? (
            <span className="gbd-stat-cell__icon" aria-hidden="true">
              <Icon size={14} strokeWidth={2} />
            </span>
          ) : null}
          <span className="gbd-kicker">{label}</span>
        </span>
        {delta != null && (
          <span className={`gbd-delta gbd-delta--sm ${delta < 0 ? "is-neg" : ""}`}>
            {signedPercent(delta)}
          </span>
        )}
      </div>
      <strong className="gbd-stat-cell__value">{value}</strong>
      <span className="gbd-stat-cell__hint">{hint}</span>
    </article>
  );
}

function CompassMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="2.2" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 3.75v2.2M12 18.05v2.2M3.75 12h2.2M18.05 12h2.2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="m14.2 9.8 2.1-2.1M7.7 16.3l2.1-2.1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function LoadingSplash({
  title,
  hint,
}: {
  title: string;
  hint: string;
}) {
  return (
    <div className="gbd-splash" aria-busy="true" aria-live="polite">
      <div className="gbd-splash__icon" aria-hidden="true">
        <CompassMark />
      </div>
      <h1>{title}</h1>
      <p>{hint}</p>
    </div>
  );
}

export function SkeletonState() {
  return (
    <div className="gbd-dashboard gbd-dashboard--loading" aria-busy="true">
      <LoadingSplash
        title={text("state.loading")}
        hint={text("state.loadingHint")}
      />
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry(): void;
}) {
  return (
    <div className="gbd-dashboard">
      <section className="gbd-state" role="alert">
        <CloudOff size={22} aria-hidden="true" />
        <h1>{text("state.error")}</h1>
        <p>{message}</p>
        <div className="gbd-state__actions">
          <button className="gbd-btn gbd-btn--primary" type="button" onClick={onRetry}>
            <RefreshCw size={14} />
            {text("state.retry")}
          </button>
        </div>
      </section>
    </div>
  );
}

export function PartialDataAlert() {
  return (
    <div className="gbd-alert" role="status">
      <AlertTriangle size={14} aria-hidden="true" />
      {text("state.partial")}
    </div>
  );
}

export const PerformanceHero = OverviewPanel;
export const PeriodSpotlight = (_props: { overview: DashboardOverview }) => null;
export const MetricCard = StatCell;
export { FileKey2, KeyRound, Layers, Trophy };
