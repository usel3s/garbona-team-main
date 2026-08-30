"use strict";

const TAG_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

function normalizeFakeProfitTag(input) {
  const cleaned = String(input || "")
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 6);
  return cleaned || "";
}

function randomFakeProfitTag() {
  const length = 4 + Math.floor(Math.random() * 3);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += TAG_CHARS[Math.floor(Math.random() * TAG_CHARS.length)];
  }
  return out;
}

function resolveFakeProfitTag(input) {
  return normalizeFakeProfitTag(input) || randomFakeProfitTag();
}

function formatFakeProfitTagLabel(tag) {
  const normalized = normalizeFakeProfitTag(tag);
  return normalized ? `#${normalized}` : "";
}

module.exports = {
  normalizeFakeProfitTag,
  randomFakeProfitTag,
  resolveFakeProfitTag,
  formatFakeProfitTagLabel,
};
