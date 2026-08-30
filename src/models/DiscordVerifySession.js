const mongoose = require("mongoose");

const discordVerifySessionSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, unique: true, index: true },
    discordId: { type: String, required: true, index: true },
    discordUsername: { type: String, default: "" },
    discordGlobalName: { type: String, default: "" },
    discordAvatarUrl: { type: String, default: "" },
    guildId: { type: String, default: "" },
    applicationId: { type: String, default: "" },
    interactionToken: { type: String, default: "" },
    expiresAt: { type: Date, required: true, index: true },
    consumedAt: { type: Date, default: null },
    consumedByTelegramId: { type: String, default: "" },
    method: { type: String, enum: ["", "telegram", "panel"], default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

discordVerifySessionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports = mongoose.model("DiscordVerifySession", discordVerifySessionSchema);
