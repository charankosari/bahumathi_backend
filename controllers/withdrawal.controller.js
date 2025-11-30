const WithdrawalRequest = require("../models/WithdrawalRequest");
const Kyc = require("../models/Kyc");
const Event = require("../models/Event");
const Gift = require("../models/Gift");
const UserHistory = require("../models/UserHistory");
const asyncHandler = require("../middlewares/asyncHandler");
const mongoose = require("mongoose");

/**
 * Create a withdrawal request
 * POST /api/v1/withdrawals
 * Body: { eventId, amount }
 */
exports.createWithdrawalRequest = asyncHandler(async (req, res, next) => {
  const { eventId, amount } = req.body;
  const userId = req.user.id;

  // Validate required fields
  if (!eventId || !amount) {
    const err = new Error("Event ID and amount are required");
    err.statusCode = 400;
    return next(err);
  }

  if (amount <= 0) {
    const err = new Error("Amount must be greater than 0");
    err.statusCode = 400;
    return next(err);
  }

  // Verify event exists and belongs to user
  const event = await Event.findOne({ _id: eventId, creatorId: userId });
  if (!event) {
    const err = new Error(
      "Event not found or you don't have permission to withdraw from it"
    );
    err.statusCode = 404;
    return next(err);
  }

  // 1. Check KYC Status
  const kyc = await Kyc.findOne({ user: userId });
  if (!kyc || kyc.status !== "approved") {
    const err = new Error("You must have an approved KYC to request a withdrawal");
    err.statusCode = 403;
    return next(err);
  }

  // 2. Check Event Status (Must be ended)
  const now = new Date();
  if (now <= event.eventEndDate) {
    const err = new Error(
      "Withdrawals are only allowed after the event has ended"
    );
    err.statusCode = 400;
    return next(err);
  }

  // 3. Check Gift Status (Must be unallotted)
  // We check if ANY gift in this event has been allotted.
  // If even one gift is allotted, we block withdrawal (based on "gifts are in unallotted state" requirement)
  const allottedGiftsCount = await Gift.countDocuments({
    eventId: event._id,
    status: "allotted",
  });

  if (allottedGiftsCount > 0) {
    const err = new Error(
      "Cannot withdraw: Some gifts have already been allotted. Withdrawals are only allowed when gifts are in unallotted state."
    );
    err.statusCode = 400;
    return next(err);
  }

  // Get total gifts for this event
  const gifts = await Gift.find({ eventId: event._id });
  const totalAmount = gifts.reduce(
    (sum, gift) => sum + (gift.valueInINR || 0),
    0
  );

  // Calculate maximum withdrawable amount (30% of total gifts)
  const maxWithdrawable = (totalAmount * event.withdrawalPercentage) / 100;

  // Get existing pending AND approved requests for this event to calculate total withdrawn/requested
  // Note: We need to subtract ALL previous requests (pending + approved) to enforce the cumulative limit
  const allRequests = await WithdrawalRequest.find({
    eventId: event._id,
    status: { $in: ["pending", "approved"] },
  });
  
  const totalWithdrawnOrRequested = allRequests.reduce(
    (sum, req) => sum + req.amount,
    0
  );

  // Calculate available amount
  const availableForWithdrawal = Math.max(
    0,
    maxWithdrawable - totalWithdrawnOrRequested
  );

  if (amount > availableForWithdrawal) {
    const err = new Error(
      `Insufficient funds. Maximum withdrawable: ₹${maxWithdrawable.toFixed(
        2
      )}, ` +
        `Already withdrawn/requested: ₹${totalWithdrawnOrRequested.toFixed(2)}, ` +
        `Available: ₹${availableForWithdrawal.toFixed(2)}`
    );
    err.statusCode = 400;
    return next(err);
  }

  // Get user history
  const userHistory = await UserHistory.getOrCreate(userId);

  // Check if user has enough unallotted money
  if (userHistory.unallottedMoney < amount) {
    const err = new Error(
      `Insufficient unallotted money. Available: ₹${userHistory.unallottedMoney}, Requested: ₹${amount}`
    );
    err.statusCode = 400;
    return next(err);
  }

  // Start transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Move money from unallotted to holding
    userHistory.unallottedMoney -= amount;
    userHistory.holdingMoney = (userHistory.holdingMoney || 0) + amount;
    await userHistory.save({ session });

    // Create withdrawal request
    const withdrawalRequest = await WithdrawalRequest.create(
      [
        {
          eventId: event._id,
          userId: userId,
          amount: amount,
          percentage: event.withdrawalPercentage,
          totalGiftsAmount: totalAmount,
          status: "pending",
          moneyState: "holding",
        },
      ],
      { session }
    );

    await session.commitTransaction();

    res.status(201).json({
      success: true,
      message: "Withdrawal request created successfully",
      data: {
        withdrawalRequest: withdrawalRequest[0],
      },
    });
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
});

/**
 * Get withdrawal requests for the current user
 * GET /api/v1/withdrawals
 */
