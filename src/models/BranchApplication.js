const mongoose = require("mongoose");

const branchApplicationSchema = new mongoose.Schema(
  {
    applicantTelegramId: { type: String, required: true, index: true },
    branchId: { type: String, required: true, index: true },
    ownerTelegramId: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected"],
      default: "pending",
      index: true,
    },
  },
  { timestamps: true }
);

branchApplicationSchema.index({ applicantTelegramId: 1, branchId: 1, status: 1 });

module.exports = mongoose.model("BranchApplication", branchApplicationSchema);
