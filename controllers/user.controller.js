const mongoose = require("mongoose");
const User = require("../models/user.model");
const asyncHandler = require("../middlewares/asyncHandler");
const sendJwtToken = require("../utils/sendJwtToken");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const sendOtp = require("../libs/sms/sms");
const Gift = require("../models/Gift");
const QRCode = require("qrcode");
const { Uploader } = require("../libs/s3/s3");

const generateOtp = () => {
  return crypto.randomInt(1000, 9999).toString();
};

const hashOtp = async (otp) => {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(otp, salt);
};

// Ensure QR exists for a user (custom scheme id-based URL) and upload to S3 once
const {
  processPendingGiftsForUser,
} = require("../services/pendingGifts.service");

const ensureUserQr = async (user) => {
  if (!user || user.qrCodeUrl) return user;
  // Use HTTPS link for Universal Links / App Links support
  // Updated to /usergifting path as requested
  const url = `https://bahumati.in/usergifting?user=${user._id}`;
  const pngBuffer = await QRCode.toBuffer(url, { type: "png", width: 512 });
  const uploader = new Uploader();
  const keyName = `qr_${user._id}.png`;
  const publicUrl = await uploader.uploadPublicFile(
    keyName,
    pngBuffer,
    "image/png"
  );
  user.qrCodeUrl = publicUrl;
  await user.save({ validateBeforeSave: false });
  return user;
};

const normalizePhoneNumber = (rawNumber) => {
  if (rawNumber === null || rawNumber === undefined) return null;
  const digits = String(rawNumber).replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
};

const startOtpFlowForNumber = async ({ number, fullName }) => {
  const normalizedNumber = normalizePhoneNumber(number);
  if (!normalizedNumber) {
    const err = new Error("A valid 10-digit phone number is required");
    err.statusCode = 400;
    throw err;
  }

  let user = await User.findOne({ number: normalizedNumber });

  const otp = generateOtp();
  const hashedOtp = await hashOtp(otp);
  const otpExpires = Date.now() + 10 * 60 * 1000;

  if (!user) {
    const fallbackName = "";
    user = await User.create({
      fullName: fallbackName,
      number: normalizedNumber,
      otp: hashedOtp,
      otpExpires,
      active: false,
    });
  } else {
    if (fullName && !user.fullName) {
      user.fullName = fullName.trim();
    }
    user.otp = hashedOtp;
    user.otpExpires = otpExpires;
  }

  await user.save({ validateBeforeSave: false });

  try {
    await ensureUserQr(user);
  } catch (e) {
    console.error("QR generation failed (OTP flow):", e.message);
  }

  try {
    await sendOtp(normalizedNumber, otp);
  } catch (smsError) {
    console.error("Failed to send OTP:", smsError.message);
  }

  console.log(`OTP for ${normalizedNumber}: ${otp}`);
  return normalizedNumber;
};

// ========== LOGIN (Number based) ==========
exports.login = asyncHandler(async (req, res, next) => {
  const { fullName, number } = req.body;
  await startOtpFlowForNumber({ number, fullName });
  res.status(200).json({
    success: true,
    message: "OTP sent successfully. Please verify to continue.",
  });
});

