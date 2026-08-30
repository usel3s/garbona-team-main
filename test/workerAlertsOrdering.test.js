const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildAlertsFromDomains,
  sortAlertsNewestFirst,
} = require("../src/services/workerAlertsService");

test("sorts alerts newest-first without severity priority", () => {
  const alerts = [
    { id: "old-danger", severity: "danger", createdAt: "2026-08-09T10:00:00.000Z" },
    { id: "new-info", severity: "info", createdAt: "2026-08-14T10:00:00.000Z" },
    { id: "tie-warn", severity: "warn", createdAt: "2026-08-11T10:00:00.000Z" },
    { id: "tie-danger", severity: "danger", createdAt: "2026-08-11T10:00:00.000Z" },
    { id: "missing-date", severity: "danger", createdAt: null },
  ];

  assert.deepEqual(
    sortAlertsNewestFirst(alerts).map((alert) => alert.id),
    ["new-info", "tie-warn", "tie-danger", "old-danger", "missing-date"]
  );
  assert.deepEqual(
    alerts.map((alert) => alert.id),
    ["old-danger", "new-info", "tie-warn", "tie-danger", "missing-date"]
  );
});

test("orders generated domain alerts chronologically", () => {
  const [newest, oldest] = buildAlertsFromDomains([
    {
      id: 1,
      domain: "example.com",
      isPaused: true,
      updatedAt: "2026-08-09T10:00:00.000Z",
      banChecks: {
        updatedAt: "2026-08-11T10:00:00.000Z",
        google: { banned: true },
      },
    },
  ]);

  assert.equal(newest.type, "ban");
  assert.equal(oldest.type, "paused");
});

test("frontend keeps chronological and stable ordering defensively", () => {
  global.window = {};
  require("../panel/worker/js/notif.js");

  const alerts = [
    { id: "danger", severity: "danger", createdAt: "2026-08-11T10:00:00.000Z" },
    { id: "info", severity: "info", createdAt: "2026-08-14T10:00:00.000Z" },
    { id: "warn", severity: "warn", createdAt: "2026-08-11T10:00:00.000Z" },
  ];

  assert.deepEqual(
    window.WorkerNotif.sortNewestFirst(alerts).map((alert) => alert.id),
    ["info", "danger", "warn"]
  );
  delete global.window;
});
