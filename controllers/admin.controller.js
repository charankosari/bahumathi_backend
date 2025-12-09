const Admin = require("../models/admin.model");
const asyncHandler = require("../middlewares/asyncHandler");

// Admin/Agent Login
exports.login = asyncHandler(async (req, res, next) => {
  const { username, password } = req.body;

  if (!password || !username) {
    return res.status(400).json({
      success: false,
      message: "Please provide username and password",
    });
  }

  // Find admin by username
  const admin = await Admin.findOne({
    username,
  }).select("+password");

  if (!admin) {
    return res.status(401).json({
      success: false,
      message: "Invalid credentials",
    });
  }

  // Check password
  const isMatch = await admin.comparePassword(password);
  if (!isMatch) {
    return res.status(401).json({
      success: false,
      message: "Invalid credentials",
    });
  }

  // Check if agent is disabled
  if (admin.status === "disabled") {
    return res.status(403).json({
      success: false,
      message: "Your account has been disabled. Please contact administrator.",
    });
  }

  sendToken(admin, 200, res);
});

// Change Password
exports.changePassword = asyncHandler(async (req, res, next) => {
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    return res.status(400).json({
      success: false,
      message: "Please provide old and new password",
    });
  }

  const admin = await Admin.findById(req.user.id).select("+password");

  const isMatch = await admin.comparePassword(oldPassword);
  if (!isMatch) {
    return res.status(401).json({
      success: false,
      message: "Incorrect old password",
    });
  }

  admin.password = newPassword;
  await admin.save();

  sendToken(admin, 200, res);
});

// Create a new agent (Onboarding or Reconciliation)
exports.createAgent = asyncHandler(async (req, res, next) => {
  const { username, password, role } = req.body;

  if (!username || !password || !role) {
    return res.status(400).json({
      success: false,
      message: "Please provide username, password, and role",
    });
  }

  if (!["onboarding_agent", "reconciliation_agent"].includes(role)) {
    return res.status(400).json({
      success: false,
      message: "Invalid role for agent creation",
    });
  }

  const existingAdmin = await Admin.findOne({ username });
  if (existingAdmin) {
    return res.status(400).json({
      success: false,
      message: "Agent with this username already exists",
    });
  }

  const agent = await Admin.create({
    username,
    password,
    role,
  });

  res.status(201).json({
    success: true,
    agent,
  });
});

// Get all agents with pagination
exports.getAgents = asyncHandler(async (req, res, next) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const startIndex = (page - 1) * limit;

  const total = await Admin.countDocuments({
    role: { $in: ["onboarding_agent", "reconciliation_agent", "admin"] },
  });

  const agents = await Admin.find({
    role: { $in: ["onboarding_agent", "reconciliation_agent", "admin"] },
  })
    .skip(startIndex)
    .limit(limit);

  res.status(200).json({
    success: true,
    count: agents.length,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
    agents,
  });
});

// Update agent details
exports.updateAgent = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { name, role, password } = req.body;

  let agent = await Admin.findById(id);

  if (!agent) {
    return res.status(404).json({
      success: false,
      message: "Agent not found",
    });
  }

  // Update fields
  if (name) agent.name = name;
  if (role) {
    if (!["onboarding_agent", "reconciliation_agent"].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role",
      });
    }
    agent.role = role;
  }
  if (password) {
    agent.password = password; // Will be hashed by pre-save hook
  }

  await agent.save();

  res.status(200).json({
    success: true,
    agent,
  });
});

// Delete agent
// exports.deleteAgent = asyncHandler(async (req, res, next) => {
//   const agent = await Admin.findById(req.params.id);

//   if (!agent) {
//     return res.status(404).json({
//       success: false,
//       message: "Agent not found",
//     });
//   }

//   await agent.deleteOne();

//   res.status(200).json({
//     success: true,
//     message: "Agent deleted successfully",
//   });
// });

/**
 * Get user transactions and withdrawals
 * GET /api/v1/admin/users/:userId/transactions
 */
