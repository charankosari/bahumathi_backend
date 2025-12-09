const mongoose = require("mongoose");
const crypto = require("crypto");

const eventSchema = new mongoose.Schema(
  {
    creatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: false,
      trim: true,
    },
    image: {
      type: String,
      required: false,
    },
    video: {
      type: String,
      required: false,
    },
    eventStartDate: {
      type: Date,
      required: true,
    },
    eventEndDate: {
      type: Date,
      required: true,
    },
    eventLink: {
      type: String,
      unique: true,
      index: true,
      default: function () {
        return `event-${crypto.randomBytes(8).toString("hex")}`;
      },
    },
    status: {
      type: String,
      enum: ["active", "ended", "cancelled"],
      default: "active",
    },
    totalGiftsReceived: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalGiftsAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    withdrawalPercentage: {
      type: Number,
      default: 30,
      min: 0,
      max: 100,
    },
  },
  { timestamps: true }
);

// Index for efficient queries
eventSchema.index({ creatorId: 1, status: 1 });
eventSchema.index({ eventStartDate: 1, eventEndDate: 1 });

module.exports = mongoose.model("Event", eventSchema);
