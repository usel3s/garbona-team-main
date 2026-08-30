"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  mergeCountryCounts,
  normalizeCountryKey,
  countryDisplayName,
  countryFlagCode,
  resolveSteamCountryCode,
} = require("../src/utils/countryStats");

test("normalizeCountryKey maps common aliases", () => {
  assert.equal(normalizeCountryKey("USA"), "US");
  assert.equal(normalizeCountryKey("uk"), "GB");
  assert.equal(normalizeCountryKey("СНГ"), "CIS");
  assert.equal(normalizeCountryKey("de"), "DE");
});

test("mergeCountryCounts merges object maps from stats rows", () => {
  const stats = [
    {
      action: "PageVisit",
      countries: { USA: 3, DE: 2 },
    },
    {
      action: "AuthVisit",
      countryCounts: { US: 1, FR: 4 },
    },
  ];
  assert.deepEqual(mergeCountryCounts(stats), {
    US: 4,
    DE: 2,
    FR: 4,
  });
});

test("mergeCountryCounts merges array payloads and link-level geo", () => {
  const stats = [
    {
      action: "PageVisit",
      countries: [
        { code: "PL", count: 2 },
        { country: "TR", value: 1 },
      ],
    },
  ];
  const link = {
    countryCounts: { ES: 5 },
  };
  assert.deepEqual(mergeCountryCounts(stats, link), {
    PL: 2,
    TR: 1,
    ES: 5,
  });
});

test("countryDisplayName localizes ISO and bucket codes", () => {
  assert.equal(countryDisplayName("US"), "США");
  assert.equal(countryDisplayName("CIS"), "СНГ");
  assert.match(countryDisplayName("DE"), /Герман/i);
});

test("resolveSteamCountryCode prefers loccountrycode and name aliases", () => {
  assert.equal(countryFlagCode("Russia"), "RU");
  assert.equal(countryFlagCode("uk"), "GB");
  assert.equal(resolveSteamCountryCode({ loccountrycode: "ru" }), "RU");
  assert.equal(resolveSteamCountryCode({ country: "Россия" }), "RU");
  assert.equal(resolveSteamCountryCode({ countryCode: "PL" }), "PL");
});
