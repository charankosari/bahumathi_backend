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
  // Get or create user history - use session if provided
  let userHistory;
  if (session) {
    userHistory = await UserHistory.findOne({ userId }).session(session);
    if (!userHistory) {
      // Create new user history with session
      [userHistory] = await UserHistory.create(
        [
          {
            userId: userId,
            unallottedMoney: 0,
            holdingMoney: 0,
            allottedMoney: { gold: 0, stock: 0 },
            allocationHistory: [],
            giftHistory: [],
          },
        ],
        { session }
      );
    }
    // Ensure holdingMoney exists for existing records
    if (userHistory.holdingMoney === undefined) {
      userHistory.holdingMoney = 0;
    }
  } else {
    userHistory = await UserHistory.getOrCreate(userId);
  }

  // Add unallotted money and record in gift history
  if (session) {
    // Use session for transaction - manually update to ensure session is used
    // Don't call addUnallottedMoney here because it doesn't support sessions
    // and would cause double counting if we called it and then manually updated
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
 * @param {string} params.giftId - Gift ID (for tracking, optional if giftIds provided)
 * @param {Array<string>} params.giftIds - List of Gift IDs for bulk allocation (optional)
 * @param {string} params.userId - User ID (receiver)
 * @param {string} params.allocationType - "gold" or "stock"
 * @param {number} params.amount - Amount in INR to allocate (required)
 * @param {Object} params.session - MongoDB session (optional, for transactions)
 * @returns {Object} Updated UserHistory and allocation details
 */

async function allocateGift({
  giftId,
  giftIds,
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

  // Get or create user history WITH session if provided (to ensure we read latest data in transaction)
  let userHistory;
  if (session) {
    // Fetch with session to ensure we get the latest committed data within the transaction
    userHistory = await UserHistory.findOne({ userId }).session(session);
    if (!userHistory) {
      // Create new user history with session
      userHistory = await UserHistory.create(
        [
          {
            userId: userId,
            unallottedMoney: 0,
            holdingMoney: 0,
            allottedMoney: { gold: 0, stock: 0 },
            allocationHistory: [],
            giftHistory: [],
          },
        ],
        { session }
      );
      userHistory = userHistory[0];
    }
    // Ensure holdingMoney exists for existing records
    if (userHistory.holdingMoney === undefined) {
      userHistory.holdingMoney = 0;
    }
  } else {
    userHistory = await UserHistory.getOrCreate(userId);
  }

  // CRITICAL: Re-fetch with session to ensure we have the latest committed state within the transaction
  // This prevents race conditions where concurrent requests might read stale data
  if (session) {
    userHistory = await UserHistory.findById(userHistory._id).session(session);
    if (!userHistory) {
      throw new Error("User history not found");
    }
  }

  // Validate available balance AFTER re-fetching with session
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
    // Use atomic update to prevent race conditions
    // The query condition ensures we only update if sufficient balance exists
    // This prevents double-spending in concurrent requests
    const allocationHistoryEntry = {
      giftId: validGiftId ? new mongoose.Types.ObjectId(validGiftId) : null,
      amount: amount,
      allocationType: allocationType,
      quantity: quantity,
      pricePerUnit: pricePerUnit,
      allocatedAt: new Date(),
      conversionDetails: conversionDetails,
    };

    const updateResult = await UserHistory.findOneAndUpdate(
      {
        _id: userHistory._id,
        unallottedMoney: { $gte: amount }, // Only update if sufficient balance
      },
      {
        $inc: {
          [`allottedMoney.${allocationType}`]: amount,
          unallottedMoney: -amount,
        },
        $push: {
          allocationHistory: allocationHistoryEntry,
        },
      },
      {
        session,
        new: true, // Return updated document
      }
    );

    if (!updateResult) {
      // Atomic update failed - insufficient balance (race condition detected)
      // Re-fetch to get latest balance for error message
      const latestHistory = await UserHistory.findById(userHistory._id).session(
        session
      );
      throw new Error(
        `Insufficient unallotted money. Available: ₹${
          latestHistory?.unallottedMoney || 0
        }, Requested: ₹${amount}`
      );
    }

    userHistory = updateResult;

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
          await userHistory.save({ session });
        }
      }
    }
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

  // Update gift status if giftId or giftIds provided
  const idsToUpdate = [];
  if (giftIdStr !== "") idsToUpdate.push(giftIdStr);
  if (giftIds && Array.isArray(giftIds)) {
    giftIds.forEach((id) => {
      if (id && String(id).trim() !== "") idsToUpdate.push(String(id).trim());
    });
  }

  // Remove duplicates
  const uniqueIds = [...new Set(idsToUpdate)];

  for (const id of uniqueIds) {
    const gift = session
      ? await Gift.findById(id).session(session)
      : await Gift.findById(id);

    if (gift) {
      // Check total allocated for this gift
      const totalAllocatedForGift = userHistory.allocationHistory
        .filter((a) => a.giftId && a.giftId.toString() === id)
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
          { giftId: id },
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
          { giftId: id, isActive: true },
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
