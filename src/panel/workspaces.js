const { adminPanelUrl, workerPanelAppUrl } = require("../utils/panelLinks");

function hostHint(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (_) {
    return "";
  }
}

/**
 * Workspaces offered by the sidebar switcher.
 *
 * The admin entry is only ever emitted for admins: the panel URL must not leak
 * to workers, so the decision is made here and never on the client.
 */
function buildWorkspaces({ isAdmin = false } = {}) {
  const list = [];

  const admin = adminPanelUrl();
  if (isAdmin && admin) {
    list.push({ id: "admin", name: "Garbona Admin", url: admin, hint: hostHint(admin) });
  }

  const worker = workerPanelAppUrl();
  if (worker) {
    list.push({ id: "worker", name: "Garbona Steam", url: worker, hint: hostHint(worker) });
  }

  list.push({ id: "polymarket", name: "PolyMarket", url: "", status: "development" });

  return list;
}

module.exports = { buildWorkspaces };