// ========== OTP VERIFY (Number based) ==========
exports.verifyOtp = asyncHandler(async (req, res, next) => {
  const { number, otp } = req.body;

  if (!otp) {
    const err = new Error("OTP is required");
    err.statusCode = 400;
    return next(err);
  }

  const normalizedNumber = normalizePhoneNumber(number);
  if (!normalizedNumber) {
    const err = new Error("A valid 10-digit phone number is required");
    err.statusCode = 400;
    return next(err);
  }

  const user = await User.findOne({
    number: normalizedNumber,
    otpExpires: { $gt: Date.now() },
  }).select("+otp");

  if (!user) {
    const err = new Error("Invalid number or OTP has expired");
    err.statusCode = 400;
    return next(err);
  }

  const isMatch = await user.compareOtp(otp);

  if (!isMatch) {
    const err = new Error("Invalid OTP");
    err.statusCode = 400;
    return next(err);
  }

  if (!user.active) {
    user.active = true;
  }

  user.otp = undefined;
  user.otpExpires = undefined;
  await user.save({ validateBeforeSave: false });
  try {
    await ensureUserQr(user);
  } catch (e) {
    console.error("QR gen failed (verifyMobileOtpForGoogleAuth):", e.message);
  }
  // Ensure QR exists when user is activated/logs in the first time
  try {
    await ensureUserQr(user);
  } catch (e) {
    console.error("QR gen failed (verifyOtp):", e.message);
  }

  // Process pending gifts for this user (if any)
  if (user.number) {
    try {
      const result = await processPendingGiftsForUser(user._id, user.number);
      console.log(
        `✅ Processed ${result.giftsProcessed} pending gift(s) for user ${user._id}`
      );
    } catch (pendingGiftsError) {
      console.error(
        "Error processing pending gifts:",
        pendingGiftsError.message
      );
      // Don't fail the login if pending gifts processing fails
    }
  }

  sendJwtToken(user, 200, "Login successful", res);
});

exports.getUserDetails = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;

  const user = await User.findById(userId);

  if (!user) {
    const err = new Error("User not found");
    err.statusCode = 404;
    return next(err);
  }

  res.status(200).json({
    success: true,
    user,
  });
});

// ========== VERIFY OTP (Admin/Agent side - sets onboardedBy) ==========
exports.verifyOtpForAdmin = asyncHandler(async (req, res, next) => {
  const { number, otp } = req.body;

  if (!otp) {
    const err = new Error("OTP is required");
    err.statusCode = 400;
    return next(err);
  }

  const normalizedNumber = normalizePhoneNumber(number);
  if (!normalizedNumber) {
    const err = new Error("A valid 10-digit phone number is required");
    err.statusCode = 400;
    return next(err);
  }

  const user = await User.findOne({
    number: normalizedNumber,
    otpExpires: { $gt: Date.now() },
  }).select("+otp");

  if (!user) {
    const err = new Error("Invalid number or OTP has expired");
    err.statusCode = 400;
    return next(err);
  }

  const isMatch = await user.compareOtp(otp);

  if (!isMatch) {
    const err = new Error("Invalid OTP");
    err.statusCode = 400;
    return next(err);
  }

  // Set onboardedBy to the admin/agent who verified
  if (req.user && req.user._id) {
    user.onboardedBy = req.user._id;
    console.log(
      `📝 User ${user._id} onboarded by admin/agent ${req.user._id} via OTP verification`
    );
  }

  if (!user.active) {
    user.active = true;
  }

  user.otp = undefined;
  user.otpExpires = undefined;
  await user.save({ validateBeforeSave: false });

  try {
    await ensureUserQr(user);
  } catch (e) {
    console.error("QR gen failed (verifyOtpForAdmin):", e.message);
  }

  // Process pending gifts for this user (if any)
  if (user.number) {
    try {
      const result = await processPendingGiftsForUser(user._id, user.number);
      console.log(
        `✅ Processed ${result.giftsProcessed} pending gift(s) for user ${user._id}`
      );
    } catch (pendingGiftsError) {
      console.error(
        "Error processing pending gifts:",
        pendingGiftsError.message
      );
      // Don't fail the verification if pending gifts processing fails
    }
  }

  sendJwtToken(user, 200, "User verified and onboarded successfully", res);
});

