export function niceMax(value: number): number {
  const v = Math.max(0, Number(value) || 0);
  if (v <= 1) return 1;
  if (v <= 5) return Math.ceil(v);
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  if (n <= 1) return pow;
  if (n <= 2) return 2 * pow;
  if (n <= 5) return 5 * pow;
  return 10 * pow;
}

export function buildTicks(max: number, count = 4): { max: number; ticks: number[] } {
  const m = niceMax(max);
  if (m <= 1) {
    return { max: 1, ticks: [0, 1] };
  }
  const ticks: number[] = [];
  for (let i = 0; i < count; i += 1) {
    ticks.push(Number(((m * i) / (count - 1)).toFixed(4)));
  }
  return { max: m, ticks };
}

export function formatCountTick(tick: number): string {
  return String(Math.round(tick));
}

export function uniqueAxisLabels(
  ticks: number[],
  formatter: (tick: number) => string,
): Array<{ tick: number; label: string }> {
  const seen = new Set<string>();
  const out: Array<{ tick: number; label: string }> = [];
  ticks.forEach((tick) => {
    const label = formatter(tick);
    if (seen.has(label)) return;
    seen.add(label);
    out.push({ tick, label });
  });
  return out;
}

export function xLabelStep(count: number, plotWidth: number, minLabelPx = 46): number {
  if (count <= 1) return 1;
  const maxLabels = Math.max(2, Math.floor(plotWidth / minLabelPx));
  return Math.max(1, Math.ceil((count - 1) / Math.max(1, maxLabels - 1)));
}

export function xLabelIndices(count: number, step: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  const indices: number[] = [];
  for (let i = 0; i < count; i += step) indices.push(i);
  if (indices[indices.length - 1] !== count - 1) indices.push(count - 1);
  return indices;
}

export function toPoints(
  values: number[],
  xAt: (index: number) => number,
  yAt: (value: number) => number,
): Array<{ x: number; y: number }> {
  return values.map((value, index) => ({ x: xAt(index), y: yAt(value) }));
}

export function smoothLinePath(
  points: Array<{ x: number; y: number }>,
  {
    tension = 0.28,
    yMin = -Infinity,
    yMax = Infinity,
  }: { tension?: number; yMin?: number; yMax?: number } = {},
): string {
  if (!points.length) return "";
  if (points.length === 1) {
    return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  }
  if (points.length === 2) {
    return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)} L ${points[1].x.toFixed(2)} ${points[1].y.toFixed(2)}`;
  }

  const clampY = (y: number) => Math.min(yMax, Math.max(yMin, y));
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;

  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;

    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = clampY(p1.y + (p2.y - p0.y) * tension);
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = clampY(p2.y - (p3.y - p1.y) * tension);

    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

export function smoothAreaPath(
  points: Array<{ x: number; y: number }>,
  baselineY: number,
  options?: { tension?: number; yMin?: number; yMax?: number },
): string {
  const line = smoothLinePath(points, options);
  if (!line || !points.length) return "";
  const first = points[0];
  const last = points[points.length - 1];
  return `${line} L ${last.x.toFixed(2)} ${baselineY.toFixed(2)} L ${first.x.toFixed(2)} ${baselineY.toFixed(2)} Z`;
}

export function sparklinePoints(values: number[], width = 100, height = 24): string {
  const nums = (values || []).map((value) => Math.max(0, Number(value) || 0));
  const data = nums.length >= 2 ? nums : [0, 0];
  const max = Math.max(...data, 1);
  const step = width / (data.length - 1);
  return data
    .map((value, index) => {
      const x = index * step;
      const y = height - (value / max) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
