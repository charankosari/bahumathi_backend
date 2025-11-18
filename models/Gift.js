const mongoose = require("mongoose");

const giftSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false, // Made optional to support sending to non-registered users
    },
    receiverNumber: {
      type: String,
      required: false, // Phone number when receiver doesn't have an account
    },
    isSelfGift: { type: Boolean, default: false },

    type: { type: String, enum: ["gold", "stock"], required: true },
    name: { type: String }, // e.g. TCS, Gold 24K
    icon: { type: String },

    valueInINR: { type: Number, required: true }, // Current value (updated on allocation)
    originalValueInINR: { type: Number, default: null }, // Original value at gift time
    allottedValueInINR: { type: Number, default: null }, // Value at allocation time
    quantity: { type: Number, required: true }, // Current quantity (updated on allocation)
    pricePerUnitAtGift: { type: Number, required: true },
    currentPricePerUnit: { type: Number, default: null }, // Current market price

    status: {
      type: String,
      enum: ["pending", "accepted", "allotted", "expired", "cancelled"],
      default: "pending",
    },

    isAllotted: { type: Boolean, default: false },
    allottedAt: { type: Date, default: null },
    convertedTo: { type: String, enum: ["gold", "stock", null], default: null },
    hiddenFromSender: { type: Boolean, default: false },

    conversionDetails: {
      fromType: { type: String, enum: ["gold", "stock"] },
      toType: { type: String, enum: ["gold", "stock"] },
      conversionRate: { type: Number },
      convertedQuantity: { type: Number },
    },

    transactionRef: { type: String, default: null },
    provider: {
      type: String,
      enum: ["Augmont", "Zerodha", "Groww", "Kuvera", null],
      default: null,
    },

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

    note: { type: String },
    isViewedByReceiver: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Gift", giftSchema);