// ========== CREATE USER (Admin only - without OTP) ==========
exports.createUser = asyncHandler(async (req, res, next) => {
  const {
    fullName,
    number,
    gender,
    birthDate,
    image,
    defaultGiftMode,
    active = true, // Default to active when created by admin
  } = req.body;

  // Validate phone number
  if (!number) {
    const err = new Error("Phone number is required");
    err.statusCode = 400;
    return next(err);
  }

  const normalizedNumber = normalizePhoneNumber(number);
  if (!normalizedNumber) {
    const err = new Error("A valid 10-digit phone number is required");
    err.statusCode = 400;
    return next(err);
  }

  // Check if user with this number already exists
  const existingUser = await User.findOne({ number: normalizedNumber });
  if (existingUser) {
    const err = new Error("User with this phone number already exists");
    err.statusCode = 400;
    return next(err);
  }

  // Create new user - admins can set active to true without OTP
  const user = await User.create({
    fullName: fullName ? fullName.trim() : "",
    number: normalizedNumber,
    gender: gender ? gender.toLowerCase() : undefined,
    birthDate: birthDate ? new Date(birthDate) : undefined,
    image: image || undefined,
    defaultGiftMode: defaultGiftMode
      ? defaultGiftMode.toLowerCase()
      : undefined,
    active: active === true, // Only admins can set this
    onboardedBy: req.user && req.user._id ? req.user._id : undefined,
  });

  try {
    await ensureUserQr(user);
  } catch (e) {
    console.error("QR generation failed (user creation):", e.message);
  }

  console.log(
    `✅ New user created by admin ${req.user._id} without OTP: ${user._id}`
  );

  res.status(201).json({
    success: true,
    message: "User created successfully without OTP",
    user,
  });
});

exports.deleteUser = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const user = await User.findById(id);

  if (!user) {
    const err = new Error("User not found");
    err.statusCode = 404;
    return next(err);
  }

  await user.remove();

  res.status(200).json({
    success: true,
    message: "User deleted successfully",
  });
});

