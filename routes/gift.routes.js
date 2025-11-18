const router = require("express").Router();
const giftController = require("../controllers/gift.controller");
const { isAuthorized } = require("../middlewares/auth");

// All routes require authentication
router.use(isAuthorized);

// Allocate/Convert a gift to gold or top 50 stocks
router.route("/:giftId/allocate").post(giftController.allocateGift);

// Accept a gift (mark as accepted)
router.route("/:giftId/accept").patch(giftController.acceptGift);

// Get all gifts received by the current user
router.route("/received").get(giftController.getReceivedGifts);

// Get all gifts sent by the current user
router.route("/sent").get(giftController.getSentGifts);

// Get a specific gift by ID
router.route("/:giftId").get(giftController.getGiftById);

module.exports = router;
