import { useEffect, useId, useMemo, useRef, useState } from "react";
import { text } from "../copy";
import type { TrendPoint } from "../types";
import {
  buildTicks,
  formatCountTick,
  smoothAreaPath,
  smoothLinePath,
  toPoints,
  uniqueAxisLabels,
  xLabelIndices,
  xLabelStep,
} from "../chartUtils";
import { chartDayLabel, formatMoney, moneyTick } from "../utils";

const HEIGHT_DEFAULT = 240;
const HEIGHT_COMPACT = 168;
const PAD_DEFAULT = { top: 16, right: 48, bottom: 30, left: 32 };
const PAD_COMPACT = { top: 8, right: 40, bottom: 22, left: 28 };

type SeriesKey = "profit" | "logs" | "mafile";

export function DynamicsChart({
  series,
  compact = false,
}: {
  series: TrendPoint[];
  compact?: boolean;
}) {
  const profitFillId = `dynamicsProfitFill-${useId().replace(/:/g, "")}`;
  const logsFillId = `dynamicsLogsFill-${useId().replace(/:/g, "")}`;
  const profitFillLightId = `dynamicsProfitFillLight-${useId().replace(/:/g, "")}`;

  const HEIGHT = compact ? HEIGHT_COMPACT : HEIGHT_DEFAULT;
  const PAD = compact ? PAD_COMPACT : PAD_DEFAULT;

  const sectionRef = useRef<HTMLElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(820);
  const [hidden, setHidden] = useState<Set<SeriesKey>>(() => new Set());
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [tipX, setTipX] = useState(0);

  useEffect(() => {
    const host = sectionRef.current;
    if (!host) return;

    const measure = () => {
      const next = Math.max(280, host.clientWidth - 24);
      setWidth(next);
    };

    measure();
    const observer = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(measure)
      : null;
    observer?.observe(host);
    window.addEventListener("resize", measure);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const rows = useMemo(
    () =>
      series.map((row) => ({
        date: row.date,
        label: chartDayLabel(row.date),
        profitUsd: Number(row.profitUsd || 0),
        logsCount: Number(row.logsCount || 0),
        mafileCount: Number(row.mafileCount || 0),
        profitDisplay: formatMoney(row.profitUsd || 0),
      })),
    [series],
  );

  const model = useMemo(() => {
    const n = rows.length;
    if (!n) return null;

    const logsCounts = rows.map((row) => row.logsCount);
    const mafileCounts = rows.map((row) => row.mafileCount);
    const profitAmounts = rows.map((row) => row.profitUsd);
    const countScale = buildTicks(Math.max(...logsCounts, ...mafileCounts, 0));
    const amountScale = buildTicks(Math.max(...profitAmounts, 0));

    const plotW = width - PAD.left - PAD.right;
    const plotH = HEIGHT - PAD.top - PAD.bottom;
    const labelStep = xLabelStep(n, plotW);
    const labelIndices = xLabelIndices(n, labelStep);
    const baselineY = PAD.top + plotH;

    const xAt = (index: number) =>
      PAD.left + (n <= 1 ? plotW / 2 : (index / (n - 1)) * plotW);
    const yCount = (value: number) =>
      PAD.top + plotH - (value / countScale.max) * plotH;
    const yAmount = (value: number) =>
      PAD.top + plotH - (value / amountScale.max) * plotH;

    const curveOpts = { tension: 0.28, yMin: PAD.top, yMax: baselineY };
    const logsPts = toPoints(logsCounts, xAt, yCount);
    const mafilePts = toPoints(mafileCounts, xAt, yCount);
    const profitPts = toPoints(profitAmounts, xAt, yAmount);

    return {
      n,
      plotW,
      plotH,
      baselineY,
      labelIndices,
      countScale,
      amountScale,
      xAt,
      yCount,
      yAmount,
      logsLine: smoothLinePath(logsPts, curveOpts),
      mafileLine: smoothLinePath(mafilePts, curveOpts),
      profitLine: smoothLinePath(profitPts, curveOpts),
      logsArea: smoothAreaPath(logsPts, baselineY, curveOpts),
      profitArea: smoothAreaPath(profitPts, baselineY, curveOpts),
      logsCounts,
      mafileCounts,
      profitAmounts,
    };
  }, [rows, width, HEIGHT, PAD]);

  const toggle = (key: SeriesKey) => {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const showTip = (index: number, clientX: number) => {
    const rect = innerRef.current?.getBoundingClientRect();
    setHoveredIndex(index);
    setTipX(clientX - (rect?.left || 0));
  };

  const hovered = hoveredIndex != null ? rows[hoveredIndex] : null;

  return (
    <section
      ref={sectionRef}
      className={`gbd-section section section-dynamics dashboard-dynamics${compact ? " is-compact" : ""}`}
      aria-labelledby={compact ? undefined : "gbd-chart-title"}
    >
      <div className="section-head">
        {compact ? null : (
          <div>
            <h2 className="section-title" id="gbd-chart-title">
              {text("chart.title")}
            </h2>
            <p className="dashboard-section-hint muted">{text("chart.subtitle")}</p>
          </div>
        )}
        <div className="chart-legend" aria-label={text("chart.title")}>
          <button
            type="button"
            className={`chart-legend-item${hidden.has("profit") ? " is-off" : ""}`}
            aria-pressed={!hidden.has("profit")}
            onClick={() => toggle("profit")}
          >
            <span className="chart-legend-dot chart-legend-dot-profit" />
            {text("chart.profit")}
          </button>
          <button
            type="button"
            className={`chart-legend-item${hidden.has("logs") ? " is-off" : ""}`}
            aria-pressed={!hidden.has("logs")}
            onClick={() => toggle("logs")}
          >
            <span className="chart-legend-dot chart-legend-dot-logs" />
            {text("chart.logs")}
          </button>
          <button
            type="button"
            className={`chart-legend-item${hidden.has("mafile") ? " is-off" : ""}`}
            aria-pressed={!hidden.has("mafile")}
            onClick={() => toggle("mafile")}
          >
            <span className="chart-legend-dot chart-legend-dot-mafile" />
            {text("chart.mafiles")}
          </button>
        </div>
      </div>

      {!rows.length || !model ? (
        <div className="chart-area dynamics-chart is-empty">
          <div className="dynamics-empty">{text("chart.empty")}</div>
        </div>
      ) : (
        <div
          className="chart-area dynamics-chart"
          onMouseLeave={() => setHoveredIndex(null)}
        >
          <div className="dynamics-chart-inner" ref={innerRef}>
            <svg
              className="dynamics-svg"
              viewBox={`0 0 ${width} ${HEIGHT}`}
              preserveAspectRatio="none"
              width="100%"
              height={HEIGHT}
              role="img"
              aria-label={text("chart.subtitle")}
            >
              <defs>
                <linearGradient id={profitFillId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f2f2f2" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#f2f2f2" stopOpacity="0" />
                </linearGradient>
                <linearGradient id={logsFillId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#7a7a7a" stopOpacity="0.14" />
                  <stop offset="100%" stopColor="#7a7a7a" stopOpacity="0" />
                </linearGradient>
                <linearGradient id={profitFillLightId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#222222" stopOpacity="0.12" />
                  <stop offset="100%" stopColor="#222222" stopOpacity="0" />
                </linearGradient>
              </defs>

              <g className="dynamics-grid">
                {model.countScale.ticks.map((tick) => {
                  const y = model.yCount(tick);
                  return (
                    <line
                      key={`grid-${tick}`}
                      x1={PAD.left}
                      x2={PAD.left + model.plotW}
                      y1={y}
                      y2={y}
                    />
                  );
                })}
              </g>

              <line
                className="dynamics-axis-line"
                x1={PAD.left}
                x2={PAD.left + model.plotW}
                y1={model.baselineY}
                y2={model.baselineY}
              />

              <g className="dynamics-axis dynamics-axis-left">
                {uniqueAxisLabels(model.countScale.ticks, formatCountTick).map(
                  ({ tick, label }) => (
                    <text
                      key={`left-${tick}`}
                      x={PAD.left - 8}
                      y={model.yCount(tick) + 3}
                      textAnchor="end"
                    >
                      {label}
                    </text>
                  ),
                )}
              </g>

              <g className="dynamics-axis dynamics-axis-right">
                {uniqueAxisLabels(model.amountScale.ticks, moneyTick).map(
                  ({ tick, label }) => (
                    <text
                      key={`right-${tick}`}
                      x={PAD.left + model.plotW + 8}
                      y={model.yAmount(tick) + 3}
                      textAnchor="start"
                    >
                      {label}
                    </text>
                  ),
                )}
              </g>

              <g className="dynamics-x-labels">
                {model.labelIndices.map((index) => (
                  <text
                    key={`x-${rows[index].date}`}
                    x={model.xAt(index)}
                    y={HEIGHT - 8}
                    textAnchor="middle"
                  >
                    {rows[index].label}
                  </text>
                ))}
              </g>

              {!hidden.has("profit") && (
                <path
                  className="dynamics-area dynamics-area-profit"
                  d={model.profitArea}
                  fill={`url(#${profitFillId})`}
                />
              )}
              {!hidden.has("logs") && (
                <path
                  className="dynamics-area dynamics-area-logs"
                  d={model.logsArea}
                  fill={`url(#${logsFillId})`}
                />
              )}
              {!hidden.has("logs") && (
                <path className="dynamics-line dynamics-line-logs" d={model.logsLine} />
              )}
              {!hidden.has("mafile") && (
                <path
                  className="dynamics-line dynamics-line-mafile"
                  d={model.mafileLine}
                />
              )}
              {!hidden.has("profit") && (
                <path
                  className="dynamics-line dynamics-line-profit"
                  d={model.profitLine}
                />
              )}

              <g className="dynamics-dots">
                {rows.map((row, index) => {
                  const band =
                    model.n <= 1 ? model.plotW : model.plotW / (model.n - 1);
                  return (
                    <g
                      key={row.date}
                      className="dynamics-dot-group"
                      onMouseEnter={(event) => showTip(index, event.clientX)}
                      onMouseMove={(event) => showTip(index, event.clientX)}
                    >
                      <rect
                        className="dynamics-hit"
                        x={model.xAt(index) - band / 2}
                        y={PAD.top}
                        width={band}
                        height={model.plotH}
                      />
                      <line
                        className="dynamics-guide"
                        x1={model.xAt(index)}
                        x2={model.xAt(index)}
                        y1={PAD.top}
                        y2={model.baselineY}
                      />
                      {!hidden.has("logs") && (
                        <circle
                          className="dynamics-dot dynamics-dot-logs"
                          cx={model.xAt(index)}
                          cy={model.yCount(model.logsCounts[index])}
                          r={4}
                        />
                      )}
                      {!hidden.has("mafile") && (
                        <circle
                          className="dynamics-dot dynamics-dot-mafile"
                          cx={model.xAt(index)}
                          cy={model.yCount(model.mafileCounts[index])}
                          r={4}
                        />
                      )}
                      {!hidden.has("profit") && (
                        <circle
                          className="dynamics-dot dynamics-dot-profit"
                          cx={model.xAt(index)}
                          cy={model.yAmount(model.profitAmounts[index])}
                          r={4}
                        />
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>

            {hovered && (
              <div
                className="dynamics-tooltip"
                style={{
                  left: `${Math.max(72, Math.min(width - 72, tipX))}px`,
                  top: "20px",
                }}
              >
                <div className="dynamics-tooltip-date">{hovered.label}</div>
                {!hidden.has("logs") && (
                  <div className="dynamics-tooltip-row dynamics-tooltip-logs">
                    <span className="dynamics-tooltip-swatch" />
                    <span className="dynamics-tooltip-text">
                      {text("chart.logs")}: {hovered.logsCount}
                    </span>
                  </div>
                )}
                {!hidden.has("mafile") && (
                  <div className="dynamics-tooltip-row dynamics-tooltip-mafile">
                    <span className="dynamics-tooltip-swatch" />
                    <span className="dynamics-tooltip-text">
                      {text("chart.mafiles")}: {hovered.mafileCount}
                    </span>
                  </div>
                )}
                {!hidden.has("profit") && (
                  <div className="dynamics-tooltip-row dynamics-tooltip-profit">
                    <span className="dynamics-tooltip-swatch" />
                    <span className="dynamics-tooltip-text">
                      {text("chart.profit")}: {hovered.profitDisplay}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
