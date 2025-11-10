const router = require("express").Router();
const userController = require("../controllers/user.controller");
const conversationController = require("../controllers/conversation.controller");
const { isAuthorized, roleAuthorize } = require("../middlewares/auth");

router.route("/signup").post(userController.signup);

router.route("/login").post(userController.login);

router.route("/verify-otp").post(userController.verifyOtp);

router.route("/google-auth").post(userController.googleAuth);

router
  .route("/verify-mobile-google")
  .post(userController.verifyMobileForGoogleAuth);

router
  .route("/verify-mobile-otp-google")
  .post(userController.verifyMobileOtpForGoogleAuth);

router.route("/me").get(isAuthorized, userController.getUserDetails);
router.route("/me/get-friends").post(isAuthorized, userController.getFriends);
router
  .route("/me/find-friend")
  .post(isAuthorized, userController.getUserByIdOrNumber);
router
  .route("/me/recents")
  .post(isAuthorized, userController.getSuggestionsFromGifts);
router
  .route("/me/get-chats")
  .get(isAuthorized, conversationController.getConversations);
router
  .route("/me/get-current-chat/cid/:conversationId")
  .get(isAuthorized, conversationController.getMessagesForConversation);
router
  .route("/me/get-chat-with/pid/:peerId")
  .post(isAuthorized, conversationController.getMessagesByUserId);
router
  .route("/:id")
  .delete(isAuthorized, userController.deleteUser)
  .put(isAuthorized, userController.editUser);

router
  .route("/me/generate-qr")
  .post(isAuthorized, userController.generateUserQr);

router.route("/me/fcm-token").post(isAuthorized, userController.updateFcmToken);

module.exports = router;
