const Kyc = require("../models/Kyc");
const { Uploader } = require("../libs/s3/s3");
const uploader = new Uploader();

exports.submitKyc = async (req, res, next) => {
  try {
    const { idType, frontPic, backPic, selfie, govtIdNumber } = req.body;
    const userId = req.user.id;

    if (!frontPic || !backPic || !selfie) {
      return res.status(400).json({
        success: false,
        message:
          "Please provide all required image keys: frontPic, backPic, and selfie.",
      });
    }

    if (!govtIdNumber || govtIdNumber.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Please provide your government ID number.",
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
      kyc.govtIdNumber = govtIdNumber.trim();
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
        govtIdNumber: govtIdNumber.trim(),
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

    res.status(200).json({
      success: true,
      message: `KYC ${status} successfully.`,
      data: kyc,
    });
  } catch (error) {
    next(error);
  }
};
