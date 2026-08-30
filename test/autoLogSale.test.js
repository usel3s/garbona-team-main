const assert = require("node:assert/strict");
const test = require("node:test");

const {
  classifyLztSaleState,
  isGuaranteeHoldActive,
  convertRubToUsd,
  workerShareFromGross,
  readPriceRub,
  resolveSaleAmounts,
} = require("../src/services/lztMarketService");
const {
  shouldEnqueueAutoSell,
  extractLztItemId,
  extractLztItemIdFromTask,
  extractTaskId,
  lztMarketUrl,
  isTaskInProgress,
} = require("../src/services/autoLogSaleService");
const { getAvailableUsd } = require("../src/services/withdrawalService");

test("classifyLztSaleState: active → listed", () => {
  assert.equal(classifyLztSaleState({ item_state: "active" }), "listed");
  assert.equal(classifyLztSaleState({ item_state: "pre_active" }), "listed");
});

test("classifyLztSaleState: paid with hold → sold_held", () => {
  assert.equal(
    classifyLztSaleState({ item_state: "paid", guarantee: true }),
    "sold_held"
  );
  const endDate = Math.floor(Date.now() / 1000) + 3600;
  assert.equal(
    classifyLztSaleState({
      item_state: "paid",
      guarantee: {
        duration: 43200,
        endDate,
        active: true,
        remainingTime: 3600,
        remainingTimePhrase: "1 час",
      },
    }),
    "sold_held"
  );
});

test("classifyLztSaleState: paid without guarantee → released", () => {
  assert.equal(
    classifyLztSaleState({ item_state: "paid", guarantee: false }),
    "released"
  );
  assert.equal(isGuaranteeHoldActive({ item_state: "paid", guarantee: false }), false);
  assert.equal(
    isGuaranteeHoldActive({
      item_state: "paid",
      guarantee: { active: false, endDate: Math.floor(Date.now() / 1000) - 60 },
    }),
    false
  );
});

test("readHoldInfo extracts endDate and phrases", () => {
  const { readHoldInfo, extractClaimItemId } = require("../src/services/lztMarketService");
  const endDate = Math.floor(Date.now() / 1000) + 7200;
  const hold = readHoldInfo({
    guarantee: {
      endDate,
      remainingTimePhrase: "2 часа",
      durationPhrase: "12 часов",
      active: true,
    },
  });
  assert.ok(hold.holdUntil instanceof Date);
  assert.equal(hold.remainingPhrase, "2 часа");
  assert.equal(hold.durationPhrase, "12 часов");
  const numericHold = readHoldInfo({
    operation_date: 1_800_000_000,
    guarantee: {
      duration: 43200,
      active: true,
    },
  });
  assert.equal(numericHold.durationPhrase, "12ч");
  assert.equal(numericHold.holdUntil.toISOString(), "2027-01-15T20:00:00.000Z");
  assert.equal(
    extractClaimItemId({
      message_body: 'Товар: [unfurl="https://lzt.market/255329030/"]https://lzt.market/255329030/',
    }),
    "255329030"
  );
});

test("classifyLztSaleState: deleted while listed → terminal_unsold", () => {
  assert.equal(classifyLztSaleState({ item_state: "deleted" }), "terminal_unsold");
});

test("convertRubToUsd and worker share", () => {
  assert.equal(convertRubToUsd(900, 90), 10);
  assert.equal(workerShareFromGross(10, 80), 8);
  assert.equal(workerShareFromGross(10, 100), 10);
  assert.equal(readPriceRub({ rub_price: 376, price: 4.49 }), 376);
  assert.equal(readPriceRub({ price: 4.49 }), 0);
});

test("resolveSaleAmounts prefers LZT USD price over mistaken RUB", () => {
  const amounts = resolveSaleAmounts({ price: 4.49, rub_price: 376 }, 90);
  assert.equal(amounts.priceRub, 376);
  assert.equal(amounts.grossUsd, 4.49);
  assert.equal(amounts.priceIsUsd, true);
});

test("getAvailableUsd subtracts reserved and frozen sale funds", async () => {
  const available = await getAvailableUsd({
    totalProfit: 100,
    reservedWithdrawalUsd: 20,
    frozenSaleUsd: 15,
  });
  assert.equal(available, 65);
});

test("held auto-sale: worker share credited and frozen until release", () => {
  const gross = 150.1;
  const percent = 80;
  const expectedShare = workerShareFromGross(gross, percent);
  const teamCut = Number((gross - expectedShare).toFixed(2));
  // creditSoldHeld: +worker share to totalProfit and frozenSaleUsd
  let totalProfit = expectedShare;
  let frozenSaleUsd = expectedShare;
  assert.equal(Number((totalProfit - frozenSaleUsd).toFixed(2)), 0);
  // releaseHold (new model): unfreeze worker share only, no team cut
  frozenSaleUsd = Number((frozenSaleUsd - expectedShare).toFixed(2));
  assert.equal(frozenSaleUsd, 0);
  assert.equal(totalProfit, expectedShare);
  assert.equal(expectedShare, 120.08);
  assert.ok(teamCut > 0);
});

