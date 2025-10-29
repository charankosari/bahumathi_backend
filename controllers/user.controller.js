const User = require("../models/user.model");
const asyncHandler = require("../middlewares/asyncHandler");
const sendJwtToken = require("../utils/sendJwtToken");
const { OAuth2Client } = require("google-auth-library");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const sendOtp = require("../libs/sms/sms");
const Gift = require("../models/Gift");
const QRCode = require("qrcode");
const { Uploader } = require("../libs/s3/s3");

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const generateOtp = () => {
  return crypto.randomInt(1000, 9999).toString();
};

const hashOtp = async (otp) => {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(otp, salt);
};

// Ensure QR exists for a user (custom scheme id-based URL) and upload to S3 once
const ensureUserQr = async (user) => {
  if (!user || user.qrCodeUrl) return user;
  const url = `bahumati://user?id=${user._id}`;
  const pngBuffer = await QRCode.toBuffer(url, { type: "png", width: 512 });
  const uploader = new Uploader();
  const keyName = `qr_${user._id}.png`;
  const publicUrl = await uploader.uploadPublicFile(keyName, pngBuffer);
  user.qrCodeUrl = publicUrl;
  await user.save({ validateBeforeSave: false });
  return user;
};

// ========== SIGNUP (Number based) ==========
exports.signup = asyncHandler(async (req, res, next) => {
  const { fullName, number } = req.body;

  if (!fullName) {
    const err = new Error("Full name is required");
    err.statusCode = 400;
    return next(err);
  }
  if (!number) {
    const err = new Error("Phone number is required");
    err.statusCode = 400;
    return next(err);
  }

  // Check if user already exists
  let user = await User.findOne({ number });

  const otp = generateOtp();
  const hashedOtp = await hashOtp(otp);
  const otpExpires = Date.now() + 10 * 60 * 1000;

  if (user) {
    if (user.active) {
      // Active user → block signup
      const err = new Error(
        "User with this number already exists. Please login."
      );
      err.statusCode = 400;
      return next(err);
    } else {
      // Inactive user → only update OTP + expiry
      user.otp = hashedOtp;
      user.otpExpires = otpExpires;
      await user.save({ validateBeforeSave: false });
    }
  } else {
    // No user → create inactive user
    user = await User.create({
      fullName,
      number,
      otp: hashedOtp,
      otpExpires,
      active: false,
    });
  }
  // Generate QR once (if not already present)
  try {
    await ensureUserQr(user);
  } catch (e) {
    console.error("QR generation failed (signup):", e.message);
  }
  // After saving the user (or updating OTP):
  try {
    await sendOtp(number, otp); // sends SMS
  } catch (smsError) {
    console.error("Failed to send OTP:", smsError.message);
    // Optional: you can still respond successfully, or return error
  }

  // Example: await sendOtpSms(number, otp);
  console.log(`OTP for ${number}: ${otp}`);
  res.status(200).json({
    success: true,
    message: "OTP has been sent. Please verify to continue.",
  });
});

