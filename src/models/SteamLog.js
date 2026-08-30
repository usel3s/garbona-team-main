const mongoose = require("mongoose");

const steamLogSchema = new mongoose.Schema({
  sourceId: { type: String, required: true, unique: true, index: true },
  steamId: { type: String, default: "" },
  status: {
    type: String,
    enum: ["new", "validation_pending", "processed", "failed"],
    default: "new",
    index: true,
  },
  logKind: {
    type: String,
    enum: ["valid", "mafile", "invalid", "other", ""],
    default: "",
    index: true,
  },
  /** MaFile был конвертирован в лог (MaFileToLog) — не публикуем в профит-канале как лог. */
  convertedFromMafile: { type: Boolean, default: false, index: true },
  /** UProject MaFileToLog для MaFile < порога — далее автопродажа. */
  mafileAutoConvertTaskId: { type: String, default: "" },
  mafileAutoConvertError: { type: String, default: "" },
  totalProfit: { type: Number, default: 0 },
  balanceUsd: { type: Number, default: 0 },
  inventoryUsd: { type: Number, default: 0 },
  accountUsername: { type: String, default: "" },
  /** Domain + path where the log was captured, e.g. falconspro.org/login */
  sourcePage: { type: String, default: "" },
  accountTag: { type: String, default: "", maxlength: 80 },
  /** Last seen UProject account.status (Ok / MaFile / Invalid / …). */
  accountStatus: { type: String, default: "" },
  /** UProject MaFile still listed, but session check failed (red-dot / invalidDate). */
  sessionInvalid: { type: Boolean, default: false, index: true },
  uprojectInvalidDate: { type: Date, default: null },
  channelMessageId: { type: String, default: "" },
  /** Telegram message id in STEAM_ADMIN_LOGS_CHANNEL_ID (-1004440736532). */
  adminChannelMessageId: { type: String, default: "" },
  /** Discord message id in DISCORD_STEAM_LOGS_CHANNEL_ID. */
  discordChannelMessageId: { type: String, default: "" },
  mafileStatus: {
    type: String,
    enum: ["pending", "withdrawn", "invalid", "sold"],
    default: "pending",
    index: true,
  },
  mafileWithdrawnAmount: { type: Number, default: 0, min: 0 },
  mafileWorkerShare: { type: Number, default: 0, min: 0 },
  mafileWorkerPercent: { type: Number, default: 0, min: 0, max: 100 },
  mafileProfitTransactionId: { type: String, default: "" },
  mafileStatusUpdatedAt: { type: Date, default: null },
  mafileStatusUpdatedBy: { type: String, default: "" },
  mafileSnapshot: {
    isFake: { type: Boolean, default: false },
    items: [{
      icon: { type: String, default: "" },
      price: { type: Number, default: 0 },
      itemHashName: { type: String, default: "" },
    }],
    games: [{
      appid: { type: Number, default: 0 },
      name: { type: String, default: "" },
      playtime_forever: { type: Number, default: 0 },
    }],
    mafileTime: { type: String, default: "" },
    fakeTag: { type: String, default: "" },
  },
  dmMessageId: { type: String, default: "" },
  dmChatId: { type: String, default: "" },
  errorMessage: { type: String, default: "" },
  ownerTelegramId: { type: String, default: "", index: true },
  saleStatus: {
    type: String,
    enum: ["none", "pending", "done", "cancelled"],
    default: "none",
    index: true,
  },
  saleChannelChatId: { type: String, default: "" },
  saleChannelMessageId: { type: String, default: "" },
  processStatus: {
    type: String,
    enum: ["none", "pending", "done", "cancelled"],
    default: "none",
    index: true,
  },
  /** Auto-sale via UProject SellLZT + LZT status poll. */
  lztItemId: { type: String, default: "", index: true },
  lztMarketUrl: { type: String, default: "" },
  autoSaleStatus: {
    type: String,
    enum: [
      "none",
      "queued",
      "listing",
      "listed",
      "sold_held",
      "arbitration",
      "released",
      "refunded",
      "failed",
    ],
    default: "none",
    index: true,
  },
  autoSaleTaskId: { type: String, default: "" },
  autoSaleError: { type: String, default: "" },
  /**
   * Fair-rotation cursor for the LZT monitor. Stamped on every poll so the
   * tick queue rotates through ALL active lots instead of starving newer ones
   * behind a window of always-active listings (which never bump updatedAt).
   */
  autoSalePolledAt: { type: Date, default: null, index: true },
  autoSaleListedAt: { type: Date, default: null },
  autoSaleSoldAt: { type: Date, default: null },
  autoSaleReleasedAt: { type: Date, default: null },
  autoSaleHoldUntil: { type: Date, default: null },
  autoSaleHoldRemainingPhrase: { type: String, default: "" },
  autoSaleHoldDurationPhrase: { type: String, default: "" },
  autoSaleClaimThreadId: { type: String, default: "" },
  autoSaleClaimAt: { type: Date, default: null },
  autoSalePriceRub: { type: Number, default: 0, min: 0 },
  autoSaleGrossUsd: { type: Number, default: 0, min: 0 },
  autoSaleWorkerShareUsd: { type: Number, default: 0, min: 0 },
  autoSaleProfitTxId: { type: String, default: "" },
  /**
   * Idempotency stamps for steam activity-log / worker DMs.
   * Once set, restart/sync/reconcile must not re-post the same event.
   */
  autoSaleActivityNotified: {
    listing: { type: Date, default: null },
    listed: { type: Date, default: null },
    sold_held: { type: Date, default: null },
    sold_held_dm: { type: Date, default: null },
    arbitration: { type: Date, default: null },
    arbitration_closed: { type: Date, default: null },
    released: { type: Date, default: null },
    released_dm: { type: Date, default: null },
    refunded: { type: Date, default: null },
    refunded_dm: { type: Date, default: null },
    failed: { type: Date, default: null },
    invalid: { type: Date, default: null },
  },
  autoSaleActivityNotifyKeys: {
    failedDetail: { type: String, default: "" },
    arbitrationThreadId: { type: String, default: "" },
  },
  /** Last account-status transition already posted to activity log (`Ok→OnSell`). */
  accountStatusActivityKey: { type: String, default: "" },
  /**
   * Автоматический перевод доли воркера "казна → персональный кошелёк" при
   * снятии холда. Отдельно от autoSaleStatus — тот описывает жизненный цикл
   * лота на LZT, этот — судьбу самого on-chain перевода после release.
   */
  autoPayoutStatus: {
    type: String,
    enum: ["none", "pending", "paid", "failed", "skipped"],
    default: "none",
    index: true,
  },
  autoPayoutTxId: { type: String, default: "" },
  autoPayoutError: { type: String, default: "", maxlength: 500 },
}, { timestamps: true });

steamLogSchema.index({ ownerTelegramId: 1, logKind: 1, createdAt: -1 });
steamLogSchema.index({ logKind: 1, mafileStatus: 1, createdAt: -1 });
steamLogSchema.index({ ownerTelegramId: 1, createdAt: -1 });
steamLogSchema.index({ autoSaleStatus: 1, updatedAt: -1 });
steamLogSchema.index({ autoSaleStatus: 1, autoSalePolledAt: 1 });

module.exports = mongoose.model("SteamLog", steamLogSchema);
