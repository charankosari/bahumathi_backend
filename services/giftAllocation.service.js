const mongoose = require("mongoose");
const Gift = require("../models/Gift");
const UserHistory = require("../models/UserHistory");
const AutoAllocationTask = require("../models/AutoAllocationTask");

// Constants for current prices (these should ideally come from a price service)
const GOLD_PRICE_PER_GRAM = 11203.0; // ₹11,203 per gram
const TOP50_STOCK_NAV = 159.62; // ₹159.62 per unit

/**
 * Add gift money to user's unallotted money
 * Called when a gift is received
 *
 * @param {Object} params
 * @param {string} params.giftId - Gift ID
 * @param {string} params.userId - User ID (receiver)
 * @param {number} params.amount - Amount in INR
 * @param {string} params.senderId - Sender ID
 * @param {Object} params.session - MongoDB session (optional, for transactions)
 * @returns {Object} Updated UserHistory
 */
async function addGiftToUserHistory({
  giftId,
  userId,
  amount,
  senderId,
  session = null,
}) {
  const userHistory = await UserHistory.getOrCreate(userId);

  // Add unallotted money and record in gift history
  if (session) {
    // Use session for transaction
    await userHistory.addUnallottedMoney(amount, giftId, senderId);
    // Note: addUnallottedMoney saves, but we need to ensure it uses the session
    // For now, we'll manually update and save with session
    userHistory.unallottedMoney += amount;
    userHistory.giftHistory.push({
      giftId: giftId,
      amount: amount,
      receivedAt: new Date(),
      senderId: senderId,
      isFullyAllocated: false,
    });
    await userHistory.save({ session });
  } else {
    await userHistory.addUnallottedMoney(amount, giftId, senderId);
  }

  return userHistory;
}

/**
 * Allocate money from user's unallotted money to gold or stock
 * This is the core logic that can be used by both REST API and Socket handlers
 * Supports partial allocation - if amount is provided, only that amount is allocated
 *
 * @param {Object} params
 * @param {string} params.giftId - Gift ID (for tracking)
 * @param {string} params.userId - User ID (receiver)
 * @param {string} params.allocationType - "gold" or "stock"
 * @param {number} params.amount - Amount in INR to allocate (required)
 * @param {Object} params.session - MongoDB session (optional, for transactions)
 * @returns {Object} Updated UserHistory and allocation details
 */
