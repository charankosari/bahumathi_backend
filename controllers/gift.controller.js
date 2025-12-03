const mongoose = require("mongoose");
const Gift = require("../models/Gift");
const asyncHandler = require("../middlewares/asyncHandler");
const { getIO } = require("../server");
const {
  allocateGift,
  getUserAllocationSummary,
} = require("../services/giftAllocation.service");

/**
 * Allocate money from user's unallotted money to gold or stock
 * POST /api/v1/gifts/:giftId/allocate
 * Body: { allocationType: "gold" | "stock", amount: number (required) }
 */
exports.allocateGift = asyncHandler(async (req, res, next) => {
  const { giftId } = req.params;
  const { allocationType, amount, giftIds } = req.body;
  const userId = req.user.id;

  // Validate allocation type
  if (!allocationType || !["gold", "stock"].includes(allocationType)) {
    const err = new Error("allocationType must be either 'gold' or 'stock'");
    err.statusCode = 400;
    return next(err);
  }

  // Validate amount
  if (!amount || typeof amount !== "number" || amount <= 0) {
    const err = new Error("amount is required and must be a positive number");
    err.statusCode = 400;
    return next(err);
  }

  // Start transaction for atomicity
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Use the shared allocation service (handles validation and conversion)
    const result = await allocateGift({
      giftId,
      giftIds, // Pass the list of gift IDs for bulk allocation
      userId,
      allocationType,
      amount,
      session,
    });

    const { userHistory, allocationDetails } = result;

    // Commit transaction
    await session.commitTransaction();

    // Emit socket events to notify both sender and receiver (outside transaction)
    try {
      const io = getIO();
      if (io) {
        // Notify receiver
        io.to(userId).emit("giftAllotted", {
          giftId: giftId,
          allocationType: allocationType,
          amount: amount,
          remainingUnallotted: userHistory.unallottedMoney,
        });

        // Notify sender if gift exists
        if (giftId) {
          const gift = await Gift.findById(giftId).select(
            "senderId conversationId"
          );
          if (gift) {
            io.to(String(gift.senderId)).emit("giftAccepted", {
              giftId: giftId,
              conversationId: gift.conversationId,
              allocationType: allocationType,
            });
          }
        }
      }
    } catch (socketError) {
      // Don't fail the request if socket emission fails
      console.error("Error emitting socket events:", socketError);
    }

    res.status(200).json({
      success: true,
      message: `₹${amount} successfully allocated to ${allocationType}`,
      allocation: {
        amount: allocationDetails.amount,
        allocationType: allocationDetails.allocationType,
        quantity: allocationDetails.quantity,
        pricePerUnit: allocationDetails.pricePerUnit,
        conversionDetails: allocationDetails.conversionDetails,
      },
      userHistory: {
        unallottedMoney: userHistory.unallottedMoney,
        allottedMoney: userHistory.allottedMoney,
        totalAllotted:
          userHistory.allottedMoney.gold + userHistory.allottedMoney.stock,
      },
    });
  } catch (error) {
    // Only abort if transaction hasn't been committed yet
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    const err = new Error(error.message || "Failed to allocate gift");
    err.statusCode = error.statusCode || 500;
    return next(err);
  } finally {
    await session.endSession();
  }
});

/**
 * Get user's allocation summary
 * GET /api/v1/gifts/allocation-summary
 */
exports.getAllocationSummary = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;

  try {
    const summary = await getUserAllocationSummary(userId);
    res.status(200).json({
      success: true,
      data: summary,
    });
  } catch (error) {
    const err = new Error(error.message || "Failed to get allocation summary");
    err.statusCode = error.statusCode || 500;
    return next(err);
  }
});

/**
 * Get user's portfolio summary for home screen
 * Returns: Overall, Gold, and Stock totals (excluding withdrawn gifts)
 * GET /api/v1/gifts/portfolio-summary
 */
