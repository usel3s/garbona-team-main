import { useId, useMemo, useState } from "react";
import { BarChart3, CircleDollarSign, FileKey2 } from "lucide-react";
import { text } from "../copy";
import type { TrendPoint } from "../types";
import { formatMoney, shortDate } from "../utils";

type SeriesKey = "profit" | "logs" | "mafiles";

const WIDTH = 820;
const HEIGHT = 260;
const PLOT = { left: 52, right: 16, top: 16, bottom: 36 };

function pointX(index: number, length: number): number {
  const plotWidth = WIDTH - PLOT.left - PLOT.right;
  return PLOT.left + (index / Math.max(length - 1, 1)) * plotWidth;
}

export function TrendChart({ series }: { series: TrendPoint[] }) {
  const gradientId = `gbd-chart-${useId().replace(/:/g, "")}`;
  const [hidden, setHidden] = useState<Set<SeriesKey>>(() => new Set());
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const model = useMemo(() => {
    const profitMax = Math.max(...series.map((point) => point.profitUsd), 1);
    const volumeMax = Math.max(
      ...series.map((point) => point.logsCount + point.mafileCount),
      1,
    );
    const plotHeight = HEIGHT - PLOT.top - PLOT.bottom;
    const profitPoints = series.map((point, index) => ({
      x: pointX(index, series.length),
      y: PLOT.top + plotHeight - (point.profitUsd / profitMax) * plotHeight,
    }));
    const line = profitPoints
      .map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`)
      .join(" ");
    const area = profitPoints.length
      ? `${line} L${profitPoints[profitPoints.length - 1].x},${HEIGHT - PLOT.bottom} L${profitPoints[0].x},${HEIGHT - PLOT.bottom} Z`
      : "";
    return { profitMax, volumeMax, plotHeight, profitPoints, line, area };
  }, [series]);

  const toggle = (key: SeriesKey) => {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const setHoverFromPointer = (clientX: number, target: SVGSVGElement) => {
    if (!series.length) return;
    const rect = target.getBoundingClientRect();
    const plotLeft = (PLOT.left / WIDTH) * rect.width;
    const plotWidth = ((WIDTH - PLOT.left - PLOT.right) / WIDTH) * rect.width;
    const localX = Math.max(0, Math.min(plotWidth, clientX - rect.left - plotLeft));
    const index = Math.round(
      (localX / Math.max(plotWidth, 1)) * (series.length - 1),
    );
    setHoveredIndex(Math.max(0, Math.min(series.length - 1, index)));
  };

  const hovered =
    hoveredIndex != null && series[hoveredIndex]
      ? {
          point: series[hoveredIndex],
          x: model.profitPoints[hoveredIndex]?.x || PLOT.left,
          y: model.profitPoints[hoveredIndex]?.y || PLOT.top,
          index: hoveredIndex,
        }
      : null;

  const tooltipSide =
    hovered && hovered.x / WIDTH > 0.62 ? "left" : "right";

  return (
    <section className="gbd-chart-card" aria-labelledby="gbd-chart-title">
      <div className="gbd-section-head">
        <div>
          <h2 id="gbd-chart-title">{text("chart.title")}</h2>
          <p>{text("chart.subtitle")}</p>
        </div>
        <div className="gbd-chart-legend" aria-label={text("chart.title")}>
          <button
            type="button"
            className="is-profit"
            aria-pressed={!hidden.has("profit")}
            onClick={() => toggle("profit")}
          >
            <CircleDollarSign size={13} />
            {text("chart.profit")}
          </button>
          <button
            type="button"
            className="is-logs"
            aria-pressed={!hidden.has("logs")}
            onClick={() => toggle("logs")}
          >
            <BarChart3 size={13} />
            {text("chart.logs")}
          </button>
          <button
            type="button"
            className="is-mafiles"
            aria-pressed={!hidden.has("mafiles")}
            onClick={() => toggle("mafiles")}
          >
            <FileKey2 size={13} />
            {text("chart.mafiles")}
          </button>
        </div>
      </div>

      {!series.length ? (
        <div className="gbd-chart-empty">
          <BarChart3 size={20} aria-hidden="true" />
          {text("chart.empty")}
        </div>
      ) : (
        <div
          className="gbd-chart-shell"
          onMouseLeave={() => setHoveredIndex(null)}
        >
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-label={text("chart.subtitle")}
            onPointerMove={(event) =>
              setHoverFromPointer(event.clientX, event.currentTarget)
            }
            onPointerLeave={() => setHoveredIndex(null)}
            onFocus={() => setHoveredIndex(series.length - 1)}
            onBlur={() => setHoveredIndex(null)}
            tabIndex={0}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00c48c" stopOpacity=".22" />
                <stop offset="100%" stopColor="#00c48c" stopOpacity="0" />
              </linearGradient>
            </defs>

            {Array.from({ length: 4 }, (_, index) => {
              const y = PLOT.top + (model.plotHeight / 3) * index;
              const value = model.profitMax * (1 - index / 3);
              return (
                <g key={index}>
                  <line
                    className="gbd-chart-gridline"
                    x1={PLOT.left}
                    x2={WIDTH - PLOT.right}
                    y1={y}
                    y2={y}
                  />
                  <text className="gbd-chart-axis" x={PLOT.left - 8} y={y + 3} textAnchor="end">
                    {formatMoney(value)}
                  </text>
                </g>
              );
            })}

            {!hidden.has("logs") &&
              series.map((point, index) => {
                const slot =
                  (WIDTH - PLOT.left - PLOT.right) / Math.max(series.length, 1);
                const barWidth = Math.max(2, Math.min(8, slot * 0.22));
                const height =
                  (point.logsCount / model.volumeMax) * model.plotHeight * 0.85;
                return (
                  <rect
                    className="gbd-chart-bar gbd-chart-bar--logs"
                    key={`logs-${point.date}`}
                    x={pointX(index, series.length) - barWidth - 1}
                    y={HEIGHT - PLOT.bottom - height}
                    width={barWidth}
                    height={Math.max(height, 0)}
                    rx={1}
                  />
                );
              })}

            {!hidden.has("mafiles") &&
              series.map((point, index) => {
                const slot =
                  (WIDTH - PLOT.left - PLOT.right) / Math.max(series.length, 1);
                const barWidth = Math.max(2, Math.min(8, slot * 0.22));
                const height =
                  (point.mafileCount / model.volumeMax) * model.plotHeight * 0.85;
                return (
                  <rect
                    className="gbd-chart-bar gbd-chart-bar--mafiles"
                    key={`mafile-${point.date}`}
                    x={pointX(index, series.length) + 1}
                    y={HEIGHT - PLOT.bottom - height}
                    width={barWidth}
                    height={Math.max(height, 0)}
                    rx={1}
                  />
                );
              })}

            {!hidden.has("profit") && (
              <>
                <path
                  className="gbd-chart-area"
                  d={model.area}
                  fill={`url(#${gradientId})`}
                />
                <path className="gbd-chart-line" d={model.line} />
              </>
            )}

            {series.map((point, index) => {
              const step = Math.max(1, Math.ceil(series.length / 6));
              const showLabel =
                index === 0 ||
                index === series.length - 1 ||
                index % step === 0;
              return showLabel ? (
                <text
                  className="gbd-chart-date"
                  key={`date-${point.date}`}
                  x={pointX(index, series.length)}
                  y={HEIGHT - 10}
                  textAnchor={
                    index === 0
                      ? "start"
                      : index === series.length - 1
                        ? "end"
                        : "middle"
                  }
                >
                  {shortDate(point.date)}
                </text>
              ) : null;
            })}

            {/* Hit strips on top so hover always resolves to a day */}
            {series.map((point, index) => {
              const slot =
                (WIDTH - PLOT.left - PLOT.right) / Math.max(series.length, 1);
              return (
                <rect
                  key={`hit-${point.date}`}
                  className="gbd-chart-hit"
                  x={pointX(index, series.length) - slot / 2}
                  y={PLOT.top}
                  width={slot}
                  height={model.plotHeight}
                  onPointerEnter={() => setHoveredIndex(index)}
                />
              );
            })}


            {hovered && (

              <g className="gbd-chart-cursor" pointerEvents="none">
                <line
                  x1={hovered.x}
                  x2={hovered.x}
                  y1={PLOT.top}
                  y2={HEIGHT - PLOT.bottom}
                />
                {!hidden.has("profit") && (
                  <circle cx={hovered.x} cy={hovered.y} r={4} />
                )}
              </g>
            )}
          </svg>

          {hovered && (
            <div
              className={`gbd-chart-tooltip is-${tooltipSide}`}
              role="status"
              style={{
                left: `${(hovered.x / WIDTH) * 100}%`,
                top: `${Math.min(58, Math.max(8, (hovered.y / HEIGHT) * 100 - 8))}%`,
              }}
            >
              <strong>{shortDate(hovered.point.date)}</strong>
              {!hidden.has("profit") && (
                <span>
                  <i className="is-profit" />
                  {text("chart.profit")}
                  <b>{formatMoney(hovered.point.profitUsd)}</b>
                </span>
              )}
              {!hidden.has("logs") && (
                <span>
                  <i className="is-logs" />
                  {text("chart.logs")}
                  <b>{hovered.point.logsCount}</b>
                </span>
              )}
              {!hidden.has("mafiles") && (
                <span>
                  <i className="is-mafiles" />
                  {text("chart.mafiles")}
                  <b>{hovered.point.mafileCount}</b>
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
