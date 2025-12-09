const Event = require("../models/Event");
const Gift = require("../models/Gift");
const asyncHandler = require("../middlewares/asyncHandler");

/**
 * Create a new event
 * POST /api/v1/events
 * Body: { title, description, image, video, eventStartDate, eventEndDate, withdrawalPercentage }
 */
exports.createEvent = asyncHandler(async (req, res, next) => {
  const {
    title,
    description,
    image,
    video,
    eventStartDate,
    eventEndDate,
    // withdrawalPercentage,
  } = req.body;
  const userId = req.user.id;

  // Validate required fields
  if (!title || !eventStartDate || !eventEndDate) {
    const err = new Error(
      "Title, event start date, and event end date are required"
    );
    err.statusCode = 400;
    return next(err);
  }

  // Validate dates
  const startDate = new Date(eventStartDate);
  const endDate = new Date(eventEndDate);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    const err = new Error("Invalid date format");
    err.statusCode = 400;
    return next(err);
  }

  if (startDate >= endDate) {
    const err = new Error("Event end date must be after start date");
    err.statusCode = 400;
    return next(err);
  }

  // Validate withdrawal percentage
  // const percentage = withdrawalPercentage || 30;
  // if (percentage < 0 || percentage > 100) {
  //   const err = new Error("Withdrawal percentage must be between 0 and 100");
  //   err.statusCode = 400;
  //   return next(err);
  // }

  // Create event
  const event = await Event.create({
    creatorId: userId,
    title,
    description,
    image,
    video,
    eventStartDate: startDate,
    eventEndDate: endDate,
    // withdrawalPercentage: percentage,
  });

  res.status(201).json({
    success: true,
    message: "Event created successfully",
    data: {
      event: event,
      eventLink: event.eventLink,
    },
  });
});

/**
 * Get all events created by the current user (or all events for superAdmin/reconciliation)
 * GET /api/v1/events
 */
exports.getMyEvents = asyncHandler(async (req, res, next) => {
  // Use _id if available, otherwise use id (Mongoose provides both)
  const userId = req.user._id || req.user.id;
  const userRole = req.user.role;

  // SuperAdmin, admin, and reconciliation can view all events, others can only view their own
  const query =
    userRole === "superAdmin" ||
    userRole === "admin" ||
    userRole === "reconciliation"
      ? {}
      : { creatorId: userId };

  // Debug logging
  console.log("🔍 [getMyEvents] Query:", JSON.stringify(query));
  console.log("🔍 [getMyEvents] User ID:", userId?.toString());
  console.log("🔍 [getMyEvents] User _id:", req.user._id?.toString());
  console.log("🔍 [getMyEvents] User id:", req.user.id);
  console.log("🔍 [getMyEvents] User Role:", userRole);

  const events = await Event.find(query)
    .sort({ createdAt: -1 })
    .populate("creatorId", "fullName image");

  console.log("🔍 [getMyEvents] Found events:", events.length);

  // Also check if there are any events in the database at all
  const totalEvents = await Event.countDocuments({});
  console.log("🔍 [getMyEvents] Total events in DB:", totalEvents);

  // If no events found but user is not admin, check if creatorId matches
  if (
    events.length === 0 &&
    userRole !== "superAdmin" &&
    userRole !== "reconciliation"
  ) {
    const allEvents = await Event.find({}).select("creatorId");
    console.log(
      "🔍 [getMyEvents] All event creatorIds:",
      allEvents.map((e) => e.creatorId?.toString())
    );
    console.log("🔍 [getMyEvents] Current user ID:", userId?.toString());

    // Try to find events with different ID formats
    const mongoose = require("mongoose");
    const matchingEvents = await Event.find({
      $or: [
        { creatorId: userId },
        { creatorId: userId?.toString() },
        { creatorId: new mongoose.Types.ObjectId(userId) },
      ],
    });
    console.log(
      "🔍 [getMyEvents] Events with various ID formats:",
      matchingEvents.length
    );
  }

  res.status(200).json({
    success: true,
    count: events.length,
    data: {
      events: events,
    },
  });
});

/**
 * Get event by link (public endpoint - can be accessed without auth for sharing)
 * GET /api/v1/events/link/:eventLink
 */
exports.getEventByLink = asyncHandler(async (req, res, next) => {
  const { eventLink } = req.params;

  const event = await Event.findOne({ eventLink }).populate(
    "creatorId",
    "fullName image"
  );

  if (!event) {
    const err = new Error("Event not found");
    err.statusCode = 404;
    return next(err);
  }

  // Get total gifts for this event
  const gifts = await Gift.find({ eventId: event._id });
  const totalGifts = gifts.length;
  const totalAmount = gifts.reduce(
    (sum, gift) => sum + (gift.valueInINR || 0),
    0
  );

  // Update event stats
  event.totalGiftsReceived = totalGifts;
  event.totalGiftsAmount = totalAmount;
  await event.save();

  res.status(200).json({
    success: true,
    data: {
      event: event,
      stats: {
        totalGifts: totalGifts,
        totalAmount: totalAmount,
        availableForWithdrawal:
          (totalAmount * event.withdrawalPercentage) / 100,
      },
    },
  });
});

