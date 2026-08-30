const mongoose = require("mongoose");

const mpReactionSchema = new mongoose.Schema(
  {
    targetTelegramId: { type: String, required: true, index: true },
    reactorTelegramId: { type: String, required: true, index: true },
    reaction: {
      type: String,
      enum: ["heart", "plead", "poop", "horns", "call", "money"],
      required: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

mpReactionSchema.index(
  { targetTelegramId: 1, reactorTelegramId: 1 },
  { unique: true }
);

module.exports = mongoose.model("MpReaction", mpReactionSchema);
