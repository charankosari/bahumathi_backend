const Event = require("../models/Event");
const Gift = require("../models/Gift");
const asyncHandler = require("../middlewares/asyncHandler");

/**
 * Create a new event
 * POST /api/v1/events
 * Body: { title, description, image, eventStartDate, eventEndDate, withdrawalPercentage }
 */
exports.createEvent = asyncHandler(async (req, res, next) => {
  const {
    title,
    description,
    image,
    eventStartDate,
    eventEndDate,
    withdrawalPercentage,
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
  const percentage = withdrawalPercentage || 30;
  if (percentage < 0 || percentage > 100) {
    const err = new Error("Withdrawal percentage must be between 0 and 100");
    err.statusCode = 400;
    return next(err);
  }

  // Create event
  const event = await Event.create({
    creatorId: userId,
    title,
    description,
    image,
    eventStartDate: startDate,
    eventEndDate: endDate,
    withdrawalPercentage: percentage,
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
  const userId = req.user.id;
  const userRole = req.user.role;

  // SuperAdmin and reconciliation can view all events, others can only view their own
  const query =
    userRole === "superAdmin" || userRole === "reconciliation"
      ? {}
      : { creatorId: userId };

  const events = await Event.find(query)
    .sort({ createdAt: -1 })
    .populate("creatorId", "fullName image");

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

  // SuperAdmin and reconciliation can view any event, others can only view their own
  const query =
    userRole === "superAdmin" || userRole === "reconciliation"
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
  const gifts = await Gift.find({ eventId: event._id });
  const totalGifts = gifts.length;
  const totalAmount = gifts.reduce(
    (sum, gift) => sum + (gift.valueInINR || 0),
    0
  );

  // Get pending withdrawal requests
  const WithdrawalRequest = require("../models/WithdrawalRequest");
  const pendingRequests = await WithdrawalRequest.find({
    eventId: event._id,
    status: "pending",
  });

  // Calculate available amount for withdrawal (considering pending requests)
  const totalPendingAmount = pendingRequests.reduce(
    (sum, req) => sum + req.amount,
    0
  );
  const maxWithdrawable = (totalAmount * event.withdrawalPercentage) / 100;
  const availableForWithdrawal = Math.max(
    0,
    maxWithdrawable - totalPendingAmount
  );

  res.status(200).json({
    success: true,
    data: {
      event: event,
      stats: {
        totalGifts: totalGifts,
        totalAmount: totalAmount,
        maxWithdrawable: maxWithdrawable,
        totalPendingWithdrawals: totalPendingAmount,
        availableForWithdrawal: availableForWithdrawal,
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
  const {
    title,
    description,
    image,
    eventStartDate,
    eventEndDate,
    withdrawalPercentage,
  } = req.body;

  const event = await Event.findOne({ _id: eventId, creatorId: userId });

  if (!event) {
    const err = new Error(
      "Event not found or you don't have permission to update it"
    );
    err.statusCode = 404;
    return next(err);
  }

  // Update fields
  if (title) event.title = title;
  if (description !== undefined) event.description = description;
  if (image !== undefined) event.image = image;
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
  if (withdrawalPercentage !== undefined) {
    if (withdrawalPercentage < 0 || withdrawalPercentage > 100) {
      const err = new Error("Withdrawal percentage must be between 0 and 100");
      err.statusCode = 400;
      return next(err);
    }
    event.withdrawalPercentage = withdrawalPercentage;
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