/**
 * Get a specific event by ID (creator, superAdmin, or reconciliation can access)
 * GET /api/v1/events/:eventId
 */
exports.getEventById = asyncHandler(async (req, res, next) => {
  const { eventId } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  // SuperAdmin, admin, and reconciliation can view any event, others can only view their own
  const query =
    userRole === "superAdmin" ||
    userRole === "admin" ||
    userRole === "reconciliation"
      ? { _id: eventId }
      : { _id: eventId, creatorId: userId };

  const event = await Event.findOne(query).populate(
    "creatorId",
    "fullName image"
  );

  if (!event) {
    const err = new Error(
      "Event not found or you don't have permission to view it"
    );
    err.statusCode = 404;
    return next(err);
  }

  // Get total gifts for this event
  const gifts = await Gift.find({ eventId: event._id })
    .populate("senderId", "fullName image number")
    .populate("receiverId", "fullName image number")
    .sort({ createdAt: -1 });

  const totalGifts = gifts.length;
  const totalAmount = gifts.reduce(
    (sum, gift) => sum + (gift.valueInINR || 0),
    0
  );

  // Get all withdrawal requests for this event
  const WithdrawalRequest = require("../models/WithdrawalRequest");
  const allWithdrawals = await WithdrawalRequest.find({
    eventId: event._id,
  })
    .populate("userId", "fullName image number")
    .populate("approvedBy", "fullName")
    .populate("rejectedBy", "fullName")
    .sort({ createdAt: -1 });

  const pendingRequests = allWithdrawals.filter(
    (req) => req.status === "pending"
  );
  const approvedRequests = allWithdrawals.filter(
    (req) => req.status === "approved"
  );
  const rejectedRequests = allWithdrawals.filter(
    (req) => req.status === "rejected"
  );

  // Calculate available amount for withdrawal (considering pending requests)
  const totalPendingAmount = pendingRequests.reduce(
    (sum, req) => sum + req.amount,
    0
  );
  const totalWithdrawnAmount = approvedRequests.reduce(
    (sum, req) => sum + req.amount,
    0
  );
  const maxWithdrawable = (totalAmount * event.withdrawalPercentage) / 100;
  const availableForWithdrawal = Math.max(
    0,
    maxWithdrawable - totalPendingAmount - totalWithdrawnAmount
  );

  // Format gifts for response
  const formattedGifts = gifts.map((gift) => ({
    id: gift._id,
    transactionId: gift.transactionId,
    amount: gift.valueInINR,
    giftType: gift.type,
    giftName: gift.name,
    quantity: gift.quantity,
    pricePerUnit: gift.pricePerUnitAtGift,
    status: gift.status,
    isAllotted: gift.isAllotted,
    sender: gift.senderId
      ? {
          id: gift.senderId._id,
          name: gift.senderId.fullName,
          image: gift.senderId.image,
          number: gift.senderId.number,
        }
      : null,
    receiver: gift.receiverId
      ? {
          id: gift.receiverId._id,
          name: gift.receiverId.fullName,
          image: gift.receiverId.image,
          number: gift.receiverId.number,
        }
      : null,
    createdAt: gift.createdAt,
    isSelfGift: gift.isSelfGift,
  }));

  // Format withdrawals for response
  const formattedWithdrawals = allWithdrawals.map((withdrawal) => ({
    id: withdrawal._id,
    amount: withdrawal.amount,
    percentage: withdrawal.percentage,
    totalGiftsAmount: withdrawal.totalGiftsAmount,
    status: withdrawal.status,
    moneyState: withdrawal.moneyState,
    user: withdrawal.userId
      ? {
          id: withdrawal.userId._id,
          name: withdrawal.userId.fullName,
          image: withdrawal.userId.image,
          number: withdrawal.userId.number,
        }
      : null,
    approvedBy: withdrawal.approvedBy
      ? {
          id: withdrawal.approvedBy._id,
          name: withdrawal.approvedBy.fullName,
        }
      : null,
    rejectedBy: withdrawal.rejectedBy
      ? {
          id: withdrawal.rejectedBy._id,
          name: withdrawal.rejectedBy.fullName,
        }
      : null,
    approvedAt: withdrawal.approvedAt,
    rejectedAt: withdrawal.rejectedAt,
    rejectionReason: withdrawal.rejectionReason,
    createdAt: withdrawal.createdAt,
  }));

  res.status(200).json({
    success: true,
    data: {
      event: event,
      stats: {
        totalGifts: totalGifts,
        totalAmount: totalAmount,
        maxWithdrawable: maxWithdrawable,
        totalPendingWithdrawals: totalPendingAmount,
        totalWithdrawn: totalWithdrawnAmount,
        availableForWithdrawal: availableForWithdrawal,
      },
      // Include gifts and withdrawals for admin users
      gifts: formattedGifts,
      withdrawals: {
        total: allWithdrawals.length,
        pending: pendingRequests.length,
        approved: approvedRequests.length,
        rejected: rejectedRequests.length,
        list: formattedWithdrawals,
      },
    },
  });
});

