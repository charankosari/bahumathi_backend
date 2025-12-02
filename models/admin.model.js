const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const adminSchema = new mongoose.Schema({

  username: {
    type: String,
    unique: true,
    sparse: true, // Unique if present (for Agents)
    trim: true,
  },
  password: {
    type: String,
    required: [true, "Please enter password"],
    select: false,
  },
  role: {
    type: String,
    enum: ["admin", "onboarding_agent", "reconciliation_agent"],
    default: "onboarding_agent",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Encrypt password before saving
// Encrypt password before saving
adminSchema.pre("save", async function (next) {
  console.log("🔒 Pre-save hook triggered");
  if (!this.isModified("password")) {
    console.log("🔒 Password not modified");
    return next();
  }
  console.log("🔒 Hashing password...");
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  console.log("🔒 Password hashed");
  next();
});

// Compare user password
adminSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Return JWT token
adminSchema.methods.getJwtToken = function () {
  return jwt.sign(
    { id: this._id, role: this.role, type: "admin" }, // Added 'type' to distinguish from users
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRE || "7d",
    }
  );
};

module.exports = mongoose.model("Admin", adminSchema);
