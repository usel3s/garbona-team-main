import { useEffect, useRef, useState } from "react";
import topUrl from "../../../panel/worker/js/views/top.js?url";
import "../../../panel/worker/css/worker.css";
import "../../../panel/worker/css/panel-extra.css";
import {
  ensurePanelViewRuntime,
  PREVIEW_USER,
} from "./panelRuntime";
import "./wallet-host.css";

type TopRow = {
  rank: number;
  telegramId: string;
  displayName: string;
  username: string;
  photoUrl: string;
  fakeProfitTag: string;
  isAnonymous: boolean;
  isMe: boolean;
  totalUsd: number;
  count: number;
};

function makeSeries(days: number, seed: number) {
  const out = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(now - i * 86400000);
    const iso = date.toISOString().slice(0, 10);
    const profitUsd = Math.round((40 + ((seed * (i + 3)) % 90) + i * 2.4) * 100) / 100;
    out.push({
      date: iso,
      label: `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}`,
      profitUsd,
      profitDisplay: `$${profitUsd.toFixed(2)}`,
    });
  }
  return out;
}

const PREVIEW_TOP_ROWS: TopRow[] = [
  {
    rank: 1,
    telegramId: "1029384756",
    displayName: "Алекс",
    username: "demo_operator",
    photoUrl: "https://api.dicebear.com/9.x/thumbs/svg?seed=alex&backgroundColor=00c48c",
    fakeProfitTag: "",
    isAnonymous: false,
    isMe: true,
    totalUsd: 18420.5,
    count: 142,
  },
  {
    rank: 2,
    telegramId: "",
    displayName: "#aelita",
    username: "",
    photoUrl: "",
    fakeProfitTag: "aelita",
    isAnonymous: true,
    isMe: false,
    totalUsd: 15210.0,
    count: 118,
  },
  {
    rank: 3,
    telegramId: "7001002003",
    displayName: "Kira",
    username: "kira_eu",
    photoUrl: "https://api.dicebear.com/9.x/thumbs/svg?seed=kira&backgroundColor=2dd4bf",
    fakeProfitTag: "",
    isAnonymous: false,
    isMe: false,
    totalUsd: 12104.8,
    count: 96,
  },
  {
    rank: 4,
    telegramId: "",
    displayName: "#nox42",
    username: "",
    photoUrl: "",
    fakeProfitTag: "nox42",
    isAnonymous: true,
    isMe: false,
    totalUsd: 9870.2,
    count: 81,
  },
  {
    rank: 5,
    telegramId: "7001002005",
    displayName: "Voss",
    username: "voss_work",
    photoUrl: "https://api.dicebear.com/9.x/thumbs/svg?seed=voss&backgroundColor=a78bfa",
    fakeProfitTag: "",
    isAnonymous: false,
    isMe: false,
    totalUsd: 7420.4,
    count: 64,
  },
  {
    rank: 6,
    telegramId: "",
    displayName: "Аноним",
    username: "",
    photoUrl: "",
    fakeProfitTag: "",
    isAnonymous: true,
    isMe: false,
    totalUsd: 5102.1,
    count: 44,
  },
  {
    rank: 7,
    telegramId: "7001002007",
    displayName: "Lane",
    username: "lane_ops",
    photoUrl: "https://api.dicebear.com/9.x/thumbs/svg?seed=lane&backgroundColor=38bdf8",
    fakeProfitTag: "",
    isAnonymous: false,
    isMe: false,
    totalUsd: 3988.0,
    count: 37,
  },
];

const PREVIEW_PROFILES: Record<
  string,
  {
    telegramId: string;
    username: string;
    firstName: string;
    displayName: string;
    bio: string;
    photoUrl: string;
    role: string;
    daysInTeam: number;
    totalProfitUsd: number;
    maxProfitUsd: number;
    operationsTotal: number;
  }
