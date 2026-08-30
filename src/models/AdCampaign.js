const mongoose = require("mongoose");

const adCampaignSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true,
      maxlength: 24,
    },
    source: { type: String, default: "", trim: true, maxlength: 120 },
    status: {
      type: String,
      enum: ["active", "paused"],
      default: "active",
      index: true,
    },
    createdByTelegramId: { type: String, default: "" },
    clickCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

module.exports = mongoose.model("AdCampaign", adCampaignSchema);
