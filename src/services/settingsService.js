const AppSettings = require("../models/AppSettings");
const User = require("../models/User");

const GLOBAL_PERCENT_KEY = "globalWorkerPercent";
const DEFAULT_WORKER_PERCENT = 70;
const DISPLAY_CURRENCY_KEY = "displayCurrency";
const USD_RUB_RATE_KEY = "usdRubRate";
const USD_TON_RATE_KEY = "usdTonRate";
const WITHDRAWAL_FEES_KEY = "withdrawalFees";
const VISIBLE_TEMPLATES_KEY = "visibleTemplates";

function normalizeTemplateId(value) {
  const id = Math.trunc(Number(value));
  return Number.isFinite(id) && id > 0 ? id : null;
}

function parseTemplatePublicFlag(value) {
  return value === true || value === "true";
}

function hydrateTemplateAccess(row = {}) {
  const ownerTelegramId = String(row.ownerTelegramId || "").trim();
  const isPublic = row.isPublic == null ? !ownerTelegramId : parseTemplatePublicFlag(row.isPublic);
  return {
    ...row,
    ownerTelegramId,
    isPublic,
  };
}

function normalizeVisibleTemplate(row) {
  const id = normalizeTemplateId(row?.id ?? row);
  if (!id) return null;
  const ownerTelegramId = String(row?.ownerTelegramId || "").trim();
  const isPublic = row?.isPublic == null ? !ownerTelegramId : parseTemplatePublicFlag(row.isPublic);
  return {
    id,
    name: String(row?.name || `Template #${id}`).trim() || `Template #${id}`,
    preview: String(row?.preview || "").trim(),
    ownerTelegramId,
    isPublic,
  };
}

function canAccessTemplate(row, telegramId) {
  const tpl = hydrateTemplateAccess(row);
  if (!tpl.ownerTelegramId || tpl.isPublic) return true;
  return String(tpl.ownerTelegramId) === String(telegramId || "");
}

async function getVisibleTemplates() {
  const row = await AppSettings.findOne({ key: VISIBLE_TEMPLATES_KEY });
  if (!row?.valueString) return [];
  try {
    const parsed = JSON.parse(row.valueString);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set();
    const result = [];
    for (const item of parsed) {
      const tpl = normalizeVisibleTemplate(item);
      if (!tpl || seen.has(tpl.id)) continue;
      seen.add(tpl.id);
      result.push(tpl);
    }
    return result;
  } catch {
    return [];
  }
}

async function setVisibleTemplates(templates) {
  const normalized = [];
  const seen = new Set();
  for (const item of templates || []) {
    const tpl = normalizeVisibleTemplate(item);
    if (!tpl || seen.has(tpl.id)) continue;
    seen.add(tpl.id);
    normalized.push(tpl);
  }
  await AppSettings.findOneAndUpdate(
    { key: VISIBLE_TEMPLATES_KEY },
    { valueString: JSON.stringify(normalized) },
    { upsert: true, new: true }
  );
  return normalized;
}

async function addVisibleTemplate(template) {
  const tpl = normalizeVisibleTemplate(template);
  if (!tpl) throw new Error("Некорректный ID шаблона");
  const current = await getVisibleTemplates();
  const idx = current.findIndex((row) => row.id === tpl.id);
  if (idx >= 0) current[idx] = { ...current[idx], ...tpl };
  else current.push(tpl);
  return setVisibleTemplates(current);
}

async function removeVisibleTemplate(templateId) {
  const id = normalizeTemplateId(templateId);
  if (!id) throw new Error("Некорректный ID шаблона");
  const current = await getVisibleTemplates();
  return setVisibleTemplates(current.filter((row) => row.id !== id));
}

async function renameVisibleTemplate(templateId, name) {
  const id = normalizeTemplateId(templateId);
  if (!id) throw new Error("Некорректный ID шаблона");
  const customName = String(name || "").trim().slice(0, 80);
  if (!customName) throw new Error("Укажите название шаблона");
  const current = await getVisibleTemplates();
  const idx = current.findIndex((row) => row.id === id);
  if (idx < 0) throw new Error("Шаблон не включён");
  current[idx] = { ...current[idx], name: customName };
  return setVisibleTemplates(current);
}

async function isTemplateVisible(templateId) {
  const id = normalizeTemplateId(templateId);
  if (!id) return false;
  const current = await getVisibleTemplates();
  return current.some((row) => row.id === id);
}

async function getGlobalWorkerPercent(defaultValue = DEFAULT_WORKER_PERCENT) {
  const row = await AppSettings.findOne({ key: GLOBAL_PERCENT_KEY });
  if (!row || typeof row.valueNumber !== "number") return defaultValue;
  return row.valueNumber;
}

async function setGlobalWorkerPercent(percent) {
  const normalized = Math.max(1, Math.min(100, Number(percent)));
  await AppSettings.findOneAndUpdate(
    { key: GLOBAL_PERCENT_KEY },
    { valueNumber: normalized },
    { upsert: true, new: true }
  );
  await User.updateMany({}, { profitPercent: normalized });
  return normalized;
}

async function getDisplayCurrency(defaultValue = "USD") {
  const row = await AppSettings.findOne({ key: DISPLAY_CURRENCY_KEY });
  const v = String(row?.valueString || defaultValue).toUpperCase();
  return v === "RUB" ? "RUB" : "USD";
}

