window.WorkerCharts = (function () {
  function niceMax(value) {
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

  function buildTicks(max, count = 4) {
    const m = niceMax(max);
    if (m <= 1) {
      return { max: 1, ticks: [0, 1] };
    }
    const ticks = [];
    for (let i = 0; i < count; i += 1) {
      ticks.push(Number(((m * i) / (count - 1)).toFixed(4)));
    }
    return { max: m, ticks };
  }

  function formatCountTick(tick) {
    return String(Math.round(tick));
  }

  function uniqueAxisLabels(ticks, formatter) {
    const seen = new Set();
    const out = [];
    ticks.forEach((tick) => {
      const label = formatter(tick);
      if (seen.has(label)) return;
      seen.add(label);
      out.push({ tick, label });
    });
    return out;
  }

  function xLabelStep(count, plotWidth, minLabelPx = 46) {
    if (count <= 1) return 1;
    const maxLabels = Math.max(2, Math.floor(plotWidth / minLabelPx));
    return Math.max(1, Math.ceil((count - 1) / Math.max(1, maxLabels - 1)));
  }

  function xLabelIndices(count, step) {
    if (count <= 0) return [];
    if (count === 1) return [0];
    const indices = [];
    for (let i = 0; i < count; i += step) indices.push(i);
    if (indices[indices.length - 1] !== count - 1) indices.push(count - 1);
    return indices;
  }

  function toPoints(values, xAt, yAt) {
    return values.map((v, i) => ({ x: xAt(i), y: yAt(v) }));
  }

  /** Catmull-Rom → cubic Bezier with mild tension and Y clamp (no sharp corners / less overshoot). */
  function smoothLinePath(points, { tension = 0.28, yMin = -Infinity, yMax = Infinity } = {}) {
    if (!points.length) return "";
    if (points.length === 1) {
      return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
    }
    if (points.length === 2) {
      return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)} L ${points[1].x.toFixed(2)} ${points[1].y.toFixed(2)}`;
    }

    const clampY = (y) => Math.min(yMax, Math.max(yMin, y));
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

  function smoothAreaPath(points, baselineY, options) {
    const line = smoothLinePath(points, options);
    if (!line || !points.length) return "";
    const first = points[0];
    const last = points[points.length - 1];
    return `${line} L ${last.x.toFixed(2)} ${baselineY.toFixed(2)} L ${first.x.toFixed(2)} ${baselineY.toFixed(2)} Z`;
  }

  function renderDynamicsChart(container, points, options = {}) {
    if (!container) return;

    const rows = Array.isArray(points) ? points : [];
    const profitOnly = Boolean(options.profitOnly);
    let resizeObserver = null;

    function destroyChart() {
      resizeObserver?.disconnect();
      resizeObserver = null;
      container.innerHTML = "";
    }

    destroyChart();
    container.className = "chart-area dynamics-chart";

    if (!rows.length) {
      container.classList.add("is-empty");
      const emptyEl = document.createElement("div");
      emptyEl.className = "dynamics-empty";
      emptyEl.textContent = options.empty || "";
      container.appendChild(emptyEl);
      return;
    }

    container.classList.remove("is-empty");

    const logsCounts = rows.map((p) => Number(p.logsCount || 0));
    const mafileCounts = rows.map((p) => Number(p.mafileCount || 0));
    const profitAmounts = rows.map((p) => Number(p.profitUsd || 0));
    const countScale = buildTicks(Math.max(...logsCounts, ...mafileCounts, 0));
    const amountScale = buildTicks(Math.max(...profitAmounts, 0));
    const n = rows.length;

    const pad = { top: 16, right: 48, bottom: 30, left: 32 };
    const H = 240;

    let showLogs = !profitOnly;
    let showMafile = !profitOnly;
    let showProfit = true;
    let logsLine;
    let mafileLine;
    let profitLine;
    let profitArea;
    let logsArea;
    let dots;
    let tip;
    let wrap;
    let resizeScheduled = false;

    function measureWidth() {
      const host = container.closest(".section") || container.parentElement || container;
      const width = host?.clientWidth ? host.clientWidth - 24 : container.clientWidth;
      return Math.max(280, width || 280);
    }

    function scheduleDraw() {
      if (resizeScheduled) return;
      resizeScheduled = true;
      requestAnimationFrame(() => {
        resizeScheduled = false;
        drawChart();
      });
    }

    function drawChart() {
      const W = measureWidth();
      const plotW = W - pad.left - pad.right;
      const plotH = H - pad.top - pad.bottom;
      const labelStep = xLabelStep(n, plotW);
      const labelIndices = xLabelIndices(n, labelStep);
      const baselineY = pad.top + plotH;
      const curveOpts = { tension: 0.28, yMin: pad.top, yMax: baselineY };

      const xAt = (i) => pad.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
      const yCount = (v) => pad.top + plotH - (v / countScale.max) * plotH;
      const yAmount = (v) => pad.top + plotH - (v / amountScale.max) * plotH;

      if (!wrap) {
        const svgNS = "http://www.w3.org/2000/svg";
        wrap = document.createElement("div");
        wrap.className = "dynamics-chart-inner";

        const svg = document.createElementNS(svgNS, "svg");
        svg.setAttribute("class", "dynamics-svg");
        svg.setAttribute("preserveAspectRatio", "none");
        svg.setAttribute("width", "100%");
        svg.setAttribute("height", String(H));

        const defs = document.createElementNS(svgNS, "defs");
        defs.innerHTML = `
          <linearGradient id="dynamicsProfitFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#f2f2f2" stop-opacity="0.18"/>
            <stop offset="100%" stop-color="#f2f2f2" stop-opacity="0"/>
          </linearGradient>
          <linearGradient id="dynamicsLogsFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#7a7a7a" stop-opacity="0.14"/>
            <stop offset="100%" stop-color="#7a7a7a" stop-opacity="0"/>
          </linearGradient>
          <linearGradient id="dynamicsProfitFillLight" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#222222" stop-opacity="0.12"/>
            <stop offset="100%" stop-color="#222222" stop-opacity="0"/>
          </linearGradient>
        `;
        svg.appendChild(defs);

        const grid = document.createElementNS(svgNS, "g");
        grid.setAttribute("class", "dynamics-grid");
        svg.appendChild(grid);

        const baseline = document.createElementNS(svgNS, "line");
        baseline.setAttribute("class", "dynamics-axis-line");
        svg.appendChild(baseline);

        const leftAxis = document.createElementNS(svgNS, "g");
        leftAxis.setAttribute("class", "dynamics-axis dynamics-axis-left");
        svg.appendChild(leftAxis);

        const rightAxis = document.createElementNS(svgNS, "g");
        rightAxis.setAttribute("class", "dynamics-axis dynamics-axis-right");
        svg.appendChild(rightAxis);

        const xLabels = document.createElementNS(svgNS, "g");
        xLabels.setAttribute("class", "dynamics-x-labels");
        svg.appendChild(xLabels);

        profitArea = document.createElementNS(svgNS, "path");
        profitArea.setAttribute("class", "dynamics-area dynamics-area-profit");
        svg.appendChild(profitArea);

        logsArea = document.createElementNS(svgNS, "path");
        logsArea.setAttribute("class", "dynamics-area dynamics-area-logs");
        svg.appendChild(logsArea);

        logsLine = document.createElementNS(svgNS, "path");
        logsLine.setAttribute("class", "dynamics-line dynamics-line-logs");
        logsLine.setAttribute("fill", "none");
        svg.appendChild(logsLine);

        mafileLine = document.createElementNS(svgNS, "path");
        mafileLine.setAttribute("class", "dynamics-line dynamics-line-mafile");
        mafileLine.setAttribute("fill", "none");
        svg.appendChild(mafileLine);

        profitLine = document.createElementNS(svgNS, "path");
        profitLine.setAttribute("class", "dynamics-line dynamics-line-profit");
        profitLine.setAttribute("fill", "none");
        svg.appendChild(profitLine);

        dots = document.createElementNS(svgNS, "g");
        dots.setAttribute("class", "dynamics-dots");
        svg.appendChild(dots);

        wrap.appendChild(svg);

        tip = document.createElement("div");
        tip.className = "dynamics-tooltip";
        tip.hidden = true;
        tip.innerHTML = `
          <div class="dynamics-tooltip-date"></div>
          ${profitOnly ? "" : `<div class="dynamics-tooltip-row dynamics-tooltip-logs">
            <span class="dynamics-tooltip-swatch"></span>
            <span class="dynamics-tooltip-text"></span>
          </div>
          <div class="dynamics-tooltip-row dynamics-tooltip-mafile">
            <span class="dynamics-tooltip-swatch"></span>
            <span class="dynamics-tooltip-text"></span>
          </div>`}
          <div class="dynamics-tooltip-row dynamics-tooltip-profit">
            <span class="dynamics-tooltip-swatch"></span>
            <span class="dynamics-tooltip-text"></span>
          </div>
        `;
        wrap.appendChild(tip);
        container.appendChild(wrap);

        if (options.legendLogsEl) {
          options.legendLogsEl.addEventListener("click", () => {
            showLogs = !showLogs;
            options.legendLogsEl.classList.toggle("is-off", !showLogs);
            applyVisibility();
          });
        }
        if (options.legendMafileEl) {
          options.legendMafileEl.addEventListener("click", () => {
            showMafile = !showMafile;
            options.legendMafileEl.classList.toggle("is-off", !showMafile);
            applyVisibility();
          });
        }
        if (options.legendProfitEl) {
          options.legendProfitEl.addEventListener("click", () => {
            showProfit = !showProfit;
            options.legendProfitEl.classList.toggle("is-off", !showProfit);
            applyVisibility();
          });
        }

        if (typeof ResizeObserver !== "undefined") {
          const observeTarget = container.closest(".section") || container.parentElement || container;
          resizeObserver = new ResizeObserver(scheduleDraw);
          resizeObserver.observe(observeTarget);
        }
      }

      const svg = wrap.querySelector("svg");
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

      const grid = svg.querySelector(".dynamics-grid");
      grid.innerHTML = "";
      const gridScale = profitOnly ? amountScale : countScale;
      const gridY = profitOnly ? yAmount : yCount;
      gridScale.ticks.forEach((tick) => {
        const y = gridY(tick);
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", pad.left);
        line.setAttribute("x2", pad.left + plotW);
        line.setAttribute("y1", y);
        line.setAttribute("y2", y);
        grid.appendChild(line);
      });

      const baseline = svg.querySelector(".dynamics-axis-line");
      baseline.setAttribute("x1", pad.left);
      baseline.setAttribute("x2", pad.left + plotW);
      baseline.setAttribute("y1", baselineY);
      baseline.setAttribute("y2", baselineY);

      const leftAxis = svg.querySelector(".dynamics-axis-left");
      leftAxis.innerHTML = "";
      if (!profitOnly) {
        uniqueAxisLabels(countScale.ticks, formatCountTick).forEach(({ tick, label }) => {
          const y = yCount(tick);
          const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
          text.setAttribute("x", pad.left - 8);
          text.setAttribute("y", y + 3);
          text.setAttribute("text-anchor", "end");
          text.textContent = label;
          leftAxis.appendChild(text);
        });
      }

      const rightAxis = svg.querySelector(".dynamics-axis-right");
      rightAxis.innerHTML = "";
      const formatAmount = (tick) =>
        options.formatAmountTick ? options.formatAmountTick(tick) : `$${tick}`;
      uniqueAxisLabels(amountScale.ticks, formatAmount).forEach(({ tick, label }) => {
        const y = yAmount(tick);
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", pad.left + plotW + 8);
        text.setAttribute("y", y + 3);
        text.setAttribute("text-anchor", "start");
        text.textContent = label;
        rightAxis.appendChild(text);
      });

      const xLabels = svg.querySelector(".dynamics-x-labels");
      xLabels.innerHTML = "";
      labelIndices.forEach((i) => {
        const row = rows[i];
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("x", xAt(i));
        label.setAttribute("y", H - 8);
        label.setAttribute("text-anchor", "middle");
        label.textContent = row.label || row.date || "";
        xLabels.appendChild(label);
      });

      const logsPts = toPoints(logsCounts, xAt, yCount);
      const mafilePts = toPoints(mafileCounts, xAt, yCount);
      const profitPts = toPoints(profitAmounts, xAt, yAmount);

      logsLine.setAttribute("d", smoothLinePath(logsPts, curveOpts));
      mafileLine.setAttribute("d", smoothLinePath(mafilePts, curveOpts));
      profitLine.setAttribute("d", smoothLinePath(profitPts, curveOpts));
      logsArea.setAttribute("d", smoothAreaPath(logsPts, baselineY, curveOpts));
      profitArea.setAttribute("d", smoothAreaPath(profitPts, baselineY, curveOpts));

      dots.innerHTML = "";
      rows.forEach((row, i) => {
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.setAttribute("class", "dynamics-dot-group");
        g.dataset.index = String(i);

        const hit = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        const band = n <= 1 ? plotW : plotW / (n - 1);
        hit.setAttribute("x", xAt(i) - band / 2);
        hit.setAttribute("y", pad.top);
        hit.setAttribute("width", band);
        hit.setAttribute("height", plotH);
        hit.setAttribute("class", "dynamics-hit");
        g.appendChild(hit);

        const guide = document.createElementNS("http://www.w3.org/2000/svg", "line");
        guide.setAttribute("class", "dynamics-guide");
        guide.setAttribute("x1", xAt(i));
        guide.setAttribute("x2", xAt(i));
        guide.setAttribute("y1", pad.top);
        guide.setAttribute("y2", baselineY);
        g.appendChild(guide);

        const cLogs = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        cLogs.setAttribute("class", "dynamics-dot dynamics-dot-logs");
        cLogs.setAttribute("cx", xAt(i));
        cLogs.setAttribute("cy", yCount(logsCounts[i]));
        cLogs.setAttribute("r", 4);
        g.appendChild(cLogs);

        const cMafile = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        cMafile.setAttribute("class", "dynamics-dot dynamics-dot-mafile");
        cMafile.setAttribute("cx", xAt(i));
        cMafile.setAttribute("cy", yCount(mafileCounts[i]));
        cMafile.setAttribute("r", 4);
        g.appendChild(cMafile);

        const cProfit = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        cProfit.setAttribute("class", "dynamics-dot dynamics-dot-profit");
        cProfit.setAttribute("cx", xAt(i));
        cProfit.setAttribute("cy", yAmount(profitAmounts[i]));
        cProfit.setAttribute("r", 4);
        g.appendChild(cProfit);

        g.addEventListener("mouseenter", (e) => showTip(Number(g.dataset.index), e.clientX));
        g.addEventListener("mousemove", (e) => showTip(Number(g.dataset.index), e.clientX));
        g.addEventListener("mouseleave", () => {
          tip.hidden = true;
        });

        dots.appendChild(g);
      });

      applyVisibility();
    }

    function applyVisibility() {
      if (!logsLine || !mafileLine || !profitLine || !dots) return;
      logsLine.style.display = showLogs ? "" : "none";
      logsArea.style.display = showLogs ? "" : "none";
      mafileLine.style.display = showMafile ? "" : "none";
      profitLine.style.display = showProfit ? "" : "none";
      profitArea.style.display = showProfit ? "" : "none";
      dots.querySelectorAll(".dynamics-dot-logs").forEach((el) => {
        el.style.display = showLogs ? "" : "none";
      });
      dots.querySelectorAll(".dynamics-dot-mafile").forEach((el) => {
        el.style.display = showMafile ? "" : "none";
      });
      dots.querySelectorAll(".dynamics-dot-profit").forEach((el) => {
        el.style.display = showProfit ? "" : "none";
      });
    }

    function showTip(index, clientX) {
      const row = rows[index];
      if (!row || !tip || !wrap) return;
      tip.hidden = false;
      tip.querySelector(".dynamics-tooltip-date").textContent = row.label || row.date || "";
      if (!profitOnly) {
        tip.querySelector(".dynamics-tooltip-logs .dynamics-tooltip-text").textContent =
          `${options.logsLabel || "Logs"}: ${row.logsCount || 0}`;
        tip.querySelector(".dynamics-tooltip-mafile .dynamics-tooltip-text").textContent =
          `${options.mafileLabel || "MaFile"}: ${row.mafileCount || 0}`;
      }
      tip.querySelector(".dynamics-tooltip-profit .dynamics-tooltip-text").textContent =
        `${options.profitLabel || "Profit"}: ${row.profitDisplay || row.profitUsd || 0}`;

      const rect = wrap.getBoundingClientRect();
      const x = clientX - rect.left;
      tip.style.left = `${Math.max(72, Math.min(rect.width - 72, x))}px`;
      tip.style.top = "20px";
    }

    requestAnimationFrame(() => requestAnimationFrame(scheduleDraw));
  }

  function renderProfitChart(container, points, options = {}) {
    const rows = (Array.isArray(points) ? points : []).map((row) => ({
      ...row,
      profitUsd: Number(row.profitUsd || 0),
      logsCount: 0,
      mafileCount: 0,
      label: row.label || WorkerFormat.chartDayLabel(row.date),
      profitDisplay: row.profitDisplay || WorkerFormat.money(row.profitUsd),
    }));
    renderDynamicsChart(container, rows, { ...options, profitOnly: true });
  }

  return { renderDynamicsChart, renderProfitChart };
})();
