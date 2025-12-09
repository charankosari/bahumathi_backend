const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const adminSchema = new mongoose.Schema({
  agentId: {
    type: String,
    unique: true,
    sparse: true,
    uppercase: true,
    validate: {
      validator: function (v) {
        return !v || v.length === 6;
      },
      message: "Agent ID must be exactly 6 characters",
    },
  },
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
  status: {
    type: String,
    enum: ["disabled", "enabled"],
    default: "enabled",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Generate unique 6-character alphanumeric agent ID
const generateAgentId = () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// Encrypt password before saving
adminSchema.pre("save", async function (next) {
  // Generate unique agentId if it doesn't exist (only for new documents)
  if (!this.agentId && this.isNew) {
    let uniqueId = false;
    let attempts = 0;
    const maxAttempts = 20;

    while (!uniqueId && attempts < maxAttempts) {
      const candidateId = generateAgentId();
      // Use this.constructor to reference the Admin model
      const existing = await this.constructor.findOne({ agentId: candidateId });
      if (!existing) {
        this.agentId = candidateId;
        uniqueId = true;
        console.log(`✅ Generated unique agentId: ${this.agentId}`);
      }
      attempts++;
    }

    if (!uniqueId) {
      return next(
        new Error("Failed to generate unique agent ID after multiple attempts")
      );
    }
  }

  // Hash password if modified
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
