const router = require("express").Router();
const withdrawalController = require("../controllers/withdrawal.controller");
const { isAuthorized, roleAuthorize } = require("../middlewares/auth");

// All routes require authentication
router.use(isAuthorized);

// Create withdrawal request
router.route("/").post(withdrawalController.createWithdrawalRequest);

// Get withdrawal requests for current user
router.route("/").get(withdrawalController.getMyWithdrawalRequests);

// Get all withdrawal requests (admin and reconciliation only)
router
  .route("/all")
  .get(
    roleAuthorize("admin", "reconciliation"),
    withdrawalController.getAllWithdrawalRequests
  );

// Get withdrawal requests for an event (admin and reconciliation only)
router
  .route("/event/:eventId")
  .get(
    roleAuthorize("admin", "reconciliation"),
    withdrawalController.getEventWithdrawalRequests
  );

// Approve withdrawal request (admin and reconciliation only)
router
  .route("/:requestId/approve")
  .patch(
    roleAuthorize("admin", "reconciliation"),
    withdrawalController.approveWithdrawalRequest
  );

// Reject withdrawal request (admin and reconciliation only)
router
  .route("/:requestId/reject")
  .patch(
    roleAuthorize("admin", "reconciliation"),
    withdrawalController.rejectWithdrawalRequest
  );

module.exports = router;
