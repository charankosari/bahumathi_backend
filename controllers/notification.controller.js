const Notification = require("../models/Notification");
const asyncHandler = require("../middlewares/asyncHandler");

/**
 * Get all notifications for the authenticated user
 * GET /api/v1/users/me/notifications
 */
exports.getNotifications = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { page = 1, limit = 50, unreadOnly = false } = req.query;

  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const skip = (pageNum - 1) * limitNum;

  // Build query
  const query = { userId };
  if (unreadOnly === "true") {
    query.isSeen = false;
  }

  // Get notifications
  const notifications = await Notification.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNum)
    .populate("senderId", "fullName image")
    .populate("messageId", "type content")
    .populate("giftId", "type valueInINR")
    .lean();

  // Get total count
  const total = await Notification.countDocuments(query);

  res.status(200).json({
    success: true,
    data: {
      notifications,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    },
  });
});

/**
 * Get unread notifications count
 * GET /api/v1/users/me/notifications/unread-count
 */
exports.getUnreadCount = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const count = await Notification.countDocuments({
    userId,
    isSeen: false,
  });

  res.status(200).json({
    success: true,
    data: {
      unreadCount: count,
    },
  });
});

/**
 * Mark notification as seen
 * PATCH /api/v1/users/me/notifications/:notificationId/seen
 */
exports.markAsSeen = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { notificationId } = req.params;

  const notification = await Notification.findOneAndUpdate(
    {
      _id: notificationId,
      userId, // Ensure user owns this notification
    },
    {
      isSeen: true,
    },
    {
      new: true,
    }
  );

  if (!notification) {
    return res.status(404).json({
      success: false,
      message: "Notification not found",
    });
  }

  res.status(200).json({
    success: true,
    data: notification,
  });
});

/**
 * Mark notification as opened
 * PATCH /api/v1/users/me/notifications/:notificationId/opened
 */
exports.markAsOpened = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { notificationId } = req.params;

  const notification = await Notification.findOneAndUpdate(
    {
      _id: notificationId,
      userId, // Ensure user owns this notification
    },
    {
      isSeen: true,
      isOpened: true,
    },
    {
      new: true,
    }
  );

  if (!notification) {
    return res.status(404).json({
      success: false,
      message: "Notification not found",
    });
  }

  res.status(200).json({
    success: true,
    data: notification,
  });
});

/**
 * Mark all notifications as seen
 * PATCH /api/v1/users/me/notifications/mark-all-seen
 */
exports.markAllAsSeen = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const result = await Notification.updateMany(
    {
      userId,
      isSeen: false,
    },
    {
      isSeen: true,
    }
  );

  res.status(200).json({
    success: true,
    data: {
      updatedCount: result.modifiedCount,
    },
  });
});

/**
 * Delete a notification
 * DELETE /api/v1/users/me/notifications/:notificationId
 */
exports.deleteNotification = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { notificationId } = req.params;

  const notification = await Notification.findOneAndDelete({
    _id: notificationId,
    userId, // Ensure user owns this notification
  });

  if (!notification) {
    return res.status(404).json({
      success: false,
      message: "Notification not found",
    });
  }

  res.status(200).json({
    success: true,
    message: "Notification deleted successfully",
  });
});
