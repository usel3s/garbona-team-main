"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { serializeDomainStats } = require("../src/services/adminSitesService");

test("serializeDomainStats maps UProject funnel without duplicating AuthVisit as conversion base", () => {
  const stats = serializeDomainStats([
    { action: "PageVisit", count: 93, desktopCount: 31, devices: { Windows: 20, iOS: 35 }, countries: { US: 52 } },
    { action: "AuthVisit", count: 21, devices: { Windows: 8 }, countries: { US: 10 } },
    { action: "Log", count: 9 },
    { action: "MaFile", count: 2 },
  ]);

  assert.equal(stats.views, 93);
  assert.equal(stats.auths, 21);
  assert.equal(stats.clicks, 21);
  assert.equal(stats.logs, 9);
  assert.equal(stats.mafiles, 2);
  assert.equal(stats.desktopCount, 31);
  assert.equal(stats.desktopPercent, 33.33);
  assert.equal(stats.conversionRate, 22.58);
  assert.equal(stats.authToLogRate, 42.86);
});

test("serializeDomainStats conversion is null without views", () => {
  const stats = serializeDomainStats([{ action: "AuthVisit", count: 4, desktopCount: 1 }]);
  assert.equal(stats.views, 0);
  assert.equal(stats.auths, 4);
  assert.equal(stats.conversionRate, null);
});

test("applySteamFunnelToDomains fills Log/MaFile from Steam when UProject omits them", () => {
  const { applySteamFunnelToDomains } = require("../src/services/adminSitesService");
  const domains = [
    {
      stats: { views: 100, auths: 40, logs: 0, mafiles: 0 },
      links: [
        { stats: { views: 80, auths: 30, logs: 0, mafiles: 0 } },
        { stats: { views: 20, auths: 10, logs: 0, mafiles: 0 } },
      ],
    },
  ];
  const result = applySteamFunnelToDomains(domains, { logs: 40, mafiles: 20 });
  assert.equal(result.totalLogs, 40);
  assert.equal(result.totalMafiles, 20);
  assert.equal(result.domains[0].stats.logs, 40);
  assert.equal(result.domains[0].stats.mafiles, 20);
  assert.equal(
    result.domains[0].links[0].stats.logs + result.domains[0].links[1].stats.logs,
    40
  );
  assert.equal(
    result.domains[0].links[0].stats.mafiles + result.domains[0].links[1].stats.mafiles,
    20
  );
  assert.ok(result.domains[0].links[0].stats.logs >= result.domains[0].links[1].stats.logs);
});

test("applySteamFunnelToDomains keeps UProject Log/MaFile when present", () => {
  const { applySteamFunnelToDomains } = require("../src/services/adminSitesService");
  const domains = [
    {
      stats: { views: 10, auths: 5, logs: 3, mafiles: 1 },
      links: [{ stats: { views: 10, auths: 5, logs: 3, mafiles: 1 } }],
    },
  ];
  const result = applySteamFunnelToDomains(domains, { logs: 99, mafiles: 99 });
  assert.equal(result.totalLogs, 3);
  assert.equal(result.totalMafiles, 1);
  assert.equal(result.domains[0].links[0].stats.logs, 3);
});

test("applyDomainEarningsToDomains attributes profit by host and path", () => {
  const { applyDomainEarningsToDomains } = require("../src/services/adminSitesService");
  const domains = [
    {
      domain: "falconspro.org",
      stats: { views: 10, auths: 5, logs: 2, mafiles: 0 },
      links: [
        { path: "login", stats: { views: 8, auths: 4, logs: 2, mafiles: 0 } },
        { path: "offer", stats: { views: 2, auths: 1, logs: 0, mafiles: 0 } },
      ],
    },
  ];
  const byHost = new Map([["falconspro.org", 30]]);
  const byHostPath = new Map([
    ["falconspro.org\0login", 25],
    ["falconspro.org\0offer", 5],
  ]);
  applyDomainEarningsToDomains(domains, { byHost, byHostPath });
  assert.equal(domains[0].stats.earnedUsd, 30);
  assert.equal(domains[0].links[0].stats.earnedUsd, 25);
  assert.equal(domains[0].links[1].stats.earnedUsd, 5);
});

test("applyDomainEarningsToDomains distributes unmatched domain profit by funnel weight", () => {
  const { applyDomainEarningsToDomains } = require("../src/services/adminSitesService");
  const domains = [
    {
      domain: "falconspro.org",
      stats: { views: 100, auths: 40, logs: 40, mafiles: 0 },
      links: [
        { path: "login", stats: { views: 80, auths: 30, logs: 30, mafiles: 0 } },
        { path: "offer", stats: { views: 20, auths: 10, logs: 10, mafiles: 0 } },
      ],
    },
  ];
  const byHost = new Map([["falconspro.org", 40]]);
  const byHostPath = new Map([["falconspro.org\0", 40]]);
  applyDomainEarningsToDomains(domains, { byHost, byHostPath });
  assert.equal(domains[0].stats.earnedUsd, 40);
  assert.equal(domains[0].links[0].stats.earnedUsd, 30);
  assert.equal(domains[0].links[1].stats.earnedUsd, 10);
});

test("accumulateDomainEarnings prefers UProject page when SteamLog.sourcePage is empty", () => {
  const {
    collectSourcePagesFromLogs,
    attachResolvedPagesToTxIds,
    accumulateDomainEarnings,
  } = require("../src/services/adminSitesService");
  const { missingSourcePageIds } = require("../src/utils/steamSourcePage");

  const logs = [
    { sourceId: "1001", sourcePage: "", autoSaleProfitTxId: "tx-sale" },
    { sourceId: "1002", sourcePage: "other.io/", mafileProfitTransactionId: "tx-mafile" },
  ];
  const collected = collectSourcePagesFromLogs(logs);
  assert.equal(collected.pageBySourceId.has("1001"), false);
  assert.equal(collected.pageBySourceId.get("1002"), "other.io/");
  assert.deepEqual(missingSourcePageIds(["1001", "1002"], collected.pageBySourceId), ["1001"]);

  collected.pageBySourceId.set("1001", "falconspro.org/pending");
  attachResolvedPagesToTxIds(logs, collected.pageBySourceId, collected.pageByTxId);

  const earnings = accumulateDomainEarnings(
    [
      { _id: "tx-sale", sourceId: "1001", workerShare: 12.5 },
      { _id: "tx-mafile", sourceId: "1002", workerShare: 7.5 },
      { _id: "tx-credit", sourceId: "", workerShare: 80 },
    ],
    collected.pageBySourceId,
    collected.pageByTxId
  );
  assert.equal(earnings.totalUsd, 20);
  assert.equal(earnings.byHost.get("falconspro.org"), 12.5);
  assert.equal(earnings.byHostPath.get("falconspro.org\0pending"), 12.5);
  assert.equal(earnings.byHost.get("other.io"), 7.5);
});
