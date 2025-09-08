// libs/sms/sms.js
const axios = require("axios");

const sendOtp = async (phone, otp) => {
  try {
    const API = process.env.SMS_API_KEY;
    const URL = `https://sms.renflair.in/V1.php?API=${API}&PHONE=${phone}&OTP=${otp}`;

    const response = await axios.get(URL);
    return response.data; // JSON response from SMS API
  } catch (error) {
    console.error("Error sending OTP:", error.message);
    throw new Error("Failed to send OTP");
  }
};

module.exports = sendOtp;
