const { getDisplayCurrency, getUsdRubRate } = require("./settingsService");

async function getCurrencyContext() {
  const [currency, rate] = await Promise.all([
    getDisplayCurrency("USD"),
    getUsdRubRate(90),
  ]);
  return { currency, rate };
}

function convertUsdToDisplay(usdAmount, { currency, rate }) {
  const usd = Number(usdAmount || 0);
  if (currency === "RUB") {
    return Number((usd * rate).toFixed(0));
  }
  return Number(usd.toFixed(2));
}

function formatDisplayAmount(usdAmount, ctxOrOptions) {
  const currency = ctxOrOptions?.currency || "USD";
  const rate = ctxOrOptions?.rate || 90;
  const value = convertUsdToDisplay(usdAmount, { currency, rate });
  if (currency === "RUB") {
    return `${value} RUB`;
  }
  return `$${Number(value).toFixed(2)}`;
}

function formatDisplayAmountShort(usdAmount, ctxOrOptions) {
  const currency = ctxOrOptions?.currency || "USD";
  const rate = ctxOrOptions?.rate || 90;
  const value = convertUsdToDisplay(usdAmount, { currency, rate });
  if (currency === "RUB") {
    return String(value);
  }
  return Number(value).toFixed(2);
}

function currencyLabel(currency) {
  return currency === "RUB" ? "₽ RUB" : "$ USD";
}

module.exports = {
  getCurrencyContext,
  convertUsdToDisplay,
  formatDisplayAmount,
  formatDisplayAmountShort,
  currencyLabel,
};
