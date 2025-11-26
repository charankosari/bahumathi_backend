const router = require("express").Router();
const withdrawalController = require("../controllers/withdrawal.controller");
const { isAuthorized, roleAuthorize } = require("../middlewares/auth");

// All routes require authentication
router.use(isAuthorized);

// Create withdrawal request
router.route("/").post(withdrawalController.createWithdrawalRequest);

// Get withdrawal requests for current user
router.route("/").get(withdrawalController.getMyWithdrawalRequests);

// Get all withdrawal requests (superAdmin and reconciliation only)
router
  .route("/all")
  .get(
    roleAuthorize("superAdmin", "reconciliation"),
    withdrawalController.getAllWithdrawalRequests
  );

// Get withdrawal requests for an event (superAdmin and reconciliation only)
router
  .route("/event/:eventId")
  .get(
    roleAuthorize("superAdmin", "reconciliation"),
    withdrawalController.getEventWithdrawalRequests
  );

// Approve withdrawal request (superAdmin and reconciliation only)
router
  .route("/:requestId/approve")
  .patch(
    roleAuthorize("superAdmin", "reconciliation"),
    withdrawalController.approveWithdrawalRequest
  );

// Reject withdrawal request (superAdmin and reconciliation only)
router
  .route("/:requestId/reject")
  .patch(
    roleAuthorize("superAdmin", "reconciliation"),
    withdrawalController.rejectWithdrawalRequest
  );

module.exports = router;
