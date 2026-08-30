const mongoose = require("mongoose");

const WITHDRAWAL_METHODS = [
  "usdt_trc20",
  "usdt_bep20",
  "ton_gram",
  "solana",
  // legacy
  "xRocketr",
  "cryptobot",
  "lolz",
  "usdt_ton",
];

const payoutEventSchema = new mongoose.Schema(
  {
    status: { type: String, default: "" },
    at: { type: Date, default: Date.now },
    actorTelegramId: { type: String, default: "" },
    actorUsername: { type: String, default: "" },
    note: { type: String, default: "" },
  },
  { _id: false }
);

const payoutCommentSchema = new mongoose.Schema(
  {
    text: { type: String, default: "" },
    at: { type: Date, default: Date.now },
    actorTelegramId: { type: String, default: "" },
    actorUsername: { type: String, default: "" },
  },
  { _id: false }
);

const withdrawalRequestSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    telegramId: { type: String, required: true, index: true },
    username: { type: String, default: "" },
    amountUsd: { type: Number, required: true, min: 0 },
    method: {
      type: String,
      enum: WITHDRAWAL_METHODS,
      required: true,
    },
    walletAddress: { type: String, default: "" },
    status: {
      type: String,
      enum: ["pending", "awaiting_payout_link", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    payoutUrl: { type: String, default: "" },
    channelMessageId: { type: String, default: "" },
    channelChatId: { type: String, default: "" },
    awaitingAdminTelegramId: { type: String, default: "" },
    resolvedByTelegramId: { type: String, default: "" },
    comments: { type: [payoutCommentSchema], default: [] },
    statusHistory: { type: [payoutEventSchema], default: [] },
    /** Real on-chain transaction id, set when the payout was signed automatically
     *  from the worker's own treasury sub-wallet instead of an admin-pasted link. */
    txId: { type: String, default: "" },
    autoSigned: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("WithdrawalRequest", withdrawalRequestSchema);
module.exports.WITHDRAWAL_METHODS = WITHDRAWAL_METHODS;
