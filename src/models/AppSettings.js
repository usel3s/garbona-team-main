const mongoose = require("mongoose");

const appSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    valueNumber: { type: Number, default: null },
    valueString: { type: String, default: null },
    /** Used by keys like usdTonRate: true = admin-set override, skip live refetch. */
    manualOverride: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AppSettings", appSettingsSchema);
