const router = require("express").Router();
const giftController = require("../controllers/gift.controller");
const { isAuthorized } = require("../middlewares/auth");

// All routes require authentication
router.use(isAuthorized);

// Allocate money from user's unallotted money to gold or stock
router.route("/:giftId/allocate").post(giftController.allocateGift);

// Get user's allocation summary
router.route("/allocation-summary").get(giftController.getAllocationSummary);

// Accept a gift (mark as accepted)
router.route("/:giftId/accept").patch(giftController.acceptGift);

// Get all gifts received by the current user
router.route("/received").get(giftController.getReceivedGifts);

// Get all gifts sent by the current user
router.route("/sent").get(giftController.getSentGifts);

// Get a specific gift by ID
router.route("/:giftId").get(giftController.getGiftById);

module.exports = router;
