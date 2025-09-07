const router = require("express").Router();
const userController = require("../controllers/user.controller");
const { isAuthorized, roleAuthorize } = require("../middlewares/auth");

router.route("/signup").post(userController.signup);

router.route("/login").post(userController.login);

router.route("/verify-otp").post(userController.verifyOtp);

router.route("/google-auth").post(userController.googleAuth);

router.route("/me").get(isAuthorized, userController.getUserDetails);
router
  .route("/:id")
  .delete(isAuthorized, userController.deleteUser)
  .put(isAuthorized, userController.editUser);

module.exports = router;