exports.getPortfolioSummary = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;

  try {
    const UserHistory = require("../models/UserHistory");
    const WithdrawalRequest = require("../models/WithdrawalRequest");

    // Get user history
    const userHistory = await UserHistory.getOrCreate(userId);

    // Get total withdrawn amount (approved withdrawals only)
    const approvedWithdrawals = await WithdrawalRequest.find({
      userId,
      status: "approved",
    });
    const totalWithdrawn = approvedWithdrawals.reduce(
      (sum, w) => sum + (w.amount || 0),
      0
    );

    // Get allocated amounts (these are the current holdings)
    const goldAmount = userHistory.allottedMoney?.gold || 0;
    const stockAmount = userHistory.allottedMoney?.stock || 0;
    const overallAmount = goldAmount + stockAmount;

    // Calculate percentage change (placeholder - you can enhance this with actual market data)
    // For now, returning 0% change
    const goldChange = "+0.00%";
    const stockChange = "+0.00%";
    const overallChange = "+0.00%";

    res.status(200).json({
      success: true,
      data: {
        overall: {
          amount: overallAmount,
          change: overallChange,
          changeAmount: 0, // You can calculate this based on previous day's value
        },
        gold: {
          amount: goldAmount,
          change: goldChange,
          changeAmount: 0,
        },
        stock: {
          amount: stockAmount,
          change: stockChange,
          changeAmount: 0,
        },
        totalWithdrawn: totalWithdrawn,
      },
    });
  } catch (error) {
    const err = new Error(error.message || "Failed to get portfolio summary");
    err.statusCode = error.statusCode || 500;
    return next(err);
  }
});

/**
 * Helper function to calculate current value of a gift based on current market prices
 * This can be used to update gift values when prices change
 */
const calculateCurrentGiftValue = (gift) => {
  if (!gift.isAllotted || !gift.currentPricePerUnit) {
    // For unallotted gifts, use original value
    return gift.valueInINR;
  }

  // For allotted gifts, calculate: quantity × current market price
  // Note: currentPricePerUnit should be updated periodically with market prices
  return gift.quantity * gift.currentPricePerUnit;
};

/**
 * Get all gifts received by the current user
 * GET /api/v1/gifts/received
 */
exports.getReceivedGifts = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;

  const gifts = await Gift.find({
    receiverId: userId,
  })
    .populate("senderId", "fullName image number")
    .sort({ createdAt: -1 });

  // Calculate current value for each gift
  const giftsWithCurrentValue = gifts.map((gift) => {
    const giftObj = gift.toObject();
    giftObj.currentValueInINR = calculateCurrentGiftValue(gift);
    return giftObj;
  });

  res.status(200).json({
    success: true,
    count: gifts.length,
    gifts: giftsWithCurrentValue,
  });
});

/**
 * Get all gifts sent by the current user
 * GET /api/v1/gifts/sent
 */
exports.getSentGifts = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;

  const gifts = await Gift.find({
    senderId: userId,
  })
    .populate("receiverId", "fullName image number")
    .sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    count: gifts.length,
    gifts: gifts,
  });
});

/**
 * Get a specific gift by ID
 * GET /api/v1/gifts/:giftId
 */
exports.getGiftById = asyncHandler(async (req, res, next) => {
  const { giftId } = req.params;
  const userId = req.user.id;

  const gift = await Gift.findOne({
    _id: giftId,
    $or: [{ senderId: userId }, { receiverId: userId }],
  })
    .populate("senderId", "fullName image number")
    .populate("receiverId", "fullName image number");

  if (!gift) {
    const err = new Error(
      "Gift not found or you don't have permission to view it"
    );
    err.statusCode = 404;
    return next(err);
  }

  res.status(200).json({
    success: true,
    gift: gift,
  });
});

/**
 * Accept a gift (mark as accepted before allocation)
 * PATCH /api/v1/gifts/:giftId/accept
 */
exports.acceptGift = asyncHandler(async (req, res, next) => {
  const { giftId } = req.params;
  const userId = req.user.id;

  const gift = await Gift.findOneAndUpdate(
    {
      _id: giftId,
      receiverId: userId,
      status: "pending",
    },
    {
      status: "accepted",
      isViewedByReceiver: true,
    },
    { new: true }
  )
    .populate("senderId", "fullName image number")
    .populate("receiverId", "fullName image number");

  if (!gift) {
    const err = new Error(
      "Gift not found, already accepted, or you don't have permission to accept it"
    );
    err.statusCode = 404;
    return next(err);
  }

  // Emit socket event to notify sender
  const io = getIO();
  if (io) {
    io.to(String(gift.senderId)).emit("giftViewed", {
      giftId: gift._id,
      conversationId: gift.conversationId,
    });
  }

  res.status(200).json({
    success: true,
    message: "Gift accepted successfully",
    gift: gift,
  });
});
