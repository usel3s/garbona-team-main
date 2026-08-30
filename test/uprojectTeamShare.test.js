const assert = require("node:assert/strict");
const test = require("node:test");

const {
  UPROJECT_TEAM_SHARE_SINCE,
  formatUprojectDebitReason,
  shouldImportUprojectDebit,
  shouldCancelImportedUprojectDebit,
  summarizeUprojectFinanceTransactions,
} = require("../src/services/uprojectTeamShareService");

const CUTOFF_TX = {
  id: 62179,
  amount: -19.13,
  createdAt: "2026-08-26T23:33:24.800Z",
  reason: "MaFileCommission",
  status: "Paid",
  data: { accountId: 821000 },
};

test("imports paid UProject commissions from 27 Aug 02:33:24 MSK inclusive", () => {
  assert.equal(shouldImportUprojectDebit(CUTOFF_TX), true);
  assert.equal(
    shouldImportUprojectDebit({
      ...CUTOFF_TX,
      createdAt: "2026-08-26T23:33:23.000Z",
    }),
    false
  );
  assert.equal(shouldImportUprojectDebit({ ...CUTOFF_TX, amount: 0 }), false);
  assert.equal(shouldImportUprojectDebit({ ...CUTOFF_TX, amount: 20, reason: "RefillCryptoInvoice" }), false);
  assert.equal(shouldImportUprojectDebit({ ...CUTOFF_TX, status: "Canceled" }), false);
  assert.equal(shouldImportUprojectDebit({ ...CUTOFF_TX, status: "Waiting" }), false);
});

test("canceled UProject txs reverse a previously imported debit", () => {
  assert.equal(shouldCancelImportedUprojectDebit({ ...CUTOFF_TX, status: "Canceled" }), true);
  assert.equal(shouldCancelImportedUprojectDebit(CUTOFF_TX), false);
  assert.equal(shouldCancelImportedUprojectDebit({ ...CUTOFF_TX, amount: 0 }), true);
});

test("UProject finance snapshot separates charges, refills and actual balance", () => {
  const summary = summarizeUprojectFinanceTransactions([
    { ...CUTOFF_TX, amount: -83.84 },
    { ...CUTOFF_TX, id: 2, amount: 29, reason: "RefillCryptoInvoice" },
    { ...CUTOFF_TX, id: 3, amount: -12.04, status: "Canceled" },
    { ...CUTOFF_TX, id: 4, amount: 7, status: "Waiting" },
  ]);
  assert.equal(summary.paidChargesUsd, 83.84);
  assert.equal(summary.paidRefillsUsd, 29);
  assert.equal(summary.balanceUsd, -54.84);
  assert.equal(summary.canceledChargesUsd, 12.04);
  assert.equal(summary.chargeCount, 1);
  assert.equal(summary.refillCount, 1);
});

test("UProject debit copy names the commission and account", () => {
  assert.equal(
    formatUprojectDebitReason(CUTOFF_TX),
    "UProject · Комиссия MaFile · #821000"
  );
  assert.match(
    formatUprojectDebitReason({ reason: "MaFileConvertCommission" }),
    /Конвертация MaFile/
  );
});

test("parseTeamShareSince reads a Moscow calendar day", () => {
  const { parseTeamShareSince, uprojectAccountId } = require("../src/services/uprojectTeamShareService");
  assert.equal(parseTeamShareSince("2026-08-27").toISOString(), "2026-08-26T21:00:00.000Z");
  assert.equal(uprojectAccountId(CUTOFF_TX), "821000");
  assert.throws(() => parseTeamShareSince(""), /дату/i);
});

