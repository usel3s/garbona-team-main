const mongoose = require("mongoose");

const adminImpersonationSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, unique: true, index: true },
    adminTelegramId: { type: String, required: true, index: true },
    adminUsername: { type: String, default: "" },
    targetTelegramId: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true, index: true },
    consumedAt: { type: Date, default: null },
    consumedIp: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

// Keep audit trail ~90 days, then drop.
adminImpersonationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model("AdminImpersonation", adminImpersonationSchema);
