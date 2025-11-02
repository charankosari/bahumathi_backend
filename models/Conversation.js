const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema(
  {
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    // CHANGE THIS SECTION
    lastMessage: {
      text: String,
      sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    // END CHANGE

    lastMessageType: {
      type: String,
      enum: ["text", "image", "video", "voice", "gift", "giftWithMessage"],
    },
    unreadCounts: {
      type: Map,
      of: Number,
      default: {},
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Conversation", conversationSchema);
