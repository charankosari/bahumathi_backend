const router = require("express").Router();
const {
  createAgent,
  getAgents,
  updateAgent,
  deleteAgent,
  login,
  changePassword,
  getUserTransactions,
} = require("../controllers/admin.controller");
const { isAuthorized, roleAuthorize } = require("../middlewares/auth");

router.route("/login").post(login);

// OTP verification route (before auth middleware - for admin/agent to verify user OTP)
const userController = require("../controllers/user.controller");
router
  .route("/verify-user-otp")
  .post(
    isAuthorized,
    roleAuthorize("admin", "onboarding_agent"),
    userController.verifyOtpForAdmin
  );

// All routes are protected
router.use(isAuthorized);

router.route("/change-password").put(changePassword);

// Get all users (paginated) - Accessible by admin, reconciliation, and onboarding agents
router
  .route("/users")
  .get(
    roleAuthorize("admin", "reconciliation_agent", "onboarding_agent"),
    userController.getAllUsers
  )
  // Create user without OTP - Admin only
  .post(roleAuthorize("admin"), userController.createUser);

router
  .route("/users/find")
  .post(
    roleAuthorize("admin", "reconciliation_agent", "onboarding_agent"),
    userController.getUserByIdOrNumber
  );

// Get user transactions and withdrawals - Accessible by admin, reconciliation, and onboarding agents
router
  .route("/users/:userId/transactions")
  .get(
    roleAuthorize("admin", "reconciliation_agent", "onboarding_agent"),
    getUserTransactions
  );

// Edit user details - Accessible by admin and onboarding agents
router
  .route("/users/:userId")
  .put(roleAuthorize("admin", "onboarding_agent"), userController.editUser);

// Routes requiring 'admin' role
router.use(roleAuthorize("admin"));

router.route("/agents").post(createAgent).get(getAgents);

router.route("/agents/:id").put(updateAgent);
// .delete(deleteAgent);

module.exports = router;