exports.editUser = asyncHandler(async (req, res, next) => {
  // Support both :id and :userId route parameters
  const { id, userId } = req.params;
  const targetUserId = id || userId;
  const {
    fullName,
    number,
    gender,
    birthDate,
    image,
    defaultGiftMode,
    active,
  } = req.body;

  // Check if the requester is admin or onboarding_agent
  const isAdminOrAgent =
    req.user &&
    req.user.role &&
    (req.user.role === "admin" || req.user.role === "onboarding_agent");

  // Check if the requester is specifically an admin
  const isAdmin = req.user && req.user.role && req.user.role === "admin";

  // Check if the requester is specifically an onboarding_agent
  const isOnboardingAgent =
    req.user && req.user.role && req.user.role === "onboarding_agent";

  console.log("➡️ editUser called", {
    id: targetUserId,
    fullName,
    number,
    gender,
    birthDate,
    image,
    defaultGiftMode,
    active,
    isAdminOrAgent,
    isAdmin,
    isOnboardingAgent,
  });

  let user = await User.findById(targetUserId);

  // VALIDATION: If user exists and is a regular user (not admin/agent),
  // they must provide all three fields (fullName, gender, birthDate) together
  if (user && !isAdminOrAgent) {
    const isUpdatingPersonalDetails =
      fullName !== undefined || gender !== undefined || birthDate !== undefined;

    if (isUpdatingPersonalDetails) {
      // Check if all three required fields are provided
      const hasAllFields =
        fullName !== undefined &&
        fullName !== null &&
        fullName.toString().trim().length > 0 &&
        gender !== undefined &&
        gender !== null &&
        gender.toString().trim().length > 0 &&
        birthDate !== undefined &&
        birthDate !== null;

      if (!hasAllFields) {
        const err = new Error(
          "All personal details (Name, Gender, and Date of Birth) must be provided together. Cannot update fields individually."
        );
        err.statusCode = 400;
        return next(err);
      }
    }
  }

  // If user doesn't exist, only admins can create users without OTP
  if (!user) {
    if (!isAdmin) {
      const err = new Error(
        "User not found. Only admins can create users without OTP."
      );
      err.statusCode = 403;
      return next(err);
    }

    // Admin can create a new user without OTP
    if (!number) {
      const err = new Error("Phone number is required to create a new user");
      err.statusCode = 400;
      return next(err);
    }

    const normalizedNumber = normalizePhoneNumber(number);
    if (!normalizedNumber) {
      const err = new Error("A valid 10-digit phone number is required");
      err.statusCode = 400;
      return next(err);
    }

    // Check if user with this number already exists
    const existingUser = await User.findOne({ number: normalizedNumber });
    if (existingUser) {
      const err = new Error("User with this phone number already exists");
      err.statusCode = 400;
      return next(err);
    }

    // Create new user - admins can set active to true without OTP
    user = await User.create({
      fullName: fullName ? fullName.trim() : "",
      number: normalizedNumber,
      gender: gender ? gender.toLowerCase() : undefined,
      birthDate: birthDate ? new Date(birthDate) : undefined,
      image: image || undefined,
      defaultGiftMode: defaultGiftMode
        ? defaultGiftMode.toLowerCase()
        : undefined,
      active: active === true, // Only admins can set this
    });

    try {
      await ensureUserQr(user);
    } catch (e) {
      console.error("QR generation failed (user creation):", e.message);
    }

    console.log(
      `✅ New user created by admin ${req.user._id} without OTP: ${user._id}`
    );

    return res.status(201).json({
      success: true,
      message: "User created successfully without OTP",
      user,
    });
  }

  // If onboarding agent, verify they can edit this user
  // They can edit users they onboarded OR users that haven't been onboarded yet
  if (isOnboardingAgent && req.user && req.user._id) {
    if (user.onboardedBy && String(user.onboardedBy) !== String(req.user._id)) {
      const err = new Error("You can only edit users you have onboarded");
      err.statusCode = 403;
      return next(err);
    }
  }

  // Update fullName (trim whitespace and save in real-time)
  if (fullName !== undefined && fullName !== null) {
    const trimmedName = String(fullName).trim();
    if (trimmedName.length > 0) {
      user.fullName = trimmedName;
    } else {
      // Allow empty string to clear the name
      user.fullName = "";
    }
  }

  // Handle phone number update
  if (number !== undefined && number !== null) {
    const normalizedNumber = normalizePhoneNumber(number);
    if (!normalizedNumber) {
      const err = new Error("A valid 10-digit phone number is required");
      err.statusCode = 400;
      return next(err);
    }

    if (isAdminOrAgent) {
      // Admin/Agent can update phone number even if it exists
      // Check if number is already used by another user
      const existingNumberUser = await User.findOne({
        number: normalizedNumber,
        _id: { $ne: user._id },
      });
      if (existingNumberUser) {
        const err = new Error("Phone number already in use by another user");
        err.statusCode = 400;
        return next(err);
      }
      user.number = normalizedNumber;
    } else {
      // Regular users can only add number if it doesn't exist
      if (!user.number) {
        const existingNumberUser = await User.findOne({
          number: normalizedNumber,
        });
        if (existingNumberUser) {
          const err = new Error("Phone number already in use by another user");
          err.statusCode = 400;
          return next(err);
        }
        user.number = normalizedNumber;
      }
    }
  }

  // Optional updates
  if (gender !== undefined && gender !== null) {
    const normalizedGender = gender.toLowerCase();
    if (["male", "female", "other"].includes(normalizedGender)) {
      user.gender = normalizedGender;
    } else {
      const err = new Error("Invalid gender. Must be male, female, or other");
      err.statusCode = 400;
      return next(err);
    }
  }

  if (birthDate !== undefined && birthDate !== null) {
    const parsed = new Date(birthDate);
    if (!isNaN(parsed.getTime())) {
      user.birthDate = parsed;
    } else {
      const err = new Error("Invalid birth date format");
      err.statusCode = 400;
      return next(err);
    }
  }

  // Image update (public URL from upload)
  if (image !== undefined && image !== null) {
    user.image = image;
  }

  if (defaultGiftMode !== undefined && defaultGiftMode !== null) {
    const normalizedMode = defaultGiftMode.toString().toLowerCase();
    const allowedModes = ["gold", "stock"];
    if (!allowedModes.includes(normalizedMode)) {
      const err = new Error("Invalid default gift mode");
      err.statusCode = 400;
      return next(err);
    }
    user.defaultGiftMode = normalizedMode;
  }

  // Only admins can activate users without OTP verification
  if (active !== undefined && active !== null) {
    if (!isAdmin) {
      const err = new Error(
        "Only admins can activate users without OTP verification"
      );
      err.statusCode = 403;
      return next(err);
    }
    user.active = active === true;
    console.log(
      `✅ User ${user._id} active status set to ${user.active} by admin ${req.user._id}`
    );
  }

  // Track which onboarding agent onboarded/touched this user
  if (isOnboardingAgent && req.user && req.user._id) {
    user.onboardedBy = req.user._id;
    console.log(`📝 User ${user._id} onboarded by agent ${req.user._id}`);
  }

  await user.save({ validateBeforeSave: false });
  console.log("✅ User updated", {
    id: user._id,
    fullName: user.fullName,
    number: user.number,
    image: user.image,
    updatedBy: isAdminOrAgent ? req.user.role : "user",
  });

  res.status(200).json({
    success: true,
    message: "User updated successfully",
    user,
  });
});

