const User = require("../models/user.model");
const asyncHandler = require("../middlewares/asyncHandler");
const sendJwtToken = require("../utils/sendJwtToken");
const { OAuth2Client } = require("google-auth-library");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const sendOtp = require("../libs/sms/sms");

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const generateOtp = () => {
  return crypto.randomInt(1000, 9999).toString();
};

const hashOtp = async (otp) => {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(otp, salt);
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
  let user = await User.findOne({ email });

  if (!user) {
    // New user - create inactive account, needs mobile verification
    user = await User.create({
      fullName: name,
      email,
      image: picture,
      active: false,
    });

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
      },
    });
  } else if (user.active && user.number) {
    sendJwtToken(user, 200, "Google login successful", res);
  } else if (!user.active) {
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
  const { fullName, email, number } = req.body;

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

  const users = await User.find({
    number: { $in: normalizedNumbers },
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

  let user = null;

  const isObjectId = /^[0-9a-fA-F]{24}$/.test(value);

  if (isObjectId) {
    user = await User.findOne({ _id: value, active: true });
  } else {
    const str = String(value);
    const digits = str.replace(/\D/g, "").slice(-10);

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