test("held auto-sale legacy: full gross frozen until release cut", () => {
  const { isLegacyFullGrossHold } = require("../src/services/autoLogSaleService");
  const gross = 150.1;
  const percent = 80;
  const expectedShare = workerShareFromGross(gross, percent);
  const teamCut = Number((gross - expectedShare).toFixed(2));
  assert.equal(isLegacyFullGrossHold(gross, gross), true);
  assert.equal(isLegacyFullGrossHold(expectedShare, gross), false);
  let totalProfit = gross;
  let frozenSaleUsd = gross;
  frozenSaleUsd = Number((frozenSaleUsd - gross).toFixed(2));
  totalProfit = Number((totalProfit - teamCut).toFixed(2));
  assert.equal(frozenSaleUsd, 0);
  assert.equal(totalProfit, expectedShare);
});

test("shouldEnqueueAutoSell guards", () => {
  const baseLog = {
    logKind: "valid",
    status: "processed",
    autoSaleStatus: "none",
    sourceId: "123",
  };
  assert.equal(shouldEnqueueAutoSell(baseLog, { autoSellLogs: true }), true);
  assert.equal(shouldEnqueueAutoSell(baseLog, { autoSellLogs: false }), false);
  assert.equal(shouldEnqueueAutoSell(baseLog, {}), true);
  assert.equal(
    shouldEnqueueAutoSell({ ...baseLog, logKind: "mafile" }, { autoSellLogs: true }),
    false
  );
  assert.equal(
    shouldEnqueueAutoSell({ ...baseLog, autoSaleStatus: "listed" }, { autoSellLogs: true }),
    false
  );
  assert.equal(
    shouldEnqueueAutoSell({ ...baseLog, status: "failed" }, { autoSellLogs: true }),
    false
  );
});

test("extractLztItemId and task id helpers", () => {
  assert.equal(extractLztItemId({ lztLinkId: 255418649 }), "255418649");
  assert.equal(extractLztItemId({ lzt_link_id: "https://lzt.market/255418649" }), "255418649");
  assert.equal(extractTaskId({ data: { id: 42 } }), "42");
  assert.equal(lztMarketUrl("255418649"), "https://lzt.market/255418649");
  assert.equal(
    extractLztItemIdFromTask({
      state: "InProcess",
      steam: {
        tasks: [
          { task: "CheckValid", state: "Done" },
          {
            task: "SellLZT",
            state: "InProcess",
            data: { item_id: 255732203, state: "AddToLzt" },
          },
        ],
      },
    }),
    "255732203"
  );
  assert.equal(isTaskInProgress({ state: "InProcess" }), true);
  assert.equal(isTaskInProgress({ state: "Done" }), false);
});

test("autoSaleStatusLabel covers admin statuses", () => {
  const { autoSaleStatusLabel, mapUprojectStatusToAutoSale } = require("../src/services/autoLogSaleService");
  assert.equal(autoSaleStatusLabel("listed"), "На продаже");
  assert.equal(autoSaleStatusLabel("sold_held"), "Продан · холд");
  assert.equal(autoSaleStatusLabel("arbitration"), "Арбитраж");
  assert.equal(autoSaleStatusLabel("released"), "Продан · холд снят");
  assert.equal(autoSaleStatusLabel("refunded"), "Продажа отменена");
  assert.equal(autoSaleStatusLabel("failed"), "Ошибка");
  assert.equal(mapUprojectStatusToAutoSale("OnSell", "255"), "listed");
  assert.equal(mapUprojectStatusToAutoSale("OnSell", ""), "listing");
  assert.equal(mapUprojectStatusToAutoSale("OnHold", "255"), "sold_held");
  assert.equal(mapUprojectStatusToAutoSale("Sold", "255"), "sold_held");
});

test("worker activity status prefers stored LZT sale lifecycle over stale live status", () => {
  const {
    autoSaleActivityStatus,
    effectiveActivitySaleStatus,
    preferActivityDisplayStatus,
  } = require("../src/services/steamLogStatusService");

  const refunded = {
    autoSaleStatus: "refunded",
    saleStatus: "none",
  };
  assert.equal(autoSaleActivityStatus(refunded.autoSaleStatus), "Продажа отменена · лот удалён");
  assert.equal(effectiveActivitySaleStatus(refunded), "cancelled");
  assert.equal(
    preferActivityDisplayStatus(
      { status: "Продается", saleStatus: undefined },
      { status: "Продажа отменена · лот удалён", saleStatus: "cancelled" }
    ),
    "Продажа отменена · лот удалён"
  );

  const sold = { autoSaleStatus: "released", saleStatus: "none" };
  assert.equal(autoSaleActivityStatus(sold.autoSaleStatus), "Аккаунт продан");
  assert.equal(effectiveActivitySaleStatus(sold), "sold");
});

