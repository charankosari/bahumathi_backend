const Kyc = require("../models/Kyc");
const User = require("../models/user.model");
const { Uploader } = require("../libs/s3/s3");
const {
  sendKycApprovalNotification,
  sendKycRejectionNotification,
} = require("../services/fcm.service");
const uploader = new Uploader();

exports.submitKyc = async (req, res, next) => {
  try {
    const { idType, frontPic, backPic, selfie } = req.body;
    const userId = req.user.id;

    if (!frontPic || !backPic || !selfie) {
      return res.status(400).json({
        success: false,
        message:
          "Please provide all required image keys: frontPic, backPic, and selfie.",
      });
    }

    // Check if KYC already exists
    let kyc = await Kyc.findOne({ user: userId });
    if (kyc && (kyc.status === "pending" || kyc.status === "approved")) {
      return res.status(400).json({
        success: false,
        message: `KYC is already ${kyc.status}.`,
      });
    }

    if (kyc) {
      // Update existing rejected KYC
      kyc.idType = idType;
      kyc.frontPic = frontPic;
      kyc.backPic = backPic;
      kyc.selfie = selfie;
      kyc.status = "pending";
      kyc.rejectionReason = "";
      await kyc.save();
    } else {
      // Create new KYC
      kyc = await Kyc.create({
        user: userId,
        idType,
        frontPic,
        backPic,
        selfie,
      });
    }

    res.status(201).json({
      success: true,
      message: "KYC submitted successfully.",
      data: kyc,
    });
  } catch (error) {
    next(error);
  }
};

exports.getKycStatus = async (req, res, next) => {
  try {
    const kyc = await Kyc.findOne({ user: req.user.id });

    if (!kyc) {
      return res.status(200).json({
        success: true,
        data: { status: "not_submitted" },
      });
    }

    res.status(200).json({
      success: true,
      data: kyc,
    });
  } catch (error) {
    next(error);
  }
};

exports.getAllKycs = async (req, res, next) => {
  try {
    const { status } = req.query;
    const query = status ? { status } : {};

    const kycs = await Kyc.find(query).populate("user", "fullName number");

    res.status(200).json({
      success: true,
      count: kycs.length,
      data: kycs,
    });
  } catch (error) {
    next(error);
  }
};

exports.reviewKyc = async (req, res, next) => {
  try {
    const { kycId, status, rejectionReason } = req.body;

    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be either 'approved' or 'rejected'.",
      });
    }

    if (status === "rejected" && !rejectionReason) {
      return res.status(400).json({
        success: false,
        message: "Rejection reason is required when rejecting KYC.",
      });
    }

    const kyc = await Kyc.findById(kycId);

    if (!kyc) {
      return res.status(404).json({
        success: false,
        message: "KYC record not found.",
      });
    }

    kyc.status = status;
    if (status === "rejected") {
      kyc.rejectionReason = rejectionReason;
    } else {
      kyc.rejectionReason = "";
    }

    await kyc.save();

    // Send notification to user about KYC status change (outside transaction)
    try {
      const user = await User.findById(kyc.user).select("fcmToken");

      if (user && user.fcmToken) {
        if (status === "approved") {
          await sendKycApprovalNotification(user.fcmToken, kyc, user);
          console.log(`✅ KYC approval notification sent to user ${user._id}`);
        } else if (status === "rejected") {
          await sendKycRejectionNotification(
            user.fcmToken,
            kyc,
            rejectionReason
          );
          console.log(`✅ KYC rejection notification sent to user ${user._id}`);
        }
      } else {
        console.log(
          `⚠️ Cannot send notification: user or FCM token not found for user ${kyc.user}`
        );
      }
    } catch (notificationError) {
      // Don't fail the request if notification fails
      console.error(
        `❌ Error sending KYC ${status} notification:`,
        notificationError.message
      );
    }

    res.status(200).json({
      success: true,
      message: `KYC ${status} successfully.`,
      data: kyc,
    });
  } catch (error) {
    next(error);
  }
};
