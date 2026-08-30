const mongoose = require("mongoose");

/** Совместимость для Cloudflare-доменов, созданных старым командным обходным путём. */
const domainClaimSchema = new mongoose.Schema(
  {
    domainId: { type: Number, required: true, unique: true, index: true },
    domainName: { type: String, default: "", trim: true, lowercase: true },
    ownerTelegramId: { type: String, required: true, index: true },
    bindType: { type: String, default: "cloudflare" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("DomainClaim", domainClaimSchema);
