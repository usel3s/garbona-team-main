const mongoose = require("mongoose");

const panelAdminSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    passwordHash: { type: String, required: true, default: "" },
    displayName: { type: String, default: "" },
    createdByUsername: { type: String, default: "" },
    active: { type: Boolean, default: true },
    /** Bumped on password change to invalidate old cookies. */
    sessionVersion: { type: Number, default: 1 },
    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

module.exports = mongoose.model("PanelAdmin", panelAdminSchema);
