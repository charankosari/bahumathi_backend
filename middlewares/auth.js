const jwt = require("jsonwebtoken");
const User = require("../models/user.model"); // Assuming your user model is in ../models/User
const errorHandler = require("../utils/errorHandler");
const asyncHandler = require("./asyncHandler"); // Assuming your asyncHandler is in the same directory

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
  req.user = decoded;

  next();
});

exports.roleAuthorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(
        new errorHandler(
          `Role '${req.user.role}' is not authorized to access this resource`,
          403
        )
      );
    }
    next();
  };
};