/**
 * Update event
 * PATCH /api/v1/events/:eventId
 */
exports.updateEvent = asyncHandler(async (req, res, next) => {
  const { eventId } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;
  const {
    title,
    description,
    image,
    video,
    eventStartDate,
    eventEndDate,
    withdrawalPercentage,
  } = req.body;

  // SuperAdmin, admin, and reconciliation can update any event, others can only update their own
  const query =
    userRole === "admin" || userRole === "reconciliation"
      ? { _id: eventId }
      : { _id: eventId, creatorId: userId };

  const event = await Event.findOne(query);

  if (!event) {
    const err = new Error(
      "Event not found or you don't have permission to update it"
    );
    err.statusCode = 404;
    return next(err);
  }

  // Check if user is trying to update withdrawalPercentage
  // Only admin, superAdmin, or reconciliation can update this field
  if (withdrawalPercentage !== undefined) {
    const isAdminRole = userRole === "admin" || userRole === "reconciliation";

    if (!isAdminRole) {
      const err = new Error(
        "Only admin users can update withdrawal percentage"
      );
      err.statusCode = 403;
      return next(err);
    }

    if (withdrawalPercentage < 0 || withdrawalPercentage > 100) {
      const err = new Error("Withdrawal percentage must be between 0 and 100");
      err.statusCode = 400;
      return next(err);
    }
    event.withdrawalPercentage = withdrawalPercentage;
  }

  // Update fields
  if (title) event.title = title;
  if (description !== undefined) event.description = description;
  if (image !== undefined) event.image = image;
  if (video !== undefined) event.video = video;
  if (eventStartDate) {
    const startDate = new Date(eventStartDate);
    if (isNaN(startDate.getTime())) {
      const err = new Error("Invalid start date format");
      err.statusCode = 400;
      return next(err);
    }
    event.eventStartDate = startDate;
  }
  if (eventEndDate) {
    const endDate = new Date(eventEndDate);
    if (isNaN(endDate.getTime())) {
      const err = new Error("Invalid end date format");
      err.statusCode = 400;
      return next(err);
    }
    event.eventEndDate = endDate;
  }

  // Validate dates if both are updated
  if (event.eventStartDate >= event.eventEndDate) {
    const err = new Error("Event end date must be after start date");
    err.statusCode = 400;
    return next(err);
  }

  await event.save();

  res.status(200).json({
    success: true,
    message: "Event updated successfully",
    data: {
      event: event,
    },
  });
});

/**
 * Delete event
 * DELETE /api/v1/events/:eventId
 */
exports.deleteEvent = asyncHandler(async (req, res, next) => {
  const { eventId } = req.params;
  const userId = req.user.id;

  const event = await Event.findOne({ _id: eventId, creatorId: userId });

  if (!event) {
    const err = new Error(
      "Event not found or you don't have permission to delete it"
    );
    err.statusCode = 404;
    return next(err);
  }

  // Check if there are any gifts associated with this event
  const giftsCount = await Gift.countDocuments({ eventId: event._id });
  if (giftsCount > 0) {
    const err = new Error(
      "Cannot delete event with associated gifts. Please cancel the event instead."
    );
    err.statusCode = 400;
    return next(err);
  }

  await event.deleteOne();

  res.status(200).json({
    success: true,
    message: "Event deleted successfully",
  });
});

/**
 * End event now
 * POST /api/v1/events/:eventId/end
 */
exports.endEventNow = asyncHandler(async (req, res, next) => {
  const { eventId } = req.params;
  const userId = req.user.id;

  const event = await Event.findOne({ _id: eventId, creatorId: userId });

  if (!event) {
    const err = new Error(
      "Event not found or you don't have permission to update it"
    );
    err.statusCode = 404;
    return next(err);
  }

  // Set end date to now
  event.eventEndDate = new Date();
  await event.save();

  res.status(200).json({
    success: true,
    message: "Event ended successfully",
    data: {
      event: event,
    },
  });
});
