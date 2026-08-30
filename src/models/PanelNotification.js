const mongoose = require("mongoose");

const panelNotificationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, maxlength: 120 },
    messageHtml: { type: String, default: "", maxlength: 4000 },
    severity: { type: String, enum: ["info", "warn", "danger"], default: "info" },
    linkType: { type: String, enum: ["none", "view", "url", "domain"], default: "none" },
    linkView: { type: String, default: "" },
    linkUrl: { type: String, default: "" },
    linkDomainId: { type: Number, default: null },
    adminTelegramId: { type: String, default: "" },
    active: { type: Boolean, default: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

panelNotificationSchema.index({ active: 1, createdAt: -1 });

module.exports = mongoose.model("PanelNotification", panelNotificationSchema);
