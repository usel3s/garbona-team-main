"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildDomainLookup,
  formatAccountSourcePage,
  preferSourcePage,
} = require("../src/utils/steamSourcePage");

test("formats domain and path from UProject account fields", () => {
  assert.equal(
    formatAccountSourcePage({ domain: "falconspro.org", path: "login" }),
    "falconspro.org/login"
  );
  assert.equal(
    formatAccountSourcePage({ domain: "https://steemcommunity.com/", path: "" }),
    "steemcommunity.com/"
  );
  assert.equal(
    formatAccountSourcePage({ link: "https://demo-shop.example/gift" }),
    "demo-shop.example/gift"
  );
  assert.equal(
    formatAccountSourcePage({ linkUrl: "falconspro.org/" }),
    "falconspro.org/"
  );
  assert.equal(
    formatAccountSourcePage({ linkUrl: "falconspro.org/login" }),
    "falconspro.org/login"
  );
});

test("resolves numeric domainId through the team domain map", () => {
  const lookup = buildDomainLookup([
    { id: 12, domain: "north.team" },
    { id: 7, domain: "eu-north.work" },
  ]);
  assert.equal(
    formatAccountSourcePage({ domainId: 12, path: "offer" }, lookup),
    "north.team/offer"
  );
  assert.equal(formatAccountSourcePage({ domain: 7 }, lookup), "eu-north.work/");
  assert.equal(
    formatAccountSourcePage({ domain: { id: 12 } }, lookup),
    "north.team/"
  );
});

test("reads nested UProject domain objects and list maps", () => {
  const { domainRowsFromPayload } = require("../src/utils/steamSourcePage");
  assert.equal(
    formatAccountSourcePage({ domain: { id: 3, domain: "falconspro.org" } }),
    "falconspro.org/"
  );
  const lookup = buildDomainLookup({ 4: "steemcommunity.com" });
  assert.equal(formatAccountSourcePage({ domainId: 4 }, lookup), "steemcommunity.com/");
  assert.equal(domainRowsFromPayload({ rows: [{ id: 1, domain: "a.io" }] }).length, 1);
});

test("does not fall back to a Steam login", () => {
  assert.equal(formatAccountSourcePage({ username: "rohamfeizi" }), "");
  assert.equal(preferSourcePage("", "falconspro.org/"), "falconspro.org/");
  assert.equal(preferSourcePage("", ""), "");
});

test("parseSourcePageParts splits host and path", () => {
  const { parseSourcePageParts } = require("../src/utils/steamSourcePage");
  assert.deepEqual(parseSourcePageParts("falconspro.org/login"), {
    host: "falconspro.org",
    path: "login",
  });
  assert.deepEqual(parseSourcePageParts("https://www.falconspro.org/"), {
    host: "falconspro.org",
    path: "",
  });
  assert.deepEqual(parseSourcePageParts(""), { host: "", path: "" });
});

test("sourcePageMapFromAccounts uses UProject domainId and nested payloads", () => {
  const {
    buildDomainLookup,
    sourcePageMapFromAccounts,
    steamAccountRows,
    missingSourcePageIds,
  } = require("../src/utils/steamSourcePage");
  const lookup = buildDomainLookup([
    { id: 9, domain: "falconspro.org" },
    { id: 4, domain: "steemcommunity.com" },
  ]);
  const map = sourcePageMapFromAccounts(
    [
      { id: 829790, domainId: 9, path: "" },
      { data: { id: 811001, domain: "falconspro.org", path: "pending" } },
      { id: "bad", domain: "falconspro.org" },
    ],
    lookup
  );
  assert.equal(map.get("829790"), "falconspro.org/");
  assert.equal(map.get("811001"), "falconspro.org/pending");
  assert.equal(steamAccountRows({ rows: [{ id: 1 }, { id: 2 }] }).length, 2);
  assert.deepEqual(missingSourcePageIds(["829790", "811001", "900"], map), ["900"]);
});
