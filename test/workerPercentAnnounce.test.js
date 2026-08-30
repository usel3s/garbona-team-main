const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildWorkerPercentAnnounceHtml,
  buildWorkerPercentPanelMessageHtml,
} = require("../src/services/workerPercentAnnounceService");

test("worker percent announce copy is 80 → 70", () => {
  const tg = buildWorkerPercentAnnounceHtml({ from: 80, to: 70 });
  assert.match(tg, /70%/);
  assert.match(tg, /80%/);
  assert.match(tg, /изменён/);

  const panel = buildWorkerPercentPanelMessageHtml({ from: 80, to: 70 });
  assert.match(panel, /70%/);
  assert.match(panel, /80%/);
});
