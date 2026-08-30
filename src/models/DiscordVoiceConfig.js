const mongoose = require("mongoose");

const discordVoiceConfigSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    createChannelId: { type: String, default: "" },
    categoryId: { type: String, default: "" },
    panelChannelId: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("DiscordVoiceConfig", discordVoiceConfigSchema);