test("shouldFreezeOnCredit skips freeze after hold ended", () => {
  const { shouldFreezeOnCredit, hasAutoSaleProfitTx } = require("../src/services/autoLogSaleService");
  assert.equal(shouldFreezeOnCredit(true, "listed"), false);
  assert.equal(shouldFreezeOnCredit(false, "released"), false);
  assert.equal(shouldFreezeOnCredit(false, "listed"), true);
  assert.equal(shouldFreezeOnCredit(false, "sold_held"), true);
  assert.equal(hasAutoSaleProfitTx({ autoSaleProfitTxId: "" }), false);
  assert.equal(hasAutoSaleProfitTx({ autoSaleProfitTxId: "abc" }), true);
});

test("accumulateAutoSaleMoney excludes hold from team and worker shares", () => {
  const { accumulateAutoSaleMoney } = require("../src/services/autoLogSaleService");
  const txById = new Map([
    ["tx1", { workerShare: 8 }],
    ["tx2", { workerShare: 16 }],
  ]);
  const money = accumulateAutoSaleMoney(
    [
      {
        autoSaleStatus: "released",
        autoSaleGrossUsd: 10,
        autoSaleWorkerShareUsd: 8,
        autoSaleProfitTxId: "tx1",
        ownerTelegramId: "1",
      },
      {
        autoSaleStatus: "sold_held",
        autoSaleGrossUsd: 20,
        autoSaleWorkerShareUsd: 16,
        autoSaleProfitTxId: "tx2",
        ownerTelegramId: "2",
      },
      {
        autoSaleStatus: "released",
        autoSaleGrossUsd: 5,
        autoSaleWorkerShareUsd: 0,
        autoSaleProfitTxId: "",
        ownerTelegramId: "3",
      },
    ],
    txById
  );
  assert.equal(money.workerShareReleasedUsd, 8);
  assert.equal(money.teamShareUsd, 7);
  assert.equal(money.teamShareReleasedUsd, 7);
  assert.equal(money.workerShareOnHoldUsd, 16);
  assert.equal(money.teamShareOnHoldUsd, 4);
  assert.equal(money.heldUsd, 16);
  assert.equal(money.missingCreditCount, 1);
  assert.equal(money.grossSoldUsd, 35);
});

test("accumulateAutoSaleMoney derives missing worker share from owner percent", () => {
  const { accumulateAutoSaleMoney } = require("../src/services/autoLogSaleService");
  const owners = new Map([["100", { telegramId: "100", profitPercent: 100 }]]);
  const money = accumulateAutoSaleMoney(
    [
      {
        ownerTelegramId: "100",
        autoSaleStatus: "released",
        autoSaleGrossUsd: 33.65,
        autoSaleWorkerShareUsd: 0,
        autoSaleProfitTxId: "",
      },
    ],
    new Map(),
    owners
  );

  assert.equal(money.workerShareReleasedUsd, 33.65);
  assert.equal(money.teamShareReleasedUsd, 0);
});

test("shouldClawbackForLztPhase: deleted/unknown credited sales", () => {
  const { shouldClawbackForLztPhase } = require("../src/services/autoLogSaleService");
  assert.equal(shouldClawbackForLztPhase("terminal_unsold", "sold_held", true), true);
  assert.equal(shouldClawbackForLztPhase("terminal_unsold", "arbitration", true), true);
  assert.equal(shouldClawbackForLztPhase("terminal_unsold", "released", true), true);
  assert.equal(shouldClawbackForLztPhase("terminal_unsold", "listed", false), false);
  assert.equal(shouldClawbackForLztPhase("unknown", "sold_held", true), true);
  assert.equal(shouldClawbackForLztPhase("unknown", "arbitration", true), true);
  assert.equal(shouldClawbackForLztPhase("unknown", "released", true), true);
  assert.equal(shouldClawbackForLztPhase("sold_held", "sold_held", true), false);
  assert.equal(shouldClawbackForLztPhase("terminal_unsold", "sold_held", false), false);
});

test("tallyLztOnSaleItems counts only allowed panel lots", () => {
  const { tallyLztOnSaleItems } = require("../src/services/lztMarketService");
  const allowed = new Set(["111"]);
  const tallied = tallyLztOnSaleItems(
    [
      { item_id: "111", price: 10 },
      { item_id: "222", price: 40 },
      { item_id: "111", price: 10 },
    ],
    90,
    allowed
  );
  assert.equal(tallied.count, 1);
  assert.equal(tallied.usd, 10);
  assert.equal(tallied.otherCount, 1);
  assert.equal(tallied.otherUsd, 40);
  assert.deepEqual(tallied.matchedIds, ["111"]);
});

