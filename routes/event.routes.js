const router = require("express").Router();
const eventController = require("../controllers/event.controller");
const { isAuthorized, roleAuthorize } = require("../middlewares/auth");

// Public route - get event by link (no auth required for sharing)
router.route("/link/:eventLink").get(eventController.getEventByLink);

// All other routes require authentication
router.use(isAuthorized);

// Create event
router.route("/").post(eventController.createEvent);

// Get all events created by current user
router.route("/").get(eventController.getMyEvents);

// Get event by ID
router.route("/:eventId").get(eventController.getEventById);
    
// Update event
router.route("/:eventId").patch(eventController.updateEvent);

// Delete event
router.route("/:eventId").delete(eventController.deleteEvent);

module.exports = router;