async function setDisplayCurrency(currency) {
  const next = String(currency || "").toUpperCase() === "RUB" ? "RUB" : "USD";
  await AppSettings.findOneAndUpdate(
    { key: DISPLAY_CURRENCY_KEY },
    { valueString: next },
    { upsert: true, new: true }
  );
  return next;
}

async function toggleDisplayCurrency() {
  const current = await getDisplayCurrency("USD");
  return setDisplayCurrency(current === "RUB" ? "USD" : "RUB");
}

async function getUsdRubRate(defaultValue = 90) {
  const row = await AppSettings.findOne({ key: USD_RUB_RATE_KEY });
  if (!row || typeof row.valueNumber !== "number" || row.valueNumber <= 0) {
    return defaultValue;
  }
  return row.valueNumber;
}

async function setUsdRubRate(rate) {
  const normalized = Math.max(0.01, Number(rate));
  if (!Number.isFinite(normalized)) {
    throw new Error("Некорректный курс");
  }
  await AppSettings.findOneAndUpdate(
    { key: USD_RUB_RATE_KEY },
    { valueNumber: normalized },
    { upsert: true, new: true }
  );
  return normalized;
}

/**
 * Курс USD→TON: сперва ручной override в AppSettings (если задан админом и
 * не протух), иначе живой фетч (CoinGecko по умолчанию, см. env.usdTonPriceApiUrl),
 * иначе последнее известное закэшированное значение как fallback.
 */
async function getUsdTonRate() {
  const { env } = require("../config/env");
  const row = await AppSettings.findOne({ key: USD_TON_RATE_KEY });
  const manual = row?.valueNumber > 0 && row?.manualOverride ? row.valueNumber : 0;
  if (manual > 0) return manual;

  const cachedFresh =
    row?.valueNumber > 0 &&
    row?.updatedAt &&
    Date.now() - new Date(row.updatedAt).getTime() < env.usdTonPriceCacheMs;
  if (cachedFresh) return row.valueNumber;

  try {
    const axios = require("axios");
    const { data } = await axios.get(env.usdTonPriceApiUrl, { timeout: 10_000 });
    const rate = Number(data?.["the-open-network"]?.usd);
    if (Number.isFinite(rate) && rate > 0) {
      await AppSettings.findOneAndUpdate(
        { key: USD_TON_RATE_KEY },
        { valueNumber: rate, manualOverride: false },
        { upsert: true }
      );
      return rate;
    }
  } catch (_) {
    /* falls through to last-known-good below */
  }

  if (row?.valueNumber > 0) return row.valueNumber;
  throw new Error("Курс USD/TON недоступен (нет ни живого фетча, ни закэшированного значения).");
}

async function setUsdTonRate(rate) {
  const normalized = Math.max(0.000001, Number(rate));
  if (!Number.isFinite(normalized)) {
    throw new Error("Некорректный курс");
  }
  await AppSettings.findOneAndUpdate(
    { key: USD_TON_RATE_KEY },
    { valueNumber: normalized, manualOverride: true },
    { upsert: true, new: true }
  );
  return normalized;
}

function defaultWithdrawalFees() {
  const { env } = require("../config/env");
  return {
    usdt_trc20: Number(env.withdrawFeeUsdtTrc20) || 0,
    usdt_bep20: Number(env.withdrawFeeUsdtBep20) || 0,
    ton_gram: Number(env.withdrawFeeTonGram) || 0,
    solana: Number(env.withdrawFeeSolana) || 0,
    usdt_ton: Number(env.withdrawFeeTonGram) || 0,
    xRocketr: 0,
    cryptobot: 0,
    lolz: 0,
  };
}

async function getWithdrawalFees() {
  const row = await AppSettings.findOne({ key: WITHDRAWAL_FEES_KEY });
  const defaults = defaultWithdrawalFees();
  if (!row?.valueString) return defaults;
  try {
    const parsed = JSON.parse(row.valueString);
    const next = { ...defaults };
    for (const [key, value] of Object.entries(parsed || {})) {
      const fee = Number(value);
      if (Number.isFinite(fee) && fee >= 0) next[key] = Number(fee.toFixed(2));
    }
    return next;
  } catch {
    return defaults;
  }
}

async function setWithdrawalFees(partial = {}) {
  const current = await getWithdrawalFees();
  const allowed = new Set(Object.keys(defaultWithdrawalFees()));
  const next = { ...current };
  for (const [key, value] of Object.entries(partial || {})) {
    if (!allowed.has(key)) continue;
    const fee = Number(value);
    if (!Number.isFinite(fee) || fee < 0) {
      throw new Error(`Некорректная комиссия для ${key}`);
    }
    next[key] = Number(fee.toFixed(2));
  }
  await AppSettings.findOneAndUpdate(
    { key: WITHDRAWAL_FEES_KEY },
    { valueString: JSON.stringify(next) },
    { upsert: true, new: true }
  );
  return next;
}

module.exports = {
  DEFAULT_WORKER_PERCENT,
  GLOBAL_PERCENT_KEY,
  getGlobalWorkerPercent,
  setGlobalWorkerPercent,
  getDisplayCurrency,
  setDisplayCurrency,
  toggleDisplayCurrency,
  getUsdRubRate,
  setUsdRubRate,
  getUsdTonRate,
  setUsdTonRate,
  getWithdrawalFees,
  setWithdrawalFees,
  getVisibleTemplates,
  setVisibleTemplates,
  addVisibleTemplate,
  removeVisibleTemplate,
  renameVisibleTemplate,
  isTemplateVisible,
  normalizeTemplateId,
  parseTemplatePublicFlag,
  canAccessTemplate,
};
