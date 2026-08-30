"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  applyWorkerDomainClaims,
  applyAdminDomainClaims,
  isForeignDomainClaim,
} = require("../src/services/domainClaimService");

test("legacy claim keeps its Cloudflare domain private to the original worker", () => {
  const claims = new Map([
    [11, { domainId: 11, ownerTelegramId: "100" }],
    [12, { domainId: 12, ownerTelegramId: "200" }],
  ]);
  const rows = applyWorkerDomainClaims(
    [
      { id: 10, domain: "native.example", isOwn: true, isTeamPublic: false, ns: [] },
      { id: 11, domain: "legacy-mine.example", isOwn: false, isTeamPublic: true, ns: ["a.ns", "b.ns"] },
      { id: 12, domain: "legacy-other.example", isOwn: false, isTeamPublic: true, ns: ["a.ns", "b.ns"] },
    ],
    claims,
    "100"
  );

  assert.deepEqual(rows.map((row) => row.domain), ["native.example", "legacy-mine.example"]);
  assert.equal(rows[1].isOwn, true);
  assert.equal(rows[1].isTeamPublic, false);
});

test("foreign legacy claim is detected", () => {
  assert.equal(isForeignDomainClaim({ ownerTelegramId: "1" }, "1"), false);
  assert.equal(isForeignDomainClaim({ ownerTelegramId: "1" }, "2"), true);
});

test("admin overlay labels a legacy claim with its original worker", () => {
  const claims = new Map([[11, { domainId: 11, ownerTelegramId: "100" }]]);
  const users = new Map([["100", { username: "worker_one" }]]);
  const [row] = applyAdminDomainClaims(
    [{ id: 11, domain: "legacy.example", ownerLabel: "@team-owner", ns: ["ns1", "ns2"] }],
    claims,
    users
  );
  assert.equal(row.ownerLabel, "@worker_one");
  assert.equal(row.ownerTelegramId, "100");
});
