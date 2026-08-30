const assert = require("node:assert/strict");
const test = require("node:test");

const {
  clampBranchPercent,
  splitBranchCommission,
  normalizeBranchName,
  BRANCH_CREATE_MIN_PROFITS_USD,
  BRANCH_CREATE_COST_USD,
  BRANCH_MAX_PERCENT,
  curatorConflictMessage,
  isCreateEligible,
  branchCreateMinStatsMessage,
} = require("../src/services/branchService");
const {
  CREDIT_KINDS,
  NON_STAT_CREDIT_KINDS,
  profitStatsFilter,
} = require("../src/services/profitService");

test("branch percent is clamped to 0–10", () => {
  assert.equal(clampBranchPercent(-1), 0);
  assert.equal(clampBranchPercent(0), 0);
  assert.equal(clampBranchPercent(7.4), 7);
  assert.equal(clampBranchPercent(7.6), 8);
  assert.equal(clampBranchPercent(10), 10);
  assert.equal(clampBranchPercent(99), 10);
  assert.equal(clampBranchPercent("abc"), 0);
  assert.equal(BRANCH_MAX_PERCENT, 10);
});

test("branch commission is taken from worker share", () => {
  assert.deepEqual(splitBranchCommission(80, 10), { net: 72, commission: 8 });
  assert.deepEqual(splitBranchCommission(80, 0), { net: 80, commission: 0 });
  assert.deepEqual(splitBranchCommission(1, 10), { net: 0.9, commission: 0.1 });
  assert.equal(BRANCH_CREATE_COST_USD, 100);
  assert.equal(BRANCH_CREATE_MIN_PROFITS_USD, 100);
});

test("branch name validation", () => {
  assert.equal(normalizeBranchName("  Vertu  "), "Vertu");
  assert.throws(() => normalizeBranchName("A"), /минимум/);
  assert.throws(() => normalizeBranchName("x".repeat(40)), /максимум/);
});

test("curator and branch cannot overlap", () => {
  assert.match(curatorConflictMessage({ isCurator: true }), /куратор/i);
  assert.match(curatorConflictMessage({ curatorTelegramId: "1" }), /куратору/i);
  assert.equal(curatorConflictMessage({ branchId: "abc" }), "");
});

test("branch create eligibility honors admin waiver without $100 stats", () => {
  assert.deepEqual(isCreateEligible({ canCreateBranch: true, profits: 0 }), {
    ok: true,
    waived: true,
    profits: 0,
    need: 100,
    missing: 0,
  });
  assert.equal(isCreateEligible({ canCreateBranch: false, profits: 0 }).ok, false);
  assert.equal(isCreateEligible({ canCreateBranch: false, profits: 100 }).ok, true);
  assert.equal(
    branchCreateMinStatsMessage(),
    "Ваша статистика должна быть не менее $100."
  );
});

test("branch fee and commission are excluded from profit stats", () => {
  assert.ok(NON_STAT_CREDIT_KINDS.includes(CREDIT_KINDS.BRANCH_COMMISSION));
  assert.ok(NON_STAT_CREDIT_KINDS.includes(CREDIT_KINDS.BRANCH_FEE));
  assert.deepEqual(profitStatsFilter({ userId: "u1" }), {
    userId: "u1",
    kind: { $nin: NON_STAT_CREDIT_KINDS },
  });
});

test("inline branch icons render as PNG", () => {
  const { renderCreatePlusIcon, renderBranchMarkIcon } = require("../src/utils/branchInlineIcons");
  const plus = renderCreatePlusIcon();
  const mark = renderBranchMarkIcon();
  assert.equal(plus.slice(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(mark.slice(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.ok(plus.length > 1000);
  assert.ok(mark.length > 1000);
});