// ========== LOGIN (Number based) ==========
exports.login = asyncHandler(async (req, res, next) => {
  const { number } = req.body;

  if (!number) {
    const err = new Error("Phone number is required");
    err.statusCode = 400;
    return next(err);
  }

  const user = await User.findOne({ number, active: true });

  if (!user) {
    const err = new Error("User not found. Please sign up.");
    err.statusCode = 404;
    return next(err);
  }

  const otp = generateOtp();
  user.otp = await hashOtp(otp);
  user.otpExpires = Date.now() + 10 * 60 * 1000;
  await user.save({ validateBeforeSave: false });
  // After saving the user (or updating OTP):
  try {
    await sendOtp(number, otp); // sends SMS
  } catch (smsError) {
    console.error("Failed to send OTP:", smsError.message);
    // Optional: you can still respond successfully, or return error
  }

  res.status(200).json({
    success: true,
    message: "OTP sent successfully. Please verify to log in.",
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

  if (!number) {
    const err = new Error("Phone number is required");
    err.statusCode = 400;
    return next(err);
  }

  const user = await User.findOne({
    number,
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

  sendJwtToken(user, 200, "Login successful", res);
});

// ========== GOOGLE SIGNUP / LOGIN ==========
exports.googleAuth = asyncHandler(async (req, res, next) => {
  const { token } = req.body;

  if (!token) {
    const err = new Error("Google token is required");
    err.statusCode = 400;
    return next(err);
  }

  let ticket;
  try {
    ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
  } catch (error) {
    const err = new Error("Invalid Google token");
    err.statusCode = 400;
    return next(err);
  }

  const payload = ticket.getPayload();
  const { email, name, picture } = payload;
  // Optional fields - available only with proper Google scopes
  const gender = (
    payload.gender ||
    payload.sexe ||
    payload.given_gender ||
    payload.genderIdentity ||
    ""
  )
    .toString()
    .toLowerCase();
  const birthDate = payload.birthdate || payload.birthday || payload.birthDate;
  let user = await User.findOne({ email });

  if (!user) {
    // New user - create inactive account, needs mobile verification
    const createPayload = {
      fullName: name,
      email,
      image: picture,
      active: false,
    };
    if (gender) createPayload.gender = gender;
    if (birthDate) createPayload.birthDate = new Date(birthDate);
    user = await User.create(createPayload);
    // Generate QR for new Google user
    try {
      await ensureUserQr(user);
    } catch (e) {
      console.error("QR gen failed (googleAuth create):", e.message);
    }

    // Don't send JWT token yet - user needs mobile verification
    res.status(200).json({
      success: true,
      login: false,
      message:
        "Google authentication successful. Please verify your mobile number to complete registration.",
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        active: user.active,
        gender: user.gender,
        birthDate: user.birthDate,
      },
    });
  } else if (user.active && user.number) {
    sendJwtToken(user, 200, "Google login successful", res);
  } else if (!user.active) {
    // If user exists but inactive, optionally backfill gender/dob if not set
    let changed = false;
    if (!user.gender && gender) {
      user.gender = gender;
      changed = true;
    }
    if (!user.birthDate && birthDate) {
      user.birthDate = new Date(birthDate);
      changed = true;
    }
    if (changed) await user.save({ validateBeforeSave: false });
    res.status(200).json({
      success: true,
      login: false,
      message:
        "Google authentication successful. Please verify your mobile number to complete registration.",
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        active: user.active,
        gender: user.gender,
        birthDate: user.birthDate,
      },
    });
  }
});

// ========== MOBILE VERIFICATION FOR GOOGLE AUTH ==========
exports.verifyMobileForGoogleAuth = asyncHandler(async (req, res, next) => {
  const { email, number } = req.body;

  if (!email) {
    const err = new Error("Email is required");
    err.statusCode = 400;
    return next(err);
  }

  if (!number) {
    const err = new Error("Phone number is required");
    err.statusCode = 400;
    return next(err);
  }

  // Check if user exists with this email
  let user = await User.findOne({ email });

  if (!user) {
    const err = new Error(
      "User not found. Please complete Google authentication first."
    );
    err.statusCode = 404;
    return next(err);
  }

  // Check if mobile number already exists with another user
  const existingUserWithNumber = await User.findOne({
    number,
    _id: { $ne: user._id },
  });

  if (existingUserWithNumber) {
    const err = new Error(
      "This mobile number is already registered with another account. Please use a different number."
    );
    err.statusCode = 400;
    return next(err);
  }

  // Generate OTP for mobile verification
  const otp = generateOtp();
  const hashedOtp = await hashOtp(otp);
  const otpExpires = Date.now() + 10 * 60 * 1000;

  // Update user with mobile number and OTP
  user.number = number;
  user.otp = hashedOtp;
  user.otpExpires = otpExpires;
  await user.save({ validateBeforeSave: false });

  // Send OTP via SMS
  try {
    await sendOtp(number, otp);
  } catch (smsError) {
    console.error("Failed to send OTP:", smsError.message);
  }

  console.log(`OTP for ${number}: ${otp}`);

  res.status(200).json({
    success: true,
    message:
      "OTP has been sent to your mobile number. Please verify to complete registration.",
  });
});

// ========== VERIFY MOBILE OTP FOR GOOGLE AUTH ==========
exports.verifyMobileOtpForGoogleAuth = asyncHandler(async (req, res, next) => {
  const { email, number, otp } = req.body;

  if (!email) {
    const err = new Error("Email is required");
    err.statusCode = 400;
    return next(err);
  }

  if (!number) {
    const err = new Error("Phone number is required");
    err.statusCode = 400;
    return next(err);
  }

  if (!otp) {
    const err = new Error("OTP is required");
    err.statusCode = 400;
    return next(err);
  }

  // Find user with email and number
  const user = await User.findOne({
    email,
    number,
    otpExpires: { $gt: Date.now() },
  }).select("+otp");

  if (!user) {
    const err = new Error("Invalid credentials or OTP has expired");
    err.statusCode = 400;
    return next(err);
  }

  const isMatch = await user.compareOtp(otp);

  if (!isMatch) {
    const err = new Error("Invalid OTP");
    err.statusCode = 400;
    return next(err);
  }

  // Activate user and clear OTP
  user.active = true;
  user.otp = undefined;
  user.otpExpires = undefined;
  await user.save({ validateBeforeSave: false });

  sendJwtToken(
    user,
    200,
    "Mobile verification successful. Registration completed.",
    res
  );
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
  const { id } = req.params;
  const { fullName, email, number, gender, birthDate } = req.body;

  const user = await User.findById(id);

  if (!user) {
    const err = new Error("User not found");
    err.statusCode = 404;
    return next(err);
  }

  // Update fullName
  if (fullName) user.fullName = fullName;

  // Add email if it doesn’t exist
  if (email && !user.email) {
    const existingEmailUser = await User.findOne({ email });
    if (existingEmailUser) {
      const err = new Error("Email already in use by another user");
      err.statusCode = 400;
      return next(err);
    }
    user.email = email;
  }

  // Add number if it doesn’t exist
  if (number && !user.number) {
    const existingNumberUser = await User.findOne({ number });
    if (existingNumberUser) {
      const err = new Error("Phone number already in use by another user");
      err.statusCode = 400;
      return next(err);
    }
    user.number = number;
  }

  // Optional updates
  if (gender) user.gender = gender.toLowerCase();
  if (birthDate) {
    const parsed = new Date(birthDate);
    if (!isNaN(parsed.getTime())) {
      user.birthDate = parsed;
    }
  }

  await user.save({ validateBeforeSave: false });

  res.status(200).json({
    success: true,
    message: "User updated successfully",
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

  let user = null;
  if (isObjectId) {
    // If user is searching for themselves by id, treat as not found
    if (currentUserId && String(currentUserId) === String(value)) {
      const err = new Error("User not found");
      err.statusCode = 404;
      return next(err);
    }

    user = await User.findOne({ _id: value, active: true });
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

    user = await User.findOne({ number: digits, active: true });
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

  // 1) Suggestions: users who SENT gifts to current user (receiverId === userId)
  const suggestionsAgg = Gift.aggregate([
    { $match: { receiverId: userId, isSelfGift: false } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: "$senderId",
        lastGift: { $first: "$$ROOT" },
      },
    },
    { $limit: 5 },
  ]);

  // 2) Recents: users the current user SENT gifts to (senderId === userId)
  const recentsAgg = Gift.aggregate([
    { $match: { senderId: userId, isSelfGift: false } },
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

  // Maintain order same as aggregation results (most recent first)
  const orderUsers = (users, ids) => {
    const map = new Map(users.map((u) => [String(u._id), u]));
    return ids.map((id) => map.get(String(id))).filter(Boolean);
  };

  const suggestions = orderUsers(suggestionUsers, suggestionIds);
  const recents = orderUsers(recentUsers, recentIds);

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

    const url = `bahumati://user?id=${user._id}`;
    const pngBuffer = await QRCode.toBuffer(url, { type: "png", width: 512 });

    const uploader = new Uploader();
    const keyName = `qr_${user._id}.png`;
    const publicUrl = await uploader.uploadPublicFile(keyName, pngBuffer);

    user.qrCodeUrl = publicUrl;
    await user.save({ validateBeforeSave: false });

    res.status(200).json({ success: true, url: publicUrl });
  } catch (e) {
    return next(e);
  }
});