async function allocateGift({
  giftId,
  userId,
  allocationType,
  amount, // Required: Amount in INR to allocate
  session = null,
}) {
  // Validate allocation type
  if (!allocationType || !["gold", "stock"].includes(allocationType)) {
    throw new Error("allocationType must be either 'gold' or 'stock'");
  }

  // Validate amount
  if (!amount || amount <= 0) {
    throw new Error("amount must be a positive number");
  }

  // Get or create user history
  const userHistory = await UserHistory.getOrCreate(userId);

  // Check if user has enough unallotted money
  if (userHistory.unallottedMoney < amount) {
    throw new Error(
      `Insufficient unallotted money. Available: ₹${userHistory.unallottedMoney}, Requested: ₹${amount}`
    );
  }

  // Verify gift exists and belongs to user (optional check - giftId can be null for direct allocation)
  // Convert giftId to string if it's an ObjectId
  const giftIdStr = giftId ? String(giftId).trim() : "";
  if (giftIdStr !== "") {
    const gift = session
      ? await Gift.findOne({ _id: giftIdStr, receiverId: userId }).session(
          session
        )
      : await Gift.findOne({ _id: giftIdStr, receiverId: userId });

    if (!gift) {
      throw new Error(
        "Gift not found or you don't have permission to allocate it"
      );
    }

    // Check if gift is paid (if payment is required)
    if (
      !gift.isSelfGift &&
      gift.isPaid === false &&
      gift.status === "pending"
    ) {
      throw new Error(
        "Gift payment is pending. Please complete payment first."
      );
    }
  }

  // Get current market price for the allocation type
  let pricePerUnit;
  if (allocationType === "gold") {
    pricePerUnit = GOLD_PRICE_PER_GRAM;
  } else {
    pricePerUnit = TOP50_STOCK_NAV;
  }

  // Calculate quantity
  const quantity = amount / pricePerUnit;

  // Create conversion details
  const conversionDetails = {
    fromType: "money",
    toType: allocationType,
    conversionRate: 1,
    convertedQuantity: quantity,
    fromPrice: 1,
    toPrice: pricePerUnit,
    fromValue: amount,
    toValue: amount,
  };

  // Allocate money using UserHistory method
  // Use giftId only if provided and valid
  const validGiftId = giftIdStr !== "" ? giftIdStr : null;

  if (session) {
    // Manual update with session
    userHistory.unallottedMoney -= amount;
    userHistory.allottedMoney[allocationType] += amount;
    userHistory.allocationHistory.push({
      giftId: validGiftId,
      amount: amount,
      allocationType: allocationType,
      quantity: quantity,
      pricePerUnit: pricePerUnit,
      allocatedAt: new Date(),
      conversionDetails: conversionDetails,
    });

    // Update gift history to mark as fully allocated if needed
    if (validGiftId) {
      const giftEntry = userHistory.giftHistory.find(
        (g) => g.giftId && g.giftId.toString() === validGiftId.toString()
      );
      if (giftEntry) {
        const totalAllocatedForGift = userHistory.allocationHistory
          .filter(
            (a) => a.giftId && a.giftId.toString() === validGiftId.toString()
          )
          .reduce((sum, a) => sum + a.amount, 0);

        if (totalAllocatedForGift >= giftEntry.amount) {
          giftEntry.isFullyAllocated = true;
        }
      }
    }

    await userHistory.save({ session });
  } else {
    await userHistory.allocateMoney(
      amount,
      allocationType,
      validGiftId,
      quantity,
      pricePerUnit,
      conversionDetails
    );
  }

  // Update gift status if giftId provided and valid
  if (giftIdStr !== "") {
    const gift = session
      ? await Gift.findById(giftIdStr).session(session)
      : await Gift.findById(giftIdStr);

    if (gift) {
      // Check total allocated for this gift
      const totalAllocatedForGift = userHistory.allocationHistory
        .filter((a) => a.giftId && a.giftId.toString() === giftIdStr)
        .reduce((sum, a) => sum + a.amount, 0);

      // Update gift status
      if (!gift.allottedAt) {
        gift.allottedAt = new Date();
      }

      if (totalAllocatedForGift >= gift.valueInINR) {
        // Fully allocated
        gift.isAllotted = true;
        gift.status = "allotted";

        // Disable any pending auto-allocation task for this gift
        await AutoAllocationTask.findOneAndUpdate(
          { giftId: giftIdStr },
          {
            isActive: false,
            lastRunAt: new Date(),
            error: "Manually allocated by user",
          }
        );
      } else {
        // Partially allocated
        gift.status = gift.status === "pending" ? "accepted" : gift.status;

        // Reschedule the task to check again in 1 hour (if task exists)
        await AutoAllocationTask.findOneAndUpdate(
          { giftId: giftIdStr, isActive: true },
          {
            scheduledAt: new Date(Date.now() + 60 * 60 * 1000),
            lastRunAt: new Date(),
            error: "Partial manual allocation - remaining amount pending",
          }
        );
      }

      gift.hiddenFromSender = false;

      if (session) {
        await gift.save({ session });
      } else {
        await gift.save();
      }
    }
  }

  return {
    userHistory: userHistory,
    allocationDetails: {
      amount: amount,
      allocationType: allocationType,
      quantity: quantity,
      pricePerUnit: pricePerUnit,
      conversionDetails: conversionDetails,
    },
  };
}

/**
 * Get user's allocation summary
 *
 * @param {string} userId - User ID
 * @returns {Object} User allocation summary
 */
async function getUserAllocationSummary(userId) {
  const userHistory = await UserHistory.getOrCreate(userId);

  return {
    unallottedMoney: userHistory.unallottedMoney,
    allottedMoney: userHistory.allottedMoney,
    totalAllotted:
      userHistory.allottedMoney.gold + userHistory.allottedMoney.stock,
    allocationHistory: userHistory.allocationHistory,
    giftHistory: userHistory.giftHistory,
  };
}

module.exports = {
  allocateGift,
  addGiftToUserHistory,
  getUserAllocationSummary,
  GOLD_PRICE_PER_GRAM,
  TOP50_STOCK_NAV,
};
