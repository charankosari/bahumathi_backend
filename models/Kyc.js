const mongoose = require("mongoose");

const kycSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true,
  },
  idType: {
    type: String,
    required: true,
    enum: ["aadhaar", "pan", "driving_license", "voter_id", "passport"],
  },
  frontPic: {
    type: String,
    required: true,
  },
  backPic: {
    type: String,
    required: true,
  },
  selfie: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending",
  },
  rejectionReason: {
    type: String,
    default: "",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

kycSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model("Kyc", kycSchema);