exports.updateDefaultGiftMode = asyncHandler(async (req, res, next) => {
  const { mode } = req.body;
  const normalizedMode = mode ? mode.toString().toLowerCase() : null;
  const allowedModes = ["gold", "stock"];

  if (!normalizedMode || !allowedModes.includes(normalizedMode)) {
    const err = new Error("Please choose a valid gift mode (gold or stock)");
    err.statusCode = 400;
    return next(err);
  }

  const user = await User.findById(req.user.id);

  if (!user) {
    const err = new Error("User not found");
    err.statusCode = 404;
    return next(err);
  }

  user.defaultGiftMode = normalizedMode;
  await user.save({ validateBeforeSave: false });

  res.status(200).json({
    success: true,
    message: "Default gift mode updated",
    user,
  });
});
// ========== SEARCH USERS BY PHONE NUMBERS ==========
exports.getFriends = asyncHandler(async (req, res, next) => {
  const { numbers } = req.body;

  if (!numbers || !Array.isArray(numbers) || numbers.length === 0) {
    const err = new Error("Phone numbers array is required");
    err.statusCode = 400;
    return next(err);
  }

  const normalizePhoneNumber = (rawNumber) => {
    if (rawNumber === null || rawNumber === undefined) return null;

    const str = String(rawNumber);
    const digits = str.replace(/\D/g, "");

    if (digits.length >= 10) {
      return digits.slice(-10);
    }
    return null;
  };

  const normalizedNumbers = numbers
    .map(normalizePhoneNumber)
    .filter((num) => num && num.length === 10); // Only valid 10-digit numbers

  if (normalizedNumbers.length === 0) {
    const err = new Error("No valid phone numbers provided");
    err.statusCode = 400;
    return next(err);
  }

  // Exclude the logged-in user's number if present
  // const currentUserNumber = normalizePhoneNumber(req.user?.number);
  const user = await User.findById(req.user.id);
  const currentUserNumber = user.number;
  const filteredNumbers = normalizedNumbers.filter(
    (num) => num !== currentUserNumber
  );

  // If after filtering nothing remains, return empty
  if (filteredNumbers.length === 0) {
    return res.status(200).json({
      success: true,
      count: 0,
      users: [],
    });
  }

  const users = await User.find({
    number: { $in: filteredNumbers },
    active: true,
  });

  res.status(200).json({
    success: true,
    count: users.length,
    users,
  });
});

