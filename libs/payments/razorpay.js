const Razorpay = require("razorpay");
const crypto = require("crypto");

const razorpayInstance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const createOrder = async ({ order_id, amount, notes = {} }) => {
  const order = await razorpayInstance.orders.create({
    amount: Math.round(amount * 100),
    currency: "INR",
    receipt: "ORDER #" + Date.now(),

    notes: {
      ...notes,
    },
  });
  return order;
};

const capturePayment = async ({ payment_id, amount }) => {
  const payment = await razorpayInstance.payments.capture(
    payment_id,
    Math.round(amount * 100),
    "INR"
  );
  return payment;
};

const orderStatus = async ({ order_id }) => {
  const order = await razorpayInstance.orders.fetch(order_id);
  return order;
};

const validateSignature = ({ webhook_signature, webhook_secret, payload }) => {
  const hmac = crypto.createHmac("sha256", webhook_secret);
  hmac.update(payload);
  const generated_signature = hmac.digest("hex");
  return webhook_signature === generated_signature;
};
const refundPayment = async ({ payment_id, amount }) => {
  const refundData = amount
    ? { amount: Math.round(amount * 100) } // partial refund
    : {}; // full refund

  const refund = await razorpayInstance.payments.refund(payment_id, refundData);
  return refund;
};

module.exports = {
  createOrder,
  razorpayInstance,
  capturePayment,
  orderStatus,
  validateSignature,
  refundPayment,
};
