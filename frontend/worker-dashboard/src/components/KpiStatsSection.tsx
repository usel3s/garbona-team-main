import type { DashboardOverview } from "../types";
import { text } from "../copy";
import { formatMoney } from "../utils";
import { sparklinePoints } from "../chartUtils";

type SparkTone = "profit" | "period" | "logs" | "mafile";

function KpiDelta({ pct }: { pct?: number | null }) {
  const value = pct == null ? 0 : Number(pct);
  const sign = value > 0 ? "+" : "";
  const cls = value > 0 ? "up" : value < 0 ? "down" : "neutral";

  return (
    <div className={`kpi-delta ${cls}`}>
      <span className="kpi-delta-pct">
        {sign}
        {value}%
      </span>
      <span className="kpi-delta-suffix">{text("stats.deltaSuffix")}</span>
    </div>
  );
}

function Sparkline({ values, tone }: { values: number[]; tone: SparkTone }) {
  const nums = values.map((value) => Math.max(0, Number(value) || 0));
  const empty = nums.every((value) => value <= 0);

  return (
    <div
      className={`kpi-spark kpi-spark-${tone}${empty ? " is-empty" : ""}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 100 24" preserveAspectRatio="none" focusable="false">
        <polyline points={sparklinePoints(nums)} />
      </svg>
    </div>
  );
}

const ProfitIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M4 16.5 9.2 11l3.3 3.2L20 7.5"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M15.5 7.5H20V12"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const PeriodIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect
      x="4"
      y="5.5"
      width="16"
      height="13"
      rx="2"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path
      d="M8 3.5v4M16 3.5v4M4 9.5h16"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

const LogsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M7 3.5h6.2L17.5 8v11.5A1.5 1.5 0 0 1 16 21H7a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 7 3.5Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path
      d="M13.2 3.5V8H17.5M9 12h6M9 15.2h6M9 18.4h3.8"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const MafileIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M8 4.5h5l4 4V19a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 19V6A1.5 1.5 0 0 1 8 4.5Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path
      d="M13 4.5V9h4.5M9.5 13.5h5M9.5 16.5h3.5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export function KpiStatsSection({ overview }: { overview: DashboardOverview }) {
  const { user, kpi, series } = overview;
  const sparkProfit = series.map((row) => Number(row.profitUsd || 0));
  const sparkLogs = series.map((row) => Number(row.logsCount || 0));
  const sparkMafile = series.map((row) => Number(row.mafileCount || 0));
  const profitTotal = user.profitTotalUsd ?? user.walletUsd ?? 0;

  return (
    <section
      className="gbd-section section section-stats dashboard-stats"
      aria-labelledby="gbd-stats-title"
    >
      <div className="section-head">
        <div>
          <h2 className="section-title" id="gbd-stats-title">
            {text("stats.title")}
          </h2>
          <p className="dashboard-section-hint muted">{text("stats.hint")}</p>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-cell dashboard-kpi-primary">
          <div className="kpi-cell-top">
            <span className="kpi-icon kpi-icon-profit" aria-hidden="true">
              <ProfitIcon />
            </span>
            <div className="kpi-label">{text("stats.profitTotal")}</div>
          </div>
          <div className="kpi-cell-main">
            <div className="kpi-cell-nums">
              <div className="kpi-value">{formatMoney(profitTotal)}</div>
              <KpiDelta pct={kpi.profitTotalDeltaPct} />
            </div>
            <Sparkline values={sparkProfit} tone="profit" />
          </div>
        </div>

        <div className="kpi-cell">
          <div className="kpi-cell-top">
            <span className="kpi-icon kpi-icon-period" aria-hidden="true">
              <PeriodIcon />
            </span>
            <div className="kpi-label">{text("stats.profitPeriod")}</div>
          </div>
          <div className="kpi-cell-main">
            <div className="kpi-cell-nums">
              <div className="kpi-value">{formatMoney(kpi.profitPeriodUsd || 0)}</div>
              <KpiDelta pct={kpi.profitPeriodDeltaPct} />
            </div>
            <Sparkline values={sparkProfit} tone="period" />
          </div>
        </div>

        <div className="kpi-cell">
          <div className="kpi-cell-top">
            <span className="kpi-icon kpi-icon-logs" aria-hidden="true">
              <LogsIcon />
            </span>
            <div className="kpi-label">
              {text("stats.logs")}{" "}
              <span className="kpi-hint">{text("stats.logsHint")}</span>
            </div>
          </div>
          <div className="kpi-cell-main">
            <div className="kpi-cell-nums">
              <div className="kpi-value">
                {kpi.logsPeriod ?? 0}{" "}
                <span className="muted">/ {kpi.totalLogs || 0}</span>
              </div>
              <KpiDelta pct={kpi.logsDeltaPct} />
            </div>
            <Sparkline values={sparkLogs} tone="logs" />
          </div>
        </div>

        <div className="kpi-cell">
          <div className="kpi-cell-top">
            <span className="kpi-icon kpi-icon-mafile" aria-hidden="true">
              <MafileIcon />
            </span>
            <div className="kpi-label">
              {text("stats.mafile")}{" "}
              <span className="kpi-hint">{text("stats.mafileHint")}</span>
            </div>
          </div>
          <div className="kpi-cell-main">
            <div className="kpi-cell-nums">
              <div className="kpi-value">
                {kpi.mafilePeriod ?? 0}{" "}
                <span className="muted">/ {kpi.mafileTotal || 0}</span>
              </div>
              <KpiDelta pct={kpi.mafileDeltaPct} />
            </div>
            <Sparkline values={sparkMafile} tone="mafile" />
          </div>
        </div>
      </div>
    </section>
  );
}