exports.getUserTransactions = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;

  // Validate userId
  if (!userId) {
    return res.status(400).json({
      success: false,
      message: "User ID is required",
    });
  }

  const mongoose = require("mongoose");
  const User = require("../models/user.model");
  const Gift = require("../models/Gift");
  const UserHistory = require("../models/UserHistory");
  const WithdrawalRequest = require("../models/WithdrawalRequest");
  const Event = require("../models/Event");

  // Check if the requester is an onboarding agent
  const isOnboardingAgent =
    req.user && req.user.role && req.user.role === "onboarding_agent";

  // Verify user exists
  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  // If onboarding agent, verify they onboarded this user
  if (isOnboardingAgent && req.user && req.user._id) {
    if (
      !user.onboardedBy ||
      String(user.onboardedBy) !== String(req.user._id)
    ) {
      return res.status(403).json({
        success: false,
        message: "You can only view transactions for users you have onboarded",
      });
    }
  }

  // Get all events created by the user
  const events = await Event.find({ creatorId: userId }).sort({
    createdAt: -1,
  });

  // Get gifts for each event to calculate stats
  const eventsWithStats = await Promise.all(
    events.map(async (event) => {
      const eventGifts = await Gift.find({ eventId: event._id });
      const totalGifts = eventGifts.length;
      const totalAmount = eventGifts.reduce(
        (sum, gift) => sum + (gift.valueInINR || 0),
        0
      );

      // Get withdrawal requests for this event
      const eventWithdrawals = await WithdrawalRequest.find({
        eventId: event._id,
      });
      const totalWithdrawn = eventWithdrawals
        .filter((w) => w.status === "approved")
        .reduce((sum, w) => sum + (w.amount || 0), 0);
      const totalPending = eventWithdrawals
        .filter((w) => w.status === "pending")
        .reduce((sum, w) => sum + (w.amount || 0), 0);
      const maxWithdrawable = (totalAmount * event.withdrawalPercentage) / 100;

      return {
        id: event._id,
        title: event.title,
        description: event.description,
        image: event.image,
        eventStartDate: event.eventStartDate,
        eventEndDate: event.eventEndDate,
        eventLink: event.eventLink,
        status: event.status,
        withdrawalPercentage: event.withdrawalPercentage,
        stats: {
          totalGiftsReceived: totalGifts,
          totalGiftsAmount: totalAmount,
          maxWithdrawable: maxWithdrawable,
          totalWithdrawn: totalWithdrawn,
          totalPendingWithdrawals: totalPending,
          availableForWithdrawal: Math.max(0, maxWithdrawable - totalPending),
        },
        createdAt: event.createdAt,
        updatedAt: event.updatedAt,
      };
    })
  );

  // Get all gifts sent by the user
  const allGiftsSent = await Gift.find({ senderId: userId })
    .populate("receiverId", "fullName image number")
    .populate("eventId", "title eventLink")
    .sort({ createdAt: -1 });

  // Get all gifts received by the user
  const allGiftsReceived = await Gift.find({ receiverId: userId })
    .populate("senderId", "fullName image number")
    .populate("eventId", "title eventLink")
    .sort({ createdAt: -1 });

  // Separate self-gifts from regular gifts sent
  // Self-gifts should be counted in giftsReceived, not giftsSent
  const giftsSent = allGiftsSent.filter(
    (gift) =>
      !gift.isSelfGift && String(gift.senderId) !== String(gift.receiverId)
  );

  // Include self-gifts in giftsReceived
  const selfGifts = allGiftsSent.filter(
    (gift) =>
      gift.isSelfGift || String(gift.senderId) === String(gift.receiverId)
  );

  const giftsReceived = [...allGiftsReceived, ...selfGifts].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  // Get user history for allocation transactions
  const userHistory = await UserHistory.findOne({ userId }).populate(
    "allocationHistory.giftId",
    "valueInINR type name"
  );

  // Format allocation transactions
  const allocationTransactions = userHistory
    ? userHistory.allocationHistory.map((allocation) => ({
        type: "allocation",
        amount: allocation.amount,
        allocationType: allocation.allocationType,
        quantity: allocation.quantity,
        pricePerUnit: allocation.pricePerUnit,
        allocatedAt: allocation.allocatedAt,
        giftId: allocation.giftId,
        conversionDetails: allocation.conversionDetails,
      }))
    : [];

  // Get all withdrawal requests
  const withdrawals = await WithdrawalRequest.find({ userId })
    .populate("eventId", "title eventLink eventStartDate eventEndDate")
    .populate("approvedBy", "fullName")
    .populate("rejectedBy", "fullName")
    .sort({ createdAt: -1 });

  // Format transactions
  const transactions = [
    // Gifts sent
    ...giftsSent.map((gift) => ({
      type: "gift_sent",
      transactionId: gift.transactionId,
      amount: gift.valueInINR,
      giftType: gift.type,
      giftName: gift.name,
      quantity: gift.quantity,
      status: gift.status,
      receiver: gift.receiverId
        ? {
            id: gift.receiverId._id,
            name: gift.receiverId.fullName,
            image: gift.receiverId.image,
            number: gift.receiverId.number,
          }
        : {
            number: gift.receiverNumber,
          },
      event: gift.eventId
        ? {
            id: gift.eventId._id,
            title: gift.eventId.title,
            eventLink: gift.eventId.eventLink,
          }
        : null,
      createdAt: gift.createdAt,
      isSelfGift: gift.isSelfGift,
    })),
    // Gifts received
    ...giftsReceived.map((gift) => ({
      type: "gift_received",
      transactionId: gift.transactionId,
      amount: gift.valueInINR,
      giftType: gift.type,
      giftName: gift.name,
      quantity: gift.quantity,
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
      event: gift.eventId
        ? {
            id: gift.eventId._id,
            title: gift.eventId.title,
            eventLink: gift.eventId.eventLink,
          }
        : null,
      createdAt: gift.createdAt,
      isSelfGift: gift.isSelfGift,
    })),
    // Allocations
    ...allocationTransactions,
  ].sort((a, b) => {
    const dateA = a.allocatedAt || a.createdAt;
    const dateB = b.allocatedAt || b.createdAt;
    return new Date(dateB) - new Date(dateA);
  });

  // Get total unallocated money from UserHistory (current state)
  const totalUnallocatedMoney = userHistory?.unallottedMoney || 0;

  // Calculate totals
  const totalGiftsSent = giftsSent.reduce(
    (sum, gift) => sum + (gift.valueInINR || 0),
    0
  );
  const totalGiftsReceived = giftsReceived.reduce(
    (sum, gift) => sum + (gift.valueInINR || 0),
    0
  );
  const totalAllocated = allocationTransactions.reduce(
    (sum, alloc) => sum + (alloc.amount || 0),
    0
  );
  const totalWithdrawn = withdrawals
    .filter((w) => w.status === "approved")
    .reduce((sum, w) => sum + (w.amount || 0), 0);
  const totalPendingWithdrawals = withdrawals
    .filter((w) => w.status === "pending")
    .reduce((sum, w) => sum + (w.amount || 0), 0);

  // Calculate event totals
  const totalEventsCreated = eventsWithStats.length;
  const totalEventGiftsAmount = eventsWithStats.reduce(
    (sum, event) => sum + (event.stats.totalGiftsAmount || 0),
    0
  );
  const totalEventWithdrawals = eventsWithStats.reduce(
    (sum, event) => sum + (event.stats.totalWithdrawn || 0),
    0
  );

  res.status(200).json({
    success: true,
    data: {
      user: {
        id: user._id,
        fullName: user.fullName,
        number: user.number,
        image: user.image,
      },
      summary: {
        totalGiftsSent,
        totalGiftsReceived,
        totalAllocated,
        totalWithdrawn,
        totalPendingWithdrawals,
        totalUnallocatedMoney,
        totalEventsCreated,
        totalEventGiftsAmount,
        totalEventWithdrawals,
      },
      transactions: {
        giftsSent: giftsSent.length,
        giftsReceived: giftsReceived.length,
        allocations: allocationTransactions.length,
        total: transactions.length,
        list: transactions,
      },
      withdrawals: {
        total: withdrawals.length,
        approved: withdrawals.filter((w) => w.status === "approved").length,
        pending: withdrawals.filter((w) => w.status === "pending").length,
        rejected: withdrawals.filter((w) => w.status === "rejected").length,
        list: withdrawals,
      },
      events: {
        total: eventsWithStats.length,
        active: eventsWithStats.filter((e) => e.status === "active").length,
        ended: eventsWithStats.filter((e) => e.status === "ended").length,
        cancelled: eventsWithStats.filter((e) => e.status === "cancelled")
          .length,
        list: eventsWithStats,
      },
    },
  });
});

// Helper to send token
const sendToken = (user, statusCode, res) => {
  const token = user.getJwtToken();

  // Options for cookie
  const options = {
    expires: new Date(
      Date.now() + (process.env.COOKIE_EXPIRE || 7) * 24 * 60 * 60 * 1000
    ),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  };

  user.password = undefined; // Ensure password is not sent in response

  res.status(statusCode).cookie("token", token, options).json({
    success: true,
    token,
    user,
  });
};
