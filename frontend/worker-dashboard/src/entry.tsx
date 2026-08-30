/**
 * Worker Panel React islands entry.
 * Exposes window.WorkerDashboard and window.WorkerSites for the vanilla shell.
 */
import { createRoot, type Root } from "react-dom/client";
import Dashboard from "./Dashboard";
import Sites from "./Sites";
import SettingsPage from "./Settings";
import BranchPage from "./Branch";
import type { DashboardRenderContext } from "./types";
import type { SitesRenderContext } from "./sitesTypes";
import "./theme.css";

window.WorkerViews = window.WorkerViews || {};

type IslandKind = "dashboard" | "sites" | "settings" | "branch";

let activeRoot: Root | null = null;
let activeContainer: HTMLElement | null = null;
let activeKind: IslandKind | null = null;
let mountVersion = 0;

function unmount() {
  activeRoot?.unmount();
  activeRoot = null;
  activeContainer?.remove();
  activeContainer = null;
  activeKind = null;
}

function ensureContainer(context: DashboardRenderContext, kind: IslandKind) {
  if (activeContainer?.isConnected && activeKind === kind) {
    return activeContainer;
  }

  unmount();
  const container = document.createElement("div");
  container.className =
    kind === "dashboard"
      ? "gbd-island"
      : kind === "sites"
        ? "gbs-island"
        : kind === "settings"
          ? "gst-island"
          : "gbr-island";
  container.dataset[`${kind}Island`] = "true";
  context.main.replaceChildren(container);

  activeContainer = container;
  activeRoot = createRoot(container);
  activeKind = kind;
  return container;
}

async function mountDashboard(context: DashboardRenderContext) {
  ensureContainer(context, "dashboard");
  mountVersion += 1;
  activeRoot?.render(
    <Dashboard
      key={mountVersion}
      context={{
        ...context,
        refresh: Boolean(context.refresh),
      }}
    />,
  );
}

async function mountSites(context: SitesRenderContext) {
  ensureContainer(context, "sites");
  mountVersion += 1;
  activeRoot?.render(
    <Sites
      key={mountVersion}
      context={{
        ...context,
        refresh: Boolean(context.refresh),
      }}
    />,
  );
}

async function mountSettings(context: DashboardRenderContext) {
  ensureContainer(context, "settings");
  mountVersion += 1;
  activeRoot?.render(
    <SettingsPage
      key={mountVersion}
      context={context}
      username={String(context.user?.username || "")}
    />,
  );
}

async function mountBranch(context: DashboardRenderContext) {
  ensureContainer(context, "branch");
  mountVersion += 1;
  activeRoot?.render(<BranchPage key={mountVersion} live />);
}

window.WorkerDashboard = { mount: mountDashboard, unmount };
window.WorkerSites = { mount: mountSites, unmount };
window.WorkerViews.dashboard = mountDashboard;
window.WorkerViews.sites = mountSites;
window.WorkerViews.settings = mountSettings;
window.WorkerViews.branch = mountBranch;
