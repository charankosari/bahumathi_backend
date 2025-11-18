const mongoose = require("mongoose");
const Gift = require("../models/Gift");
const asyncHandler = require("../middlewares/asyncHandler");
const { getIO } = require("../server");
const { allocateGift } = require("../services/giftAllocation.service");

/**
 * Allocate/Convert a gift to gold or top 50 stocks
 * POST /api/v1/gifts/:giftId/allocate
 * Body: { allocationType: "gold" | "stock" }
 */
exports.allocateGift = asyncHandler(async (req, res, next) => {
  const { giftId } = req.params;
  const { allocationType } = req.body;
  const userId = req.user.id;

  // Validate allocation type
  if (!allocationType || !["gold", "stock"].includes(allocationType)) {
    const err = new Error("allocationType must be either 'gold' or 'stock'");
    err.statusCode = 400;
    return next(err);
  }

  // Start transaction for atomicity
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Use the shared allocation service (handles validation and conversion)
    const gift = await allocateGift({
      giftId,
      userId,
      allocationType,
      session,
    });

    // Extract conversion details for response
    const conversionDetails = gift.conversionDetails;
    const convertedQuantity = gift.quantity;

    // Commit transaction
    await session.commitTransaction();

    // Emit socket events to notify both sender and receiver
    const io = getIO();
    if (io) {
      // Notify receiver
      io.to(userId).emit("giftAllotted", {
        giftId: gift._id,
        gift: gift,
        allocationType: allocationType,
        convertedQuantity: convertedQuantity,
      });

      // Notify sender
      io.to(String(gift.senderId)).emit("giftAccepted", {
        giftId: gift._id,
        conversationId: gift.conversationId,
        allocationType: allocationType,
      });
    }

    res.status(200).json({
      success: true,
      message: `Gift successfully allocated to ${allocationType}`,
      gift: {
        _id: gift._id,
        type: gift.type,
        convertedTo: allocationType,
        isAllotted: gift.isAllotted,
        allottedAt: gift.allottedAt,
        conversionDetails: conversionDetails,
        quantity: gift.quantity, // New quantity after allocation
        convertedQuantity: convertedQuantity,
        valueInINR: gift.valueInINR, // Current value at allocation time
        originalValueInINR: gift.originalValueInINR, // Original value at gift time
        allottedValueInINR: gift.allottedValueInINR, // Value at allocation time
        currentPricePerUnit: gift.currentPricePerUnit, // Current price per unit
        pricePerUnitAtGift: gift.pricePerUnitAtGift, // Original price at gift time
      },
    });
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
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
