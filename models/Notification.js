const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true, // Index for faster queries
    },
    type: {
      type: String,
      enum: [
        "message",
        "gift",
        "giftWithMessage",
        "selfGift",
        "selfGiftWithMessage",
        "transaction",
        "system",
        "withdrawalRejected",
        "withdrawalApproved",
      ],
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: false,
    },
    // Sender information
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    senderName: {
      type: String,
      required: false,
    },
    senderImage: {
      type: String,
      required: false,
    },
    // Related entities
    messageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      required: false,
    },
    giftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Gift",
      required: false,
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: false,
    },
    transactionId: {
      type: String,
      required: false,
    },
    withdrawalRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WithdrawalRequest",
      required: false,
    },
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: false,
    },
    // Notification status
    isSeen: {
      type: Boolean,
      default: false,
      index: true, // Index for faster unread queries
    },
    isOpened: {
      type: Boolean,
      default: false,
    },
    // Additional metadata
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

// Compound index for efficient queries
notificationSchema.index({ userId: 1, isSeen: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
