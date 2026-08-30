const mongoose = require("mongoose");

const buttonSchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    url: { type: String, required: true },
    style: { type: String, enum: ["", "primary", "success", "danger"], default: "" },
  },
  { _id: false }
);

const savedPostSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    name: { type: String, default: "", maxlength: 50 },
    contentType: {
      type: String,
      enum: ["text", "photo", "video", "animation", "audio", "document"],
      required: true,
    },
    text: { type: String, default: "" },
    entities: { type: Array, default: [] },
    fileId: { type: String, default: "" },
    buttons: { type: [[buttonSchema]], default: [] },
    linkPreview: { type: Boolean, default: true },
    createdByTelegramId: { type: String, required: true, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

module.exports = mongoose.model("SavedPost", savedPostSchema);
