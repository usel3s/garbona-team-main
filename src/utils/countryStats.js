"use strict";

const CIS_CODES = new Set([
  "RU",
  "BY",
  "KZ",
  "UA",
  "UZ",
  "AM",
  "AZ",
  "GE",
  "KG",
  "MD",
  "TJ",
  "TM",
]);

const COUNTRY_ALIASES = Object.freeze({
  USA: "US",
  "UNITED STATES": "US",
  "UNITED STATES OF AMERICA": "US",
  US: "US",
  UK: "GB",
  "GREAT BRITAIN": "GB",
  ENGLAND: "GB",
  CIS: "CIS",
  SNG: "CIS",
  "СНГ": "CIS",
  RUSSIA: "RU",
  "RUSSIAN FEDERATION": "RU",
  RF: "RU",
  "РОССИЯ": "RU",
  РФ: "RU",
  UKRAINE: "UA",
  "УКРАИНА": "UA",
  BELARUS: "BY",
  "БЕЛАРУСЬ": "BY",
  KAZAKHSTAN: "KZ",
  "КАЗАХСТАН": "KZ",
  POLAND: "PL",
  "ПОЛЬША": "PL",
  GERMANY: "DE",
  "ГЕРМАНИЯ": "DE",
  TURKEY: "TR",
  "ТУРЦИЯ": "TR",
  CHINA: "CN",
  "КИТАЙ": "CN",
  BRAZIL: "BR",
  "БРАЗИЛИЯ": "BR",
});

const COUNTRY_LABELS = Object.freeze({
  US: "США",
  CIS: "СНГ",
  RU: "Россия",
  UA: "Украина",
  BY: "Беларусь",
  KZ: "Казахстан",
  DE: "Германия",
  FR: "Франция",
  GB: "Великобритания",
  PL: "Польша",
  TR: "Турция",
  BR: "Бразилия",
  IN: "Индия",
  CN: "Китай",
});

function normalizeCountryKey(raw) {
  const value = String(raw ?? "")
    .trim()
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "")
    .replace(/[^a-zA-Z\u0400-\u04FF\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return "";

  const upper = value.toUpperCase();
  if (COUNTRY_ALIASES[upper]) return COUNTRY_ALIASES[upper];
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  if (upper.length === 3 && upper.endsWith("A") && COUNTRY_ALIASES[upper.slice(0, 2)]) {
    return COUNTRY_ALIASES[upper.slice(0, 2)];
  }
  return upper;
}

function addCount(map, rawKey, count) {
  const amount = Number(count);
  if (!Number.isFinite(amount) || amount <= 0) return;
  const key = normalizeCountryKey(rawKey);
  if (!key) return;
  map[key] = (map[key] || 0) + amount;
}

function ingestCountryPayload(map, payload) {
  if (payload == null) return;

  if (Array.isArray(payload)) {
    for (const row of payload) {
      if (row == null) continue;
      if (typeof row === "string" || typeof row === "number") {
        addCount(map, row, 1);
        continue;
      }
      if (typeof row !== "object") continue;
      const key =
        row.code ??
        row.country ??
        row.countryCode ??
        row.geo ??
        row.name ??
        row.label ??
        row.key ??
        row.id;
      const count = row.count ?? row.value ?? row.total ?? row.amount ?? row.visits ?? 1;
      addCount(map, key, count);
    }
    return;
  }

  if (typeof payload === "object") {
    for (const [key, count] of Object.entries(payload)) {
      if (count && typeof count === "object" && !Array.isArray(count)) {
        const nested =
          count.count ?? count.value ?? count.total ?? count.amount ?? count.visits ?? null;
        if (nested != null) {
          addCount(map, key, nested);
          continue;
        }
      }
      addCount(map, key, count);
    }
  }
}

function mergeCountryCounts(stats = [], link = null) {
  const out = {};

  for (const row of Array.isArray(stats) ? stats : []) {
    ingestCountryPayload(out, row?.countries);
    ingestCountryPayload(out, row?.countryCounts);
    ingestCountryPayload(out, row?.countryStats);
    ingestCountryPayload(out, row?.geo);
    if (row?.country != null) addCount(out, row.country, row.count ?? 1);
  }

  if (link && typeof link === "object") {
    ingestCountryPayload(out, link.countries);
    ingestCountryPayload(out, link.countryCounts);
    ingestCountryPayload(out, link.countryStats);
    ingestCountryPayload(out, link.geo);
  }

  return out;
}

function countryDisplayName(code, { lang = "ru" } = {}) {
  const key = normalizeCountryKey(code);
  if (!key) return "—";
  if (key === "CIS") return lang === "en" ? "CIS" : "СНГ";
  if (lang === "ru" && COUNTRY_LABELS[key]) return COUNTRY_LABELS[key];
  if (/^[A-Z]{2}$/.test(key)) {
    try {
      const locale = lang === "en" ? "en" : "ru";
      return new Intl.DisplayNames([locale], { type: "region" }).of(key) || key;
    } catch {
      return key;
    }
  }
  return key;
}

function countryFlagCode(code) {
  const key = normalizeCountryKey(code);
  if (key === "CIS") return "";
  if (/^[A-Z]{2}$/.test(key)) return key;
  return "";
}

function resolveSteamCountryCode(steam = {}) {
  const candidates = [
    steam.loccountrycode,
    steam.locCountryCode,
    steam.countryCode,
    steam.country_code,
    steam.country,
  ];
  for (const value of candidates) {
    const code = countryFlagCode(value);
    if (code) return code;
  }
  return "";
}

function isCisCountry(code) {
  return CIS_CODES.has(normalizeCountryKey(code));
}

module.exports = {
  CIS_CODES,
  normalizeCountryKey,
  mergeCountryCounts,
  countryDisplayName,
  countryFlagCode,
  resolveSteamCountryCode,
  isCisCountry,
};
