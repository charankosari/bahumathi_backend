const router = require("express").Router();
const giftController = require("../controllers/gift.controller");
const { isAuthorized } = require("../middlewares/auth");

// All routes require authentication
router.use(isAuthorized);

// Allocate money from user's unallotted money (pool) or bulk allocation
router.route("/allocate").post(giftController.allocateGift);

// Allocate money from a specific gift
router.route("/:giftId/allocate").post(giftController.allocateGift);

// Get user's allocation summary
router.route("/allocation-summary").get(giftController.getAllocationSummary);

// Get user's portfolio summary (for home screen)
router.route("/portfolio-summary").get(giftController.getPortfolioSummary);

// Accept a gift (mark as accepted)
router.route("/:giftId/accept").patch(giftController.acceptGift);

// Get all gifts received by the current user
router.route("/received").get(giftController.getReceivedGifts);

// Get all gifts sent by the current user
router.route("/sent").get(giftController.getSentGifts);

// Get a specific gift by ID
router.route("/:giftId").get(giftController.getGiftById);

module.exports = router;
