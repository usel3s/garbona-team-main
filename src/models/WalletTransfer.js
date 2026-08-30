const mongoose = require("mongoose");

const walletTransferSchema = new mongoose.Schema(
  {
    fromUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    fromTelegramId: { type: String, required: true, index: true },
    fromUsername: { type: String, default: "" },
    toUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    toTelegramId: { type: String, required: true, index: true },
    toUsername: { type: String, default: "" },
    amountUsd: { type: Number, required: true, min: 0.01 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

walletTransferSchema.index({ fromTelegramId: 1, createdAt: -1 });
walletTransferSchema.index({ toTelegramId: 1, createdAt: -1 });

module.exports = mongoose.model("WalletTransfer", walletTransferSchema);
