const mongoose = require("mongoose");

const userHistorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    // Unallotted money from gifts (in INR)
    unallottedMoney: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Holding money (in INR) - money that is in withdrawal request pending state
    holdingMoney: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Allotted money breakdown
    allottedMoney: {
      gold: {
        type: Number,
        default: 0,
        min: 0,
      },
      stock: {
        type: Number,
        default: 0,
        min: 0,
      },
    },

    // Allocation history - tracks all allocations made by user
    allocationHistory: [
      {
        giftId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Gift",
          required: false, // Optional - allows allocations from general unallotted pool
        },
        amount: {
          type: Number,
          required: true,
          min: 0,
        },
        allocationType: {
          type: String,
          enum: ["gold", "stock"],
          required: true,
        },
        quantity: {
          type: Number,
          required: true,
          min: 0,
        },
        pricePerUnit: {
          type: Number,
          required: true,
          min: 0,
        },
        allocatedAt: {
          type: Date,
          default: Date.now,
        },
        conversionDetails: {
          fromType: {
            type: String,
            enum: ["money", "gold", "stock"],
          },
          toType: {
            type: String,
            enum: ["gold", "stock"],
          },
          conversionRate: {
            type: Number,
          },
          convertedQuantity: {
            type: Number,
          },
        },
      },
    ],

    // Gift history - tracks all gifts received
    giftHistory: [
      {
        giftId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Gift",
          required: true,
        },
        amount: {
          type: Number,
          required: true,
          min: 0,
        },
        receivedAt: {
          type: Date,
          default: Date.now,
        },
        senderId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        isFullyAllocated: {
          type: Boolean,
          default: false,
        },
      },
    ],
  },
  { timestamps: true }
);

// Index for efficient queries
userHistorySchema.index({ userId: 1 });
userHistorySchema.index({ "giftHistory.giftId": 1 });
userHistorySchema.index({ "allocationHistory.giftId": 1 });

// Method to add unallotted money (when gift is received)
userHistorySchema.methods.addUnallottedMoney = function (
  amount,
  giftId,
  senderId
) {
  this.unallottedMoney += amount;
  this.giftHistory.push({
    giftId: giftId,
    amount: amount,
    receivedAt: new Date(),
    senderId: senderId,
    isFullyAllocated: false,
  });
  return this.save();
};

// Method to allocate money (move from unallotted to allotted)
userHistorySchema.methods.allocateMoney = async function (
  amount,
  allocationType,
  giftId, // Can be null for direct allocation
  quantity,
  pricePerUnit,
  conversionDetails
) {
  if (this.unallottedMoney < amount) {
    throw new Error(
      `Insufficient unallotted money. Available: ₹${this.unallottedMoney}, Requested: ₹${amount}`
    );
  }

  // Deduct from unallotted
  this.unallottedMoney -= amount;

  // Add to allotted
  this.allottedMoney[allocationType] += amount;

  // Add to allocation history
  this.allocationHistory.push({
    giftId: giftId || null,
    amount: amount,
    allocationType: allocationType,
    quantity: quantity,
    pricePerUnit: pricePerUnit,
    allocatedAt: new Date(),
    conversionDetails: conversionDetails,
  });

  // Update gift history to mark as fully allocated if needed
  if (giftId) {
    const giftEntry = this.giftHistory.find(
      (g) => g.giftId && g.giftId.toString() === giftId.toString()
    );
    if (giftEntry) {
      // Check if this gift is now fully allocated
      const totalAllocatedForGift = this.allocationHistory
        .filter((a) => a.giftId && a.giftId.toString() === giftId.toString())
        .reduce((sum, a) => sum + a.amount, 0);

      if (totalAllocatedForGift >= giftEntry.amount) {
        giftEntry.isFullyAllocated = true;
      }
    }
  }

  return this.save();
};

// Static method to get or create user history
userHistorySchema.statics.getOrCreate = async function (userId) {
  let userHistory = await this.findOne({ userId });
  if (!userHistory) {
    userHistory = await this.create({
      userId: userId,
      unallottedMoney: 0,
      holdingMoney: 0,
      allottedMoney: { gold: 0, stock: 0 },
      allocationHistory: [],
      giftHistory: [],
    });
  }
  // Ensure holdingMoney exists for existing records
  if (userHistory.holdingMoney === undefined) {
    userHistory.holdingMoney = 0;
    await userHistory.save();
  }
  return userHistory;
};

module.exports = mongoose.model("UserHistory", userHistorySchema);