> = {
  "1029384756": {
    telegramId: "1029384756",
    username: "demo_operator",
    firstName: "Алекс",
    displayName: "Алекс",
    bio: "Ведущий оператор демо-стенда.",
    photoUrl: "https://api.dicebear.com/9.x/thumbs/svg?seed=alex&backgroundColor=00c48c",
    role: "Воркер",
    daysInTeam: 214,
    totalProfitUsd: 18420.5,
    maxProfitUsd: 980.4,
    operationsTotal: 142,
  },
  "7001002003": {
    telegramId: "7001002003",
    username: "kira_eu",
    firstName: "Kira",
    displayName: "Kira",
    bio: "",
    photoUrl: "https://api.dicebear.com/9.x/thumbs/svg?seed=kira&backgroundColor=2dd4bf",
    role: "Воркер",
    daysInTeam: 160,
    totalProfitUsd: 12104.8,
    maxProfitUsd: 640.0,
    operationsTotal: 96,
  },
  "7001002005": {
    telegramId: "7001002005",
    username: "voss_work",
    firstName: "Voss",
    displayName: "Voss",
    bio: "EU night shift.",
    photoUrl: "https://api.dicebear.com/9.x/thumbs/svg?seed=voss&backgroundColor=a78bfa",
    role: "Воркер",
    daysInTeam: 88,
    totalProfitUsd: 7420.4,
    maxProfitUsd: 410.2,
    operationsTotal: 64,
  },
  "7001002007": {
    telegramId: "7001002007",
    username: "lane_ops",
    firstName: "Lane",
    displayName: "Lane",
    bio: "",
    photoUrl: "https://api.dicebear.com/9.x/thumbs/svg?seed=lane&backgroundColor=38bdf8",
    role: "Воркер",
    daysInTeam: 42,
    totalProfitUsd: 3988.0,
    maxProfitUsd: 220.5,
    operationsTotal: 37,
  },
};

function scaleRows(period: string): TopRow[] {
  const factor =
    period === "24h" ? 0.12 : period === "7d" ? 0.45 : period === "30d" ? 0.82 : 1;
  return PREVIEW_TOP_ROWS.map((row, index) => ({
    ...row,
    rank: index + 1,
    totalUsd: Math.round(row.totalUsd * factor * 100) / 100,
    count: Math.max(1, Math.round(row.count * factor)),
  }));
}

function installPreviewTopApi() {
  window.WorkerAPI = {
    async get(path: string) {
      const [clean, query = ""] = String(path || "").split("?");
      const params = new URLSearchParams(query);

      if (clean === "/top") {
        const period = params.get("period") || "7d";
        return { period, rows: scaleRows(period) };
      }

      const profileMatch = clean.match(/^\/top\/profile\/([^/]+)$/);
      if (profileMatch) {
        const telegramId = decodeURIComponent(profileMatch[1]);
        const base = PREVIEW_PROFILES[telegramId];
        if (!base) {
          throw new Error("Пользователь не найден");
        }
        const chartPeriod = params.get("chartPeriod") || "7d";
        const days = chartPeriod === "30d" ? 30 : chartPeriod === "all" ? 18 : 7;
        return {
          ...base,
          chartPeriod,
          series: makeSeries(days, Number(telegramId.slice(-3)) || 11),
        };
      }

      return {};
    },
    async post() {
      return { ok: true };
    },
    async patch() {
      return { ok: true };
    },
    async del() {
      return { ok: true };
    },
    bust() {},
  };
}

/**
 * Thin host for worker-panel top view (`panel/worker/js/views/top.js`).
 * Fake-tag / anonymous display stays in the panel logic.
 */
export default function TopPage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;

    (async () => {
      try {
        installPreviewTopApi();
        await ensurePanelViewRuntime(topUrl);
        if (cancelled) return;
        const render = window.WorkerViews?.top;
        if (typeof render !== "function") {
          throw new Error("WorkerViews.top is not available");
        }
        await render({
          main: host,
          user: PREVIEW_USER,
          refresh: true,
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
      document.body.classList.remove("top-profile-open");
      const drawer = document.getElementById("topProfileDrawer");
      if (drawer) {
        drawer.classList.remove("is-open");
        drawer.hidden = true;
      }
      host.replaceChildren();
    };
  }, []);

  return (
    <div className="gwl-host">
      {error ? <p className="gwl-host__error">{error}</p> : null}
      <div className="main" ref={hostRef} />
    </div>
  );
}
