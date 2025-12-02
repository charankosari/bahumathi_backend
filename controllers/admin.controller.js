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

  if (!username || !password || !role ) {
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

// Get all agents
exports.getAgents = asyncHandler(async (req, res, next) => {
  const agents = await Admin.find({
    role: { $in: ["onboarding_agent", "reconciliation_agent"] },
  });

  res.status(200).json({
    success: true,
    count: agents.length,
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
exports.deleteAgent = asyncHandler(async (req, res, next) => {
  const agent = await Admin.findById(req.params.id);

  if (!agent) {
    return res.status(404).json({
      success: false,
      message: "Agent not found",
    });
  }

  await agent.deleteOne();

  res.status(200).json({
    success: true,
    message: "Agent deleted successfully",
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