exports.getMyWithdrawalRequests = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;

  const requests = await WithdrawalRequest.find({ userId })
    .populate("eventId", "title eventStartDate eventEndDate")
    .populate("approvedBy", "fullName")
    .populate("rejectedBy", "fullName")
    .sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    count: requests.length,
    data: {
      requests: requests,
    },
  });
});

/**
 * Get withdrawal requests for an event (superAdmin and reconciliation only)
 * GET /api/v1/withdrawals/event/:eventId
 */
exports.getEventWithdrawalRequests = asyncHandler(async (req, res, next) => {
  const { eventId } = req.params;

  // Verify event exists
  const event = await Event.findById(eventId);
  if (!event) {
    const err = new Error("Event not found");
    err.statusCode = 404;
    return next(err);
  }

  const requests = await WithdrawalRequest.find({ eventId })
    .populate("userId", "fullName image")
    .populate("approvedBy", "fullName")
    .populate("rejectedBy", "fullName")
    .sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    count: requests.length,
    data: {
      requests: requests,
    },
  });
});

/**
 * Get all withdrawal requests (superAdmin and reconciliation only)
 * GET /api/v1/withdrawals/all
 */
exports.getAllWithdrawalRequests = asyncHandler(async (req, res, next) => {
  // Role check is handled by middleware

  const { status } = req.query;
  const query = status ? { status } : {};

  const requests = await WithdrawalRequest.find(query)
    .populate("eventId", "title eventStartDate eventEndDate")
    .populate("userId", "fullName image")
    .populate("approvedBy", "fullName")
    .populate("rejectedBy", "fullName")
    .sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    count: requests.length,
    data: {
      requests: requests,
    },
  });
});

/**
 * Approve a withdrawal request (superAdmin and reconciliation only)
 * PATCH /api/v1/withdrawals/:requestId/approve
 */
exports.approveWithdrawalRequest = asyncHandler(async (req, res, next) => {
  const { requestId } = req.params;
  const adminId = req.user.id;

  // Role check is handled by middleware

  // Start transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const request = await WithdrawalRequest.findById(requestId).session(
      session
    );

    if (!request) {
      const err = new Error("Withdrawal request not found");
      err.statusCode = 404;
      await session.abortTransaction();
      return next(err);
    }

    if (request.status !== "pending") {
      const err = new Error(`Withdrawal request is already ${request.status}`);
      err.statusCode = 400;
      await session.abortTransaction();
      return next(err);
    }

    // Get user history
    const userHistory = await UserHistory.getOrCreate(request.userId);

    // Verify holding money is sufficient
    if (userHistory.holdingMoney < request.amount) {
      const err = new Error(
        "Insufficient holding money. This should not happen."
      );
      err.statusCode = 500;
      await session.abortTransaction();
      return next(err);
    }

    // Move money from holding to withdrawn (remove from holding, don't add to allotted)
    userHistory.holdingMoney -= request.amount;
    await userHistory.save({ session });

    // Update withdrawal request
    request.status = "approved";
    request.moneyState = "withdrawn";
    request.approvedBy = adminId;
    request.approvedAt = new Date();
    await request.save({ session });

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: "Withdrawal request approved successfully",
      data: {
        withdrawalRequest: request,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
});

/**
 * Reject a withdrawal request (superAdmin and reconciliation only)
 * PATCH /api/v1/withdrawals/:requestId/reject
 * Body: { rejectionReason } (optional)
 */
exports.rejectWithdrawalRequest = asyncHandler(async (req, res, next) => {
  const { requestId } = req.params;
  const { rejectionReason } = req.body;
  const adminId = req.user.id;

  // Role check is handled by middleware

  // Start transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const request = await WithdrawalRequest.findById(requestId).session(
      session
    );

    if (!request) {
      const err = new Error("Withdrawal request not found");
      err.statusCode = 404;
      await session.abortTransaction();
      return next(err);
    }

    if (request.status !== "pending") {
      const err = new Error(`Withdrawal request is already ${request.status}`);
      err.statusCode = 400;
      await session.abortTransaction();
      return next(err);
    }

    // Get user history
    const userHistory = await UserHistory.getOrCreate(request.userId);

    // Verify holding money is sufficient
    if (userHistory.holdingMoney < request.amount) {
      const err = new Error(
        "Insufficient holding money. This should not happen."
      );
      err.statusCode = 500;
      await session.abortTransaction();
      return next(err);
    }

    // Move money from holding back to unallotted (alloting state)
    userHistory.holdingMoney -= request.amount;
    userHistory.unallottedMoney += request.amount;
    await userHistory.save({ session });

    // Update withdrawal request
    request.status = "rejected";
    request.moneyState = "alloting";
    request.rejectedBy = adminId;
    request.rejectedAt = new Date();
    request.rejectionReason = rejectionReason || "Rejected by admin";
    await request.save({ session });

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: "Withdrawal request rejected successfully",
      data: {
        withdrawalRequest: request,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
});
