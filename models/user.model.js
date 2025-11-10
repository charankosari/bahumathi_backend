const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const userSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: [true, "Please provide your full name"],
    trim: true,
  },
  gender: {
    type: String,
    enum: ["male", "female", "other"],
    lowercase: true,
  },
  birthDate: {
    type: Date,
  },
  email: {
    type: String,
    unique: true,
    sparse: true, // Allows multiple null values, but unique if a value is present
    match: [
      /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
      "Please add a valid email",
    ],
  },

  image: {
    type: String,
    sparse: true,
  },
  qrCodeUrl: {
    type: String,
    sparse: true,
  },
  number: {
    type: String,
    unique: true,
    sparse: true,
  },
  otp: {
    type: String,
    select: false,
  },
  otpExpires: {
    type: Date,
    select: false,
  },
  role: {
    type: String,
    enum: ["user", "admin"],
    default: "user",
  },
  active: {
    type: Boolean,
    default: false,
  },
  fcmToken: {
    type: String,
    sparse: true, // Allows multiple null values, but unique if a value is present
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Instance method to generate JWT
userSchema.methods.getJwtToken = function () {
  return jwt.sign(
    { id: this._id, role: this.role }, // include role here
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || "7d" }
  );
};

// Instance method to compare entered OTP with the hashed OTP in the database
userSchema.methods.compareOtp = async function (enteredOtp) {
  // Check if there is an OTP hash to compare against
  if (!this.otp) return false;
  return await bcrypt.compare(enteredOtp, this.otp);
};

module.exports = mongoose.model("User", userSchema);
