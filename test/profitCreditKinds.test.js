const assert = require("node:assert/strict");
const test = require("node:test");

const {
  profitStatsFilter,
  CREDIT_KINDS,
  NON_STAT_CREDIT_KINDS,
} = require("../src/services/profitService");

test("profitStatsFilter excludes wallet credits, transfers and branch ledger", () => {
  assert.deepEqual(NON_STAT_CREDIT_KINDS, [
    CREDIT_KINDS.WALLET_CREDIT,
    CREDIT_KINDS.TRANSFER_IN,
    CREDIT_KINDS.BRANCH_COMMISSION,
    CREDIT_KINDS.BRANCH_FEE,
  ]);
  assert.deepEqual(profitStatsFilter({ userId: "u1" }), {
    userId: "u1",
    kind: { $nin: NON_STAT_CREDIT_KINDS },
  });
});
