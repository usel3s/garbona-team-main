const mongoose = require("mongoose");

const curatorApplicationSchema = new mongoose.Schema(
  {
    applicantTelegramId: { type: String, required: true, index: true },
    curatorTelegramId: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected"],
      default: "pending",
      index: true,
    },
  },
  { timestamps: true }
);

curatorApplicationSchema.index(
  { applicantTelegramId: 1, curatorTelegramId: 1, status: 1 }
);

module.exports = mongoose.model("CuratorApplication", curatorApplicationSchema);