// ========== GET USER BY _id OR PHONE NUMBER ==========
exports.getUserByIdOrNumber = asyncHandler(async (req, res, next) => {
  const { value } = req.body;

  if (!value) {
    const err = new Error("User ID or phone number is required");
    err.statusCode = 400;
    return next(err);
  }

  // Check if the requester is an onboarding agent
  const isOnboardingAgent =
    req.user && req.user.role && req.user.role === "onboarding_agent";

  const normalizePhoneNumber = (rawNumber) => {
    if (rawNumber === null || rawNumber === undefined) return null;
    const str = String(rawNumber);
    const digits = str.replace(/\D/g, "");
    if (digits.length >= 10) return digits.slice(-10);
    return null;
  };

  // Get current user's id/number from JWT (preferred) or fallback to DB if needed
  const currentUserId = req.user?.id || req.user?._id || null;
  let currentUserNumber = null;
  if (req.user && req.user.number) {
    currentUserNumber = normalizePhoneNumber(req.user.number);
  } else if (currentUserId) {
    const u = await User.findById(currentUserId).select("number");
    if (u && u.number) currentUserNumber = normalizePhoneNumber(u.number);
  }

  // Determine whether value looks like an ObjectId
  const isObjectId = /^[0-9a-fA-F]{24}$/.test(value);

  // Build query filter
  const queryFilter = { active: true };

  // If onboarding agent, only allow access to users they onboarded
  if (isOnboardingAgent && req.user && req.user._id) {
    queryFilter.onboardedBy = req.user._id;
  }

  let user = null;
  if (isObjectId) {
    // If user is searching for themselves by id, treat as not found
    if (currentUserId && String(currentUserId) === String(value)) {
      const err = new Error("User not found");
      err.statusCode = 404;
      return next(err);
    }

    queryFilter._id = value;
    user = await User.findOne(queryFilter);
  } else {
    // Normalize phone number and compare against current user's number
    const digits = normalizePhoneNumber(value);
    if (!digits) {
      const err = new Error("Invalid phone number");
      err.statusCode = 400;
      return next(err);
    }

    if (currentUserNumber && digits === currentUserNumber) {
      const err = new Error("User not found");
      err.statusCode = 404;
      return next(err);
    }

    queryFilter.number = digits;
    user = await User.findOne(queryFilter);
  }

  if (!user) {
    const err = new Error("User not found");
    err.statusCode = 404;
    return next(err);
  }

  res.status(200).json({
    success: true,
    user,
  });
});
// ========== GET SUGGESTIONS & RECENTS FROM GIFTS ==========
exports.getSuggestionsFromGifts = asyncHandler(async (req, res, next) => {
  if (!req.user || !req.user.id) {
    const err = new Error("Unauthorized");
    err.statusCode = 401;
    return next(err);
  }

  const userId = req.user.id;

  // Convert userId to ObjectId if it's a string
  const userIdObj =
    typeof userId === "string" ? new mongoose.Types.ObjectId(userId) : userId;

  // 1) Suggestions: users who SENT gifts to current user (receiverId === userId)
  // These are people who gifted you, so they should be suggested for gifting back
  const suggestionsAgg = Gift.aggregate([
    { $match: { receiverId: userIdObj, isSelfGift: false } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: "$senderId",
        lastGift: { $first: "$$ROOT" },
      },
    },
    { $limit: 10 },
  ]);

  // 2) Recents: users the current user SENT gifts to (senderId === userId)
  const recentsAgg = Gift.aggregate([
    { $match: { senderId: userIdObj, isSelfGift: false } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: "$receiverId",
        lastGift: { $first: "$$ROOT" },
      },
    },
    { $limit: 5 },
  ]);

  const [suggestionsRaw, recentsRaw] = await Promise.all([
    suggestionsAgg.exec(),
    recentsAgg.exec(),
  ]);

  // Debug logging
  console.log(`[getSuggestionsFromGifts] userId: ${userId}`);
  console.log(
    `[getSuggestionsFromGifts] Found ${suggestionsRaw.length} suggestions (gifts received)`
  );
  console.log(
    `[getSuggestionsFromGifts] Found ${recentsRaw.length} recents (gifts sent)`
  );

  // Extract user IDs and exclude current user
  const suggestionIds = suggestionsRaw
    .map((s) => s._id)
    .filter((id) => String(id) !== String(userId));

  const recentIds = recentsRaw
    .map((r) => r._id)
    .filter((id) => String(id) !== String(userId));

  // Fetch full user documents (no projection)
  const [suggestionUsers, recentUsers] = await Promise.all([
    suggestionIds.length > 0
      ? User.find({ _id: { $in: suggestionIds }, active: true })
      : Promise.resolve([]),
    recentIds.length > 0
      ? User.find({ _id: { $in: recentIds }, active: true })
      : Promise.resolve([]),
  ]);

  // Create a map of userId to lastGift info from aggregation results
  const suggestionGiftMap = new Map(
    suggestionsRaw.map((s) => [String(s._id), s.lastGift])
  );
  const recentGiftMap = new Map(
    recentsRaw.map((r) => [String(r._id), r.lastGift])
  );

  // Maintain order same as aggregation results (most recent first)
  // Include gift date information for suggestions
  const orderUsersWithGifts = (users, ids, giftMap) => {
    const userMap = new Map(users.map((u) => [String(u._id), u]));
    return ids
      .map((id) => {
        const user = userMap.get(String(id));
        if (!user) return null;
        const userObj = user.toObject();
        const giftInfo = giftMap.get(String(id));
        if (giftInfo && giftInfo.createdAt) {
          userObj.lastGift = {
            createdAt: giftInfo.createdAt,
          };
        }
        return userObj;
      })
      .filter(Boolean);
  };

  const suggestions = orderUsersWithGifts(
    suggestionUsers,
    suggestionIds,
    suggestionGiftMap
  );
  const recents = orderUsersWithGifts(recentUsers, recentIds, recentGiftMap);

  res.status(200).json({
    success: true,
    suggestions,
    recents,
  });
});

