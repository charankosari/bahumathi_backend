const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
    },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    receiverNumber: { type: String, required: false }, // For messages to non-registered users
    type: {
      type: String,
      enum: ["text", "image", "voice", "video", "gift", "giftWithMessage"],
      default: "text",
    },
    content: { type: String },
    mediaUrl: { type: String },
    giftId: { type: mongoose.Schema.Types.ObjectId, ref: "Gift" },
    isRead: { type: Boolean, default: false },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Message", messageSchema);
