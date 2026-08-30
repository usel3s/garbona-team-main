const mongoose = require("mongoose");

/** Виды записей в истории начислений. Статистика профитов считает только profit. */
const CREDIT_KINDS = {
  PROFIT: "profit",
  WALLET_CREDIT: "wallet_credit",
  TRANSFER_IN: "transfer_in",
  BRANCH_COMMISSION: "branch_commission",
  BRANCH_FEE: "branch_fee",
};

const NON_STAT_CREDIT_KINDS = [
  CREDIT_KINDS.WALLET_CREDIT,
  CREDIT_KINDS.TRANSFER_IN,
  CREDIT_KINDS.BRANCH_COMMISSION,
  CREDIT_KINDS.BRANCH_FEE,
];

const profitTransactionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    /** Актор: админ для профита/пополнения, отправитель для transfer_in. */
    adminTelegramId: { type: String, required: true, default: "" },
    amount: { type: Number, required: true, min: 0 },
    workerPercent: { type: Number, required: true, min: 1, max: 100 },
    workerShare: { type: Number, required: true, min: 0 },
    kind: {
      type: String,
      enum: Object.values(CREDIT_KINDS),
      default: CREDIT_KINDS.PROFIT,
      index: true,
    },
    note: { type: String, default: "" },
    counterpartyTelegramId: { type: String, default: "" },
    counterpartyUsername: { type: String, default: "" },
    branchId: { type: String, default: "", index: true },
    relatedTransactionId: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

profitTransactionSchema.index({ userId: 1, createdAt: -1 });
profitTransactionSchema.index({ userId: 1, kind: 1, createdAt: -1 });

module.exports = mongoose.model("ProfitTransaction", profitTransactionSchema);
module.exports.CREDIT_KINDS = CREDIT_KINDS;
module.exports.NON_STAT_CREDIT_KINDS = NON_STAT_CREDIT_KINDS;
