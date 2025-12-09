const jwt = require("jsonwebtoken");
const User = require("../models/user.model");
const Admin = require("../models/admin.model");
const asyncHandler = require("./asyncHandler");

exports.isAuthorized = asyncHandler(async (req, res, next) => {
  let token;

  if (req.cookies.token || req.headers.authorization?.startsWith("Bearer")) {
    token = req.cookies.token || req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    const err = new Error("Not authorized, token missing");
    err.statusCode = 401;
    return next(err);
  }

  const decoded = jwt.verify(token, process.env.JWT_SECRET);

  // Check user type and fetch from appropriate model
  if (decoded.type === "admin") {
    req.user = await Admin.findById(decoded.id);
  } else {
    req.user = await User.findById(decoded.id);
  }

  if (!req.user) {
    const err = new Error("User not found");
    err.statusCode = 401;
    return next(err);
  }

  // Check if admin/agent is disabled
  if (decoded.type === "admin" && req.user.status === "disabled") {
    const err = new Error(
      "Your account has been disabled. Please contact administrator."
    );
    err.statusCode = 403;
    return next(err);
  }

  next();
});

exports.roleAuthorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      const err = new Error("User role not found");
      err.statusCode = 403;
      return next(err);
    }

    if (!roles.includes(req.user.role)) {
      const err = new Error(
        `Role '${
          req.user.role
        }' is not authorized to access this resource. Required roles: ${roles.join(
          ", "
        )}`
      );
      err.statusCode = 403;
      return next(err);
    }
    next();
  };
};
