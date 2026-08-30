const mongoose = require("mongoose");

const branchSchema = new mongoose.Schema(
  {
    ownerTelegramId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 32 },
    description: { type: String, default: "", maxlength: 500 },
    percent: { type: Number, default: 0, min: 0, max: 10 },
    avatarUrl: { type: String, default: "", maxlength: 500 },
    acceptingApplications: { type: Boolean, default: true },
    status: {
      type: String,
      enum: ["active", "closed"],
      default: "active",
      index: true,
    },
    createdVia: {
      type: String,
      enum: ["paid", "admin", "profits"],
      required: true,
    },
    paidUsd: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Branch", branchSchema);
