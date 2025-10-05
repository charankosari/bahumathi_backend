const mongoose = require("mongoose");

const giftSchema = new mongoose.Schema(
  {
    // Who sent the gift
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Who received the gift
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Original gift type
    type: { type: String, enum: ["gold", "stock"], required: true },

    // Gift details
    name: { type: String }, // stock name or gold
    amount: { type: Number, required: true },
    icon: { type: String },

    // Whether it’s self-sent (optional case)
    isSelfGift: { type: Boolean, default: false },

    // Allocation status
    isAllotted: { type: Boolean, default: false }, // true when receiver converts
    allottedAt: { type: Date, default: null },

    // Receiver’s chosen conversion type (after allotment)
    convertedTo: { type: String, enum: ["gold", "stock", null], default: null },

    // Hidden from sender after allocation
    hiddenFromSender: { type: Boolean, default: false },

    // References to conversation/message if applicable
    messageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Gift", giftSchema);
