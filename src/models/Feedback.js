const mongoose = require("mongoose");

const FEEDBACK_TYPES = ["bug", "question", "idea"];
const FEEDBACK_STATUSES = ["open", "closed"];

const feedbackSchema = new mongoose.Schema(
  {
    telegramId: { type: String, required: true, index: true },
    username: { type: String, default: "" },
    firstName: { type: String, default: "" },
    type: { type: String, enum: FEEDBACK_TYPES, required: true, index: true },
    text: { type: String, required: true, maxlength: 2000 },
    status: { type: String, enum: FEEDBACK_STATUSES, default: "open", index: true },
    adminReply: { type: String, default: "" },
    channelChatId: { type: String, default: "" },
    channelMessageId: { type: String, default: "" },
    closedByTelegramId: { type: String, default: "" },
    repliedByTelegramId: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

feedbackSchema.index({ telegramId: 1, createdAt: -1 });

module.exports = mongoose.model("Feedback", feedbackSchema);
module.exports.FEEDBACK_TYPES = FEEDBACK_TYPES;
module.exports.FEEDBACK_STATUSES = FEEDBACK_STATUSES;