// ========== GENERATE USER QR (public S3) ==========
exports.generateUserQr = asyncHandler(async (req, res, next) => {
  try {
    const userId = req.user?.id || req.params.id;
    if (!userId) {
      const err = new Error("User id is required");
      err.statusCode = 400;
      return next(err);
    }

    const user = await User.findById(userId);
    if (!user) {
      const err = new Error("User not found");
      err.statusCode = 404;
      return next(err);
    }

    // Use HTTPS link for Universal Links / App Links support
    // Updated to /usergifting path as requested
    const url = `https://bahumati.in/usergifting?user=${user._id}`;
    const pngBuffer = await QRCode.toBuffer(url, { type: "png", width: 512 });

    const uploader = new Uploader();
    const keyName = `qr_${user._id}.png`;
    const publicUrl = await uploader.uploadPublicFile(
      keyName,
      pngBuffer,
      "image/png"
    );

    user.qrCodeUrl = publicUrl;
    await user.save({ validateBeforeSave: false });

    res.status(200).json({ success: true, url: publicUrl });
  } catch (e) {
    return next(e);
  }
});

// ========== UPDATE FCM TOKEN ==========
exports.updateFcmToken = asyncHandler(async (req, res, next) => {
  const { fcmToken } = req.body;
  const userId = req.user?.id;

  if (!userId) {
    const err = new Error("User not authenticated");
    err.statusCode = 401;
    return next(err);
  }

  if (!fcmToken) {
    const err = new Error("FCM token is required");
    err.statusCode = 400;
    return next(err);
  }

  const user = await User.findById(userId);
  if (!user) {
    const err = new Error("User not found");
    err.statusCode = 404;
    return next(err);
  }

  // Update FCM token
  user.fcmToken = fcmToken;
  await user.save({ validateBeforeSave: false });

  console.log(`✅ FCM token updated for user ${userId}`);

  res.status(200).json({
    success: true,
    message: "FCM token updated successfully",
  });
});

// ========== GET ALL USERS (Admin/Agent) ==========
exports.getAllUsers = asyncHandler(async (req, res, next) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const startIndex = (page - 1) * limit;

  // Check if the requester is an onboarding agent
  const isOnboardingAgent =
    req.user && req.user.role && req.user.role === "onboarding_agent";

  // Build query filter
  const queryFilter = {};

  // If onboarding agent, only show users they onboarded
  if (isOnboardingAgent && req.user && req.user._id) {
    queryFilter.onboardedBy = req.user._id;
    console.log(
      `🔍 Onboarding agent ${req.user._id} viewing their onboarded users`
    );
  }
  // Admins and reconciliation agents can see all users (no filter)

  const total = await User.countDocuments(queryFilter);

  const users = await User.find(queryFilter)
    .sort({ createdAt: -1 })
    .skip(startIndex)
    .limit(limit);

  res.status(200).json({
    success: true,
    count: users.length,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
    users,
  });
});
