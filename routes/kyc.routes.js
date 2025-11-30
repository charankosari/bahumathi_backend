const express = require("express");
const router = express.Router();
const kycController = require("../controllers/kyc.controller");
const { isAuthorized } = require("../middlewares/auth"); // Assuming auth middleware exists
const multer = require("multer");

router.route("/submit").post(
  isAuthorized,
  kycController.submitKyc
);

router.route("/status").get(isAuthorized, kycController.getKycStatus);

// Onboarding Agent Routes
const { roleAuthorize } = require("../middlewares/auth");

router
  .route("/all")
  .get(isAuthorized, roleAuthorize("onboarding_agent", "admin"), kycController.getAllKycs);

router
  .route("/review")
  .put(isAuthorized, roleAuthorize("onboarding_agent", "admin"), kycController.reviewKyc);

module.exports = router;