test("team-share ops search matches MaFile account id", () => {
  const { buildTeamShareOpsMatch } = require("../src/services/teamShareLedgerService");
  assert.deepEqual(buildTeamShareOpsMatch(""), {});
  assert.deepEqual(buildTeamShareOpsMatch("#821000"), {
    $or: [
      { accountId: "821000" },
      { externalId: "821000" },
      { reason: /#821000(?:\D|$)/ },
    ],
  });
  const uproject = buildTeamShareOpsMatch("UProject");
  assert.equal(uproject.$or.some((clause) => clause.source === "uproject"), true);
});

test("flags only invalid MaFile, not low yield or missing withdrawal", () => {
  const { classifyTeamShareMafileFlag } = require("../src/services/teamShareLedgerService");
  assert.equal(classifyTeamShareMafileFlag(null), null);
  assert.equal(classifyTeamShareMafileFlag({ mafileStatus: "pending", inventoryUsd: 350 }), null);
  assert.equal(
    classifyTeamShareMafileFlag({ mafileStatus: "invalid", inventoryUsd: 350 }).kind,
    "invalid"
  );
  assert.equal(
    classifyTeamShareMafileFlag({
      mafileStatus: "pending",
      accountStatus: "Invalid",
      inventoryUsd: 200,
    }).kind,
    "invalid"
  );
  assert.equal(
    classifyTeamShareMafileFlag({
      mafileStatus: "withdrawn",
      inventoryUsd: 350,
      mafileWithdrawnAmount: 80,
    }),
    null
  );
  assert.equal(
    classifyTeamShareMafileFlag({
      mafileStatus: "withdrawn",
      inventoryUsd: 350,
      mafileWithdrawnAmount: 140,
    }),
    null
  );
});

test("does not flag commission greater than withdrawn yield", () => {
  const {
    classifyTeamShareIssue,
    teamShareAdminLabel,
    teamShareFlagExportTxt,
  } = require("../src/services/teamShareLedgerService");
  const issue = classifyTeamShareIssue(
    {
      mafileStatus: "withdrawn",
      inventoryUsd: 381.89,
      mafileWithdrawnAmount: 8,
    },
    19.13
  );
  assert.equal(issue.kind, "");
  assert.equal(issue.withdrawnUsd, 8);
  assert.equal(issue.shortfallUsd, 0);
  assert.equal(issue.flagged, false);
  assert.equal(teamShareAdminLabel({ source: "uproject" }), "UProject");
  assert.equal(teamShareAdminLabel({ actorUsername: "dover" }), "@dover");
  const txt = teamShareFlagExportTxt([
    {
      createdAt: new Date("2026-08-27T12:00:00.000Z"),
      amountUsd: 19.13,
      withdrawnUsd: 0,
      inventoryUsd: 120,
      accountId: "832306",
      flag: "unsold",
      flagLabel: "Не продан",
      converted: true,
      logId: "832306",
      source: "uproject",
      reason: "UProject · Конвертация MaFile · #832306",
    },
  ]);
  assert.equal(
    txt,
    [
      "1. Конвертация MaFile · #832306",
      "Дата: 2026-08-27 12:00:00 UTC",
      "Комиссия: $19.13",
      "Снято: $0.00",
      "Инвентарь: $120.00",
      "Статус: Не продан",
      "",
      "Итого: $19.13",
    ].join("\n")
  );
});

test("flag export uses invalid label, not missing withdrawal", () => {
  const { teamShareFlagExportTxt } = require("../src/services/teamShareLedgerService");
  const txt = teamShareFlagExportTxt([
    {},
    {},
    {
      createdAt: new Date("2026-08-28T01:19:17.000Z"),
      amountUsd: 0.78,
      withdrawnUsd: null,
      inventoryUsd: 15.51,
      accountId: "829324",
      flag: "invalid",
      flagLabel: "Невалид",
      reason: "UProject · Комиссия MaFile · #829324",
    },
  ]);
  assert.equal(txt.split("\n\n").at(-1), "Итого: $0.78");
  assert.equal(
    txt.split("\n\n")[2],
    [
      "3. Комиссия MaFile · #829324",
      "Дата: 2026-08-28 01:19:17 UTC",
      "Комиссия: $0.78",
      "Снято: —",
      "Инвентарь: $15.51",
      "Статус: Невалид",
    ].join("\n")
  );
});

test("converted log sale outcome drives the write-off flag", () => {
  const { classifyTeamShareIssue } = require("../src/services/teamShareLedgerService");
  const convert = { kind: "MaFileConvertCommission", accountId: "832306" };
  const base = {
    convertedFromMafile: true,
    inventoryUsd: 120,
    mafileStatus: "pending",
    mafileWithdrawnAmount: 0,
  };

  const sold = classifyTeamShareIssue(
    { ...base, accountStatus: "Sold", autoSaleGrossUsd: 8.4 },
    19.13,
    convert
  );
  assert.equal(sold.kind, "");
  assert.equal(sold.flagged, false);
  assert.equal(sold.withdrawnUsd, 8.4);

  const onHold = classifyTeamShareIssue(
    { ...base, accountStatus: "OnHold", autoSaleStatus: "sold_held" },
    19.13,
    convert
  );
  assert.equal(onHold.kind, "");
  assert.equal(onHold.flagged, false);

  const onSale = classifyTeamShareIssue(
    { ...base, accountStatus: "OnSell", autoSaleStatus: "listed" },
    19.13,
    convert
  );
  assert.equal(onSale.kind, "");
  assert.equal(onSale.flagged, false);

  const converted = classifyTeamShareIssue(
    { ...base, accountStatus: "Converted" },
    19.13,
    convert
  );
  assert.equal(converted.kind, "unsold");
  assert.equal(converted.label, "Не продан");
  assert.equal(converted.flagged, true);
  assert.equal(converted.shortfallUsd, 19.13);

  const failed = classifyTeamShareIssue(
    { ...base, accountStatus: "Converted", autoSaleStatus: "failed" },
    19.13,
    convert
  );
  assert.equal(failed.kind, "unsold");

  const deletedLot = classifyTeamShareIssue(
    { ...base, accountStatus: "Empty", autoSaleListedAt: new Date("2026-08-27T20:00:00Z") },
    19.13,
    convert
  );
  assert.equal(deletedLot.kind, "unsold");

  const soldIgnoresInventory = classifyTeamShareIssue(
    {
      ...base,
      accountStatus: "Sold",
      autoSaleGrossUsd: 5,
      inventoryUsd: 400,
      mafileWithdrawnAmount: 5,
    },
    19.13,
    convert
  );
  assert.equal(soldIgnoresInventory.kind, "");
  assert.equal(soldIgnoresInventory.flagged, false);
  assert.equal(sold.logId, "832306");
  assert.match(sold.detail, /лог #832306/);
});

test("shows withdrawn amount without flagging missing or low yield", () => {
  const {
    classifyTeamShareIssue,
    isFlaggedTeamShareKind,
    teamShareAccountId,
    serializeTeamShareOperation,
  } = require("../src/services/teamShareLedgerService");
  const issue = classifyTeamShareIssue(
    {
      mafileStatus: "pending",
      inventoryUsd: 381.89,
      mafileWithdrawnAmount: 78,
    },
    19.13,
    { accountId: "827530" }
  );
  assert.equal(issue.kind, "");
  assert.equal(issue.withdrawnUsd, 78);
  assert.equal(issue.inventoryUsd, 381.89);
  assert.equal(issue.flagged, false);
  assert.equal(isFlaggedTeamShareKind(issue.kind), false);

  const missing = classifyTeamShareIssue(null, 19.13, { accountId: "827530" });
  assert.equal(missing.kind, "");
  assert.equal(missing.withdrawnUsd, null);
  assert.equal(missing.flagged, false);
  assert.equal(isFlaggedTeamShareKind(missing.kind), false);

  assert.equal(teamShareAccountId({ reason: "UProject · Комиссия MaFile · #827530" }), "827530");
  assert.equal(
    serializeTeamShareOperation({
      _id: "op1",
      amountUsd: 19.13,
      reason: "UProject · Комиссия MaFile · #827530",
      source: "uproject",
    }).accountId,
    "827530"
  );
});

test("preliminary invalid MaFile session is flagged Невалид", () => {
  const { classifyTeamShareIssue, isMafileInvalid } = require("../src/services/teamShareLedgerService");
  const pendingMafile = {
    logKind: "mafile",
    accountStatus: "MaFile",
    mafileStatus: "pending",
    inventoryUsd: 40,
  };

  assert.equal(isMafileInvalid(pendingMafile), false);
  assert.equal(classifyTeamShareIssue(pendingMafile, 1.2).kind, "");

  const byInvalidDate = classifyTeamShareIssue(
    { ...pendingMafile, invalidDate: "2026-08-28T05:22:00.000Z" },
    1.2
  );
  assert.equal(byInvalidDate.kind, "invalid");
  assert.equal(byInvalidDate.label, "Невалид");
  assert.equal(byInvalidDate.flagged, true);

  const bySessionFlag = classifyTeamShareIssue({ ...pendingMafile, sessionInvalid: true }, 1.2);
  assert.equal(bySessionFlag.kind, "invalid");
  assert.equal(bySessionFlag.label, "Невалид");

  const byInvalidSession = classifyTeamShareIssue(
    { ...pendingMafile, accountStatus: "InvalidSession" },
    1.2
  );
  assert.equal(byInvalidSession.kind, "invalid");
  assert.equal(byInvalidSession.label, "Невалид");

  const convertedKeepUnsold = classifyTeamShareIssue(
    {
      ...pendingMafile,
      convertedFromMafile: true,
      accountStatus: "Converted",
      invalidDate: "2026-08-28T05:22:00.000Z",
      sessionInvalid: true,
    },
    1.2,
    { kind: "MaFileConvertCommission", accountId: "832306" }
  );
  assert.equal(convertedKeepUnsold.kind, "unsold");
  assert.equal(convertedKeepUnsold.label, "Не продан");
});

test("team-share export period is Moscow time and exclusive at the end", () => {
  const {
    parseTeamShareDateTime,
    formatTeamShareDateTime,
    resolveTeamShareExportRange,
    nextTeamShareExportCursor,
    buildTeamShareCreatedAtMatch,
    teamShareFlagExportTxt,
  } = require("../src/services/teamShareLedgerService");

  const start = parseTeamShareDateTime("28.08.2026 10:30:00");
  const end = parseTeamShareDateTime("28.08.2026 14:00:00");
  assert.equal(start.toISOString(), "2026-08-28T07:30:00.000Z");
  assert.equal(end.toISOString(), "2026-08-28T11:00:00.000Z");
  assert.equal(formatTeamShareDateTime(start), "28.08.2026 10:30:00");
  assert.equal(parseTeamShareDateTime(""), null);

  const manual = resolveTeamShareExportRange({
    from: "28.08.2026 10:30:00",
    to: "28.08.2026 14:00:00",
    lastExportTime: new Date("2026-08-20T00:00:00.000Z"),
  });
  assert.equal(manual.mode, "manual");
  assert.equal(manual.start.toISOString(), start.toISOString());
  assert.equal(manual.end.toISOString(), end.toISOString());

  const auto = resolveTeamShareExportRange({
    from: "",
    to: "",
    lastExportTime: start,
    now: end,
  });
  assert.equal(auto.mode, "auto");
  assert.equal(auto.start.toISOString(), start.toISOString());
  assert.equal(auto.end.toISOString(), end.toISOString());

  const autoToUserEnd = resolveTeamShareExportRange({
    from: "",
    to: "28.08.2026 14:00:00",
    lastExportTime: start,
  });
  assert.equal(autoToUserEnd.mode, "auto");
  assert.equal(autoToUserEnd.end.toISOString(), end.toISOString());

  assert.throws(() => resolveTeamShareExportRange({ from: "", to: "" }), /начала/i);
  assert.throws(
    () => resolveTeamShareExportRange({ from: "28.08.2026 14:00:00", to: "28.08.2026 10:30:00" }),
    /раньше/i
  );

  assert.deepEqual(buildTeamShareCreatedAtMatch({ start, end }), {
    createdAt: { $gte: start, $lt: end },
  });

  const later = new Date("2026-08-28T12:00:00.000Z");
  assert.equal(nextTeamShareExportCursor(end, later).toISOString(), later.toISOString());
  assert.equal(nextTeamShareExportCursor(later, end).toISOString(), later.toISOString());

  const txt = teamShareFlagExportTxt(
    [{ amountUsd: 1.5, accountId: "1", reason: "UProject · Комиссия MaFile · #1", flagLabel: "Невалид" }],
    { start, end }
  );
  assert.match(txt, /^Период: 28\.08\.2026 10:30:00 — 28\.08\.2026 14:00:00 МСК/);
  assert.match(txt, /Итого: \$1\.50$/);
});

test("full team-share export includes balance and operation audit fields", () => {
  const { teamShareFullExportTxt } = require("../src/services/teamShareLedgerService");
  const txt = teamShareFullExportTxt(
    [
      {
        createdAt: new Date("2026-08-30T07:20:53.809Z"),
        amountUsd: 0.31,
        accountId: "837006",
        externalId: "62608",
        source: "uproject",
        kind: "MaFileConvertCommission",
        status: "active",
        withdrawnUsd: 2.4,
        inventoryUsd: 12,
        reason: "UProject · Конвертация MaFile · #837006",
      },
    ],
    {},
    {
      teamShareGrossUsd: 93.79,
      teamShareDebitedUsd: 95.88,
      teamShareUsd: -2.09,
      teamShareOnHoldUsd: 82.69,
    }
  );
  assert.match(txt, /Доля команды — полный отчёт/);
  assert.match(txt, /Начислено без холда: \$93\.79/);
  assert.match(txt, /Списано всего: \$95\.88/);
  assert.match(txt, /Итог: −\$2\.09/);
  assert.match(txt, /В холде: \$82\.69/);
  assert.match(txt, /MaFile: #837006/);
  assert.match(txt, /ID операции UProject: 62608/);
  assert.match(txt, /Состояние операции: Активна/);
});