test("mergeOnSaleStats adds queued lots that are not yet on LZT", () => {
  const { mergeOnSaleStats } = require("../src/services/autoLogSaleService");
  const merged = mergeOnSaleStats(
    { count: 2, usd: 20, matchedIds: ["a", "b"], otherCount: 5, otherUsd: 80 },
    [
      { lztItemId: "a", autoSaleGrossUsd: 10 },
      { lztItemId: "", autoSaleGrossUsd: 7 },
      { lztItemId: "c", autoSaleGrossUsd: 3 },
    ]
  );
  assert.equal(merged.onSale, 4);
  assert.equal(merged.onSaleUsd, 30);
  assert.equal(merged.onSalePendingCount, 2);
  assert.equal(merged.onSaleOtherCount, 5);
});

test("shouldPollLztStatus still polls uncredited released lots", () => {
  const { shouldPollLztStatus } = require("../src/services/autoLogSaleService");
  assert.equal(shouldPollLztStatus("listed", false), true);
  assert.equal(shouldPollLztStatus("sold_held", true), true);
  assert.equal(shouldPollLztStatus("released", true), false);
  assert.equal(shouldPollLztStatus("released", false), true);
  assert.equal(shouldPollLztStatus("failed", false), false);
  assert.equal(shouldPollLztStatus("released", true, true), true);
});

test("describeAutoSaleActions exposes hold credit and clawback", () => {
  const { describeAutoSaleActions } = require("../src/services/autoLogSaleService");
  const miss = describeAutoSaleActions(
    { autoSaleStatus: "released", lztItemId: "9", autoSaleProfitTxId: "" },
    { credited: false, needsCredit: true }
  );
  assert.equal(miss.canSync, true);
  assert.equal(miss.canCredit, true);
  assert.equal(miss.canReleaseHold, false);
  assert.equal(miss.canClawback, true);

  const held = describeAutoSaleActions({
    autoSaleStatus: "sold_held",
    lztItemId: "9",
    autoSaleProfitTxId: "tx",
  });
  assert.equal(held.canCredit, false);
  assert.equal(held.canReleaseHold, true);
  assert.equal(held.canClawback, true);

  const listed = describeAutoSaleActions({
    autoSaleStatus: "listed",
    lztItemId: "9",
  });
  assert.equal(listed.canSync, true);
  assert.equal(listed.canCredit, false);
  assert.equal(listed.canReleaseHold, false);
  assert.equal(listed.canClawback, false);
});

test("applyTeamShareDebits preserves a negative team balance", () => {
  const { applyTeamShareDebits } = require("../src/services/teamShareLedgerService");
  const net = applyTeamShareDebits(12.5, 4);
  assert.equal(net.teamShareGrossUsd, 12.5);
  assert.equal(net.teamShareDebitedUsd, 4);
  assert.equal(net.teamShareUsd, 8.5);
  assert.equal(applyTeamShareDebits(3, 10).teamShareUsd, -7);
});

test("shortHoldDurationPhrase and hold sold note", () => {
  const {
    shortHoldDurationPhrase,
    autoSaleHoldSoldNote,
    DEFAULT_HOLD_DURATION_SHORT,
  } = require("../src/services/autoLogSaleService");
  assert.equal(shortHoldDurationPhrase("12 часов"), "12ч");
  assert.equal(shortHoldDurationPhrase("12ч"), "12ч");
  assert.equal(shortHoldDurationPhrase(""), DEFAULT_HOLD_DURATION_SHORT);
  assert.equal(shortHoldDurationPhrase("1 день"), "1д");
  assert.equal(autoSaleHoldSoldNote("12 часов"), "Ваш лог был успешно продан, средства начислены и заморожены на 12ч.");
  assert.equal(autoSaleHoldSoldNote(""), `Ваш лог был успешно продан, средства начислены и заморожены на ${DEFAULT_HOLD_DURATION_SHORT}.`);
});

test("auto-sale statistics use a bounded recent period", () => {
  const { resolveAutoSaleStatsPeriod } = require("../src/services/autoLogSaleService");
  const now = new Date("2026-08-30T12:00:00.000Z");
  const week = resolveAutoSaleStatsPeriod("7d", now);
  assert.equal(week.key, "7d");
  assert.equal(week.label, "7 дней");
  assert.equal(week.since.toISOString(), "2026-08-23T12:00:00.000Z");
  assert.equal(resolveAutoSaleStatsPeriod("unknown", now).key, "7d");
});
