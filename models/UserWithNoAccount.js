const mongoose = require("mongoose");

const userWithNoAccountSchema = new mongoose.Schema(
  {
    phoneNumber: {
      type: String,
      required: true,
      index: true, // Index for faster lookups
    },
    gifts: [
      {
        giftId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Gift",
          required: true,
        },
        senderId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    messages: [
      {
        messageId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Message",
          required: false,
        },
        senderId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        content: {
          type: String,
          required: false,
        },
        type: {
          type: String,
          required: false,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  { timestamps: true }
);

// Index on phoneNumber for faster queries
userWithNoAccountSchema.index({ phoneNumber: 1 });

module.exports = mongoose.model("UserWithNoAccount", userWithNoAccountSchema);
