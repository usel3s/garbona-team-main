window.PanelCharts = (function () {
  function renderBarChart(container, series, options = {}) {
    if (!container) return;
    container.innerHTML = "";
    container.classList.add("chart-wrap");

    const empty =
      Boolean(options.empty) && (!series.length || series.every((s) => !Number(s.value || 0)));

    if (empty) {
      container.classList.add("is-empty");
      const emptyEl = document.createElement("div");
      emptyEl.className = "chart-empty";
      emptyEl.textContent = options.empty;
      container.appendChild(emptyEl);
      return;
    }

    container.classList.remove("is-empty");

    const barsEl = document.createElement("div");
    barsEl.className = "chart-bars";
    const labelsEl = document.createElement("div");
    labelsEl.className = "chart-labels";
    const tip = document.createElement("div");
    tip.className = "chart-tooltip";
    tip.hidden = true;
    tip.innerHTML = `<div class="chart-tooltip-date"></div><div class="chart-tooltip-value"></div>`;

    const max = Math.max(1, ...series.map((s) => Number(s.value || 0)));

    series.forEach((item) => {
      const bar = document.createElement("div");
      bar.className = "chart-bar";
      const pct = Math.max(8, (Number(item.value || 0) / max) * 100);
      bar.style.height = `${pct}%`;

      bar.addEventListener("mouseenter", (e) => {
        tip.hidden = false;
        tip.querySelector(".chart-tooltip-date").textContent = item.label || item.date || "";
        tip.querySelector(".chart-tooltip-value").textContent =
          item.detail || `${item.display || item.value}${item.count != null ? ` · ${item.count} проф.` : ""}`;
        positionTip(container, tip, e.currentTarget);
      });
      bar.addEventListener("mousemove", (e) => {
        positionTip(container, tip, e.currentTarget);
      });
      bar.addEventListener("mouseleave", () => {
        tip.hidden = true;
      });

      barsEl.appendChild(bar);

      const lab = document.createElement("span");
      lab.textContent = item.shortLabel || item.label || "";
      labelsEl.appendChild(lab);
    });

    container.appendChild(barsEl);
    container.appendChild(labelsEl);
    container.appendChild(tip);
  }

  function positionTip(container, tip, bar) {
    const cRect = container.getBoundingClientRect();
    const bRect = bar.getBoundingClientRect();
    const x = bRect.left + bRect.width / 2 - cRect.left;
    tip.style.left = `${x}px`;
    tip.style.bottom = `${cRect.bottom - bRect.top + 10}px`;
  }

  function renderDonutChart(container, segments, options = {}) {
    if (!container) return;
    container.innerHTML = "";
    container.className = "donut-chart";
    const normalized = (segments || []).map((segment) => ({
      ...segment,
      value: Math.max(0, Number(segment.value || 0)),
    }));
    const total = normalized.reduce((sum, segment) => sum + segment.value, 0);
    const circumference = 2 * Math.PI * 78;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 220 220");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", options.ariaLabel || "Статусы MaFile");
    svg.classList.add("donut-svg");

    const track = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    track.setAttribute("cx", "110"); track.setAttribute("cy", "110"); track.setAttribute("r", "78");
    track.classList.add("donut-track");
    svg.appendChild(track);

    const tip = document.createElement("div");
    tip.className = "chart-tooltip donut-tooltip";
    tip.hidden = true;
    tip.innerHTML = `<div class="chart-tooltip-date"></div><div class="chart-tooltip-value"></div>`;
    let cursor = 0;
    normalized.forEach((segment) => {
      if (segment.value <= 0 || total <= 0) return;
      const length = (segment.value / total) * circumference;
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", "110"); circle.setAttribute("cy", "110"); circle.setAttribute("r", "78");
      circle.setAttribute("stroke", segment.color || "#6ea8ff");
      circle.setAttribute("stroke-dasharray", `${length} ${circumference - length}`);
      circle.setAttribute("stroke-dashoffset", String(-cursor));
      circle.classList.add("donut-segment");
      const showTip = (event) => {
        tip.hidden = false;
        tip.querySelector(".chart-tooltip-date").textContent = segment.label || "";
        tip.querySelector(".chart-tooltip-value").textContent =
          segment.detail || `${segment.value} из ${total}`;
        const rect = container.getBoundingClientRect();
        tip.style.left = `${event.clientX - rect.left}px`;
        tip.style.top = `${event.clientY - rect.top - 12}px`;
        tip.style.bottom = "auto";
      };
      circle.addEventListener("mouseenter", showTip);
      circle.addEventListener("mousemove", showTip);
      circle.addEventListener("mouseleave", () => { tip.hidden = true; });
      svg.appendChild(circle);
      cursor += length;
    });

    const center = document.createElement("div");
    center.className = "donut-center";
    center.innerHTML = `<strong>${total}</strong><span>${options.centerLabel || "MaFile"}</span>`;
    const visual = document.createElement("div");
    visual.className = "donut-visual";
    visual.append(svg, center, tip);

    const legend = document.createElement("div");
    legend.className = "donut-legend";
    normalized.forEach((segment) => {
      const item = document.createElement("div");
      item.className = "donut-legend-item";
      item.innerHTML = `<span class="donut-legend-dot" style="--dot:${segment.color}"></span><span>${segment.label}</span><strong>${segment.value}</strong>`;
      legend.appendChild(item);
    });
    container.append(visual, legend);
  }

  function renderSmoothLineChart(container, series, options = {}) {
    if (!container) return;
    container.innerHTML = "";
    container.className = "sc-line-chart";
    const rows = Array.isArray(series) ? series : [];
    if (!rows.length) {
      container.innerHTML = `<div class="chart-empty">${options.empty || "Недостаточно данных"}</div>`;
      return;
    }

    const width = 1000;
    const height = 280;
    const pad = { top: 24, right: 24, bottom: 42, left: 24 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const metrics = [
      { key: "amount", color: "#2ee59d", className: "amount" },
      { key: "count", color: "#3b9eff", className: "count" },
    ];
    const xAt = (index) => pad.left + (rows.length === 1 ? plotW / 2 : (index / (rows.length - 1)) * plotW);
    const pointsFor = (key) => {
      const values = rows.map((row) => Math.max(0, Number(row[key] || 0)));
      const max = Math.max(...values, 1);
      return values.map((value, index) => ({ x: xAt(index), y: pad.top + plotH - (value / max) * plotH, value }));
    };
    const smoothPath = (points) => {
      if (points.length < 2) return points.length ? `M ${points[0].x} ${points[0].y}` : "";
      return points.reduce((path, point, index) => {
        if (!index) return `M ${point.x} ${point.y}`;
        const previous = points[index - 1];
        const before = points[index - 2] || previous;
        const after = points[index + 1] || point;
        const cp1x = previous.x + (point.x - before.x) / 6;
        const cp1y = previous.y + (point.y - before.y) / 6;
        const cp2x = point.x - (after.x - previous.x) / 6;
        const cp2y = point.y - (after.y - previous.y) / 6;
        return `${path} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${point.x} ${point.y}`;
      }, "");
    };

    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", options.ariaLabel || "Динамика команды");

    const defs = document.createElementNS(ns, "defs");
    defs.innerHTML = `<linearGradient id="scChartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2ee59d" stop-opacity=".2"/><stop offset="1" stop-color="#2ee59d" stop-opacity="0"/></linearGradient>`;
    svg.appendChild(defs);
    for (let line = 0; line < 4; line += 1) {
      const y = pad.top + (line / 3) * plotH;
      const grid = document.createElementNS(ns, "line");
      grid.setAttribute("x1", pad.left); grid.setAttribute("x2", width - pad.right);
      grid.setAttribute("y1", y); grid.setAttribute("y2", y); grid.classList.add("sc-chart-grid");
      svg.appendChild(grid);
    }

    const metricPoints = {};
    metrics.forEach((metric, metricIndex) => {
      const points = pointsFor(metric.key);
      metricPoints[metric.key] = points;
      if (!metricIndex) {
        const area = document.createElementNS(ns, "path");
        area.setAttribute("d", `${smoothPath(points)} L ${points.at(-1).x} ${pad.top + plotH} L ${points[0].x} ${pad.top + plotH} Z`);
        area.classList.add("sc-chart-area-fill"); svg.appendChild(area);
      }
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", smoothPath(points));
      path.setAttribute("stroke", metric.color);
      path.classList.add("sc-chart-line", `sc-chart-line--${metric.className}`);
      svg.appendChild(path);
    });

    rows.forEach((row, index) => {
      const label = document.createElementNS(ns, "text");
      label.setAttribute("x", xAt(index)); label.setAttribute("y", height - 13);
      label.classList.add("sc-chart-label"); label.textContent = row.label || "";
      svg.appendChild(label);
    });

    const cursor = document.createElementNS(ns, "line");
    cursor.classList.add("sc-chart-cursor"); cursor.hidden = true; svg.appendChild(cursor);
    const dots = metrics.map((metric) => {
      const dot = document.createElementNS(ns, "circle");
      dot.setAttribute("r", "5"); dot.setAttribute("stroke", metric.color);
      dot.classList.add("sc-chart-dot"); dot.hidden = true; svg.appendChild(dot); return dot;
    });
    const hit = document.createElementNS(ns, "rect");
    hit.setAttribute("x", pad.left); hit.setAttribute("y", pad.top); hit.setAttribute("width", plotW); hit.setAttribute("height", plotH);
    hit.classList.add("sc-chart-hit"); svg.appendChild(hit);
    const tooltip = document.createElement("div");
    tooltip.className = "sc-line-tooltip"; tooltip.hidden = true;
    const hide = () => { tooltip.hidden = true; cursor.hidden = true; dots.forEach((dot) => { dot.hidden = true; }); };
    hit.addEventListener("pointermove", (event) => {
      const rect = svg.getBoundingClientRect();
      const px = ((event.clientX - rect.left) / rect.width) * width;
      const index = Math.max(0, Math.min(rows.length - 1, Math.round(((px - pad.left) / plotW) * (rows.length - 1))));
      const x = xAt(index); const row = rows[index];
      cursor.hidden = false; cursor.setAttribute("x1", x); cursor.setAttribute("x2", x); cursor.setAttribute("y1", pad.top); cursor.setAttribute("y2", pad.top + plotH);
      metrics.forEach((metric, i) => { const point = metricPoints[metric.key][index]; dots[i].hidden = false; dots[i].setAttribute("cx", point.x); dots[i].setAttribute("cy", point.y); });
      tooltip.hidden = false;
      tooltip.innerHTML = `<b>${row.label || row.date || ""}</b><span><i class="is-amount"></i>${options.amountLabel || "Сумма"} <strong>${row.amountDisplay || `$${Number(row.amount || 0).toFixed(2)}`}</strong></span><span><i class="is-count"></i>${options.countLabel || "Поступило"} <strong>${Number(row.count || 0)}</strong>${row.logsCount != null || row.mafileCount != null ? ` <em>(${Number(row.logsCount || 0)} логов · ${Number(row.mafileCount || 0)} MaFile)</em>` : ""}</span>`;
      tooltip.style.left = `${Math.min(container.clientWidth - 170, Math.max(8, event.clientX - rect.left + 12))}px`;
      tooltip.style.top = `${Math.max(8, event.clientY - rect.top - 86)}px`;
    });
    hit.addEventListener("pointerleave", hide);
    container.append(svg, tooltip);
  }

  return { renderBarChart, renderDonutChart, renderSmoothLineChart };
})();
