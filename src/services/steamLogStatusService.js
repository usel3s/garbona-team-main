const AUTO_SALE_ACTIVITY_STATUS = {
  queued: "Выставляется",
  listing: "Выставляется",
  listed: "Продается",
  sold_held: "Аккаунт продан",
  arbitration: "Арбитраж",
  released: "Аккаунт продан",
  refunded: "Продажа отменена · лот удалён",
  // Non-empty so it does not fall back to a stale UProject `OnSell`
  // (which rendered dead lots as «Продаётся»).
  failed: "Невалид",
};

const AUTO_SALE_ACTIVITY_SALE_STATUS = {
  queued: "on_sale",
  listing: "on_sale",
  listed: "on_sale",
  sold_held: "sold",
  arbitration: "sold",
  released: "sold",
  refunded: "cancelled",
  failed: "cancelled",
};

const SALE_STATUS_PRIORITY = {
  none: 0,
  "": 0,
  pending: 1,
  on_sale: 2,
  done: 3,
  sold: 3,
  cancelled: 4,
  canceled: 4,
  refunded: 4,
};

function autoSaleActivityStatus(autoSaleStatus) {
  return AUTO_SALE_ACTIVITY_STATUS[String(autoSaleStatus || "")] || "";
}

function activitySaleStatusFromAutoSale(autoSaleStatus) {
  return AUTO_SALE_ACTIVITY_SALE_STATUS[String(autoSaleStatus || "")] || "";
}

function effectiveActivitySaleStatus(log) {
  const auto = activitySaleStatusFromAutoSale(log?.autoSaleStatus);
  return auto || String(log?.saleStatus || "none");
}

function saleStatusPriority(status) {
  return SALE_STATUS_PRIORITY[String(status || "").toLowerCase()] ?? 0;
}

function preferActivityDisplayStatus(primary, fallback) {
  const primarySale = String(primary?.saleStatus || "");
  const fallbackSale = String(fallback?.saleStatus || "");
  if (saleStatusPriority(fallbackSale) > saleStatusPriority(primarySale)) {
    return String(fallback?.status || primary?.status || "");
  }
  return String(primary?.status || fallback?.status || "");
}

module.exports = {
  autoSaleActivityStatus,
  activitySaleStatusFromAutoSale,
  effectiveActivitySaleStatus,
  preferActivityDisplayStatus,
  saleStatusPriority,
};
