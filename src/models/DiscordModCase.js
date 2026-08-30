const mongoose = require("mongoose");

const discordModCaseSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    caseId: { type: Number, required: true },
    userId: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: ["warn", "unwarn", "mute", "unmute", "ban", "unban", "appeal"],
      required: true,
      index: true,
    },
    reason: { type: String, default: "", maxlength: 1000 },
    moderatorId: { type: String, default: "", index: true },
    moderatorTag: { type: String, default: "" },
    durationMs: { type: Number, default: 0 },
    expiresAt: { type: Date, default: null },
    active: { type: Boolean, default: true, index: true },
    meta: { type: Object, default: {} },
  },
  { timestamps: true }
);

discordModCaseSchema.index({ guildId: 1, caseId: 1 }, { unique: true });
discordModCaseSchema.index({ guildId: 1, userId: 1, type: 1, active: 1 });

module.exports = mongoose.model("DiscordModCase", discordModCaseSchema);
