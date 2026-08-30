const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveProfitChannelId } = require("../src/services/steamMonitorService");

test("profit channel falls back to manual profit / payouts chat", () => {
  assert.equal(
    resolveProfitChannelId({
      steamProfitChannelId: "",
      steamManualProfitChannelId: "-1003821514718",
      aboutPayoutsChatId: "-100000",
    }),
    "-1003821514718"
  );
  assert.equal(
    resolveProfitChannelId({
      steamProfitChannelId: "-100111",
      steamManualProfitChannelId: "-1003821514718",
    }),
    "-100111"
  );
  assert.equal(
    resolveProfitChannelId({
      steamProfitChannelId: "",
      steamManualProfitChannelId: "",
      aboutPayoutsChatId: "-1003821514718",
    }),
    "-1003821514718"
  );
});
