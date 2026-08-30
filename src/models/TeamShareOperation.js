const mongoose = require("mongoose");

const teamShareOperationSchema = new mongoose.Schema(
  {
    amountUsd: { type: Number, required: true, min: 0.01 },
    reason: { type: String, required: true, maxlength: 400 },
    actorTelegramId: { type: String, default: "" },
    actorUsername: { type: String, default: "" },
    source: { type: String, enum: ["manual", "uproject"], default: "manual", index: true },
    kind: { type: String, default: "" },
    accountId: { type: String, default: "", index: true },
    externalId: { type: String, default: null },
    status: { type: String, enum: ["active", "canceled"], default: "active", index: true },
    canceledAt: { type: Date, default: null },
    canceledByTelegramId: { type: String, default: "" },
    canceledByUsername: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

teamShareOperationSchema.index({ createdAt: -1 });
teamShareOperationSchema.index(
  { externalId: 1 },
  { unique: true, sparse: true, partialFilterExpression: { externalId: { $type: "string", $gt: "" } } }
);

module.exports = mongoose.model("TeamShareOperation", teamShareOperationSchema);
