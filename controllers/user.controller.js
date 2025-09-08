const User = require("../models/user.model");
const asyncHandler = require("../middlewares/asyncHandler");
const sendJwtToken = require("../utils/sendJwtToken");
const { OAuth2Client } = require("google-auth-library");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

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

  // Example: await sendOtpSms(number, otp);
  console.log(`OTP for ${number}: ${otp}`);
  res.status(200).json({
    success: true,
    message: "OTP has been sent. Please verify to continue.",
    otpForTesting: otp,
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
  console.log(`OTP for ${number}: ${otp}`);
  res.status(200).json({
    success: true,
    message: "OTP sent successfully. Please verify to log in.",
    otpForTesting: otp,
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
  const { email, name } = payload;

  let user = await User.findOne({ email });

  if (!user) {
    user = await User.create({
      fullName: name,
      email,
      active: true,
    });
  } else if (!user.active) {
    user.active = true;
    await user.save({ validateBeforeSave: false });
  }

  sendJwtToken(user, 200, "Google login successful", res);
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
