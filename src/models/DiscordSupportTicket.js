const mongoose = require("mongoose");

const discordSupportTicketSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    ticketId: { type: Number, required: true },
    type: {
      type: String,
      enum: ["help", "bug", "collab"],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["open", "closed"],
      default: "open",
      index: true,
    },
    subject: { type: String, required: true, maxlength: 1000 },
    userId: { type: String, required: true, index: true },
    username: { type: String, default: "" },
    threadId: { type: String, default: "" },
    staffMessageId: { type: String, default: "" },
    closedAt: { type: Date, default: null },
    closedBy: { type: String, default: "" },
  },
  { timestamps: true }
);

discordSupportTicketSchema.index({ guildId: 1, ticketId: 1 }, { unique: true });

module.exports = mongoose.model("DiscordSupportTicket", discordSupportTicketSchema);
