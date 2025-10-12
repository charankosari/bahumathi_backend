const { createOrder } = require("../libs/razorpay");
const Gift = require("../models/Gift");
const Message = require("../models/Message");
const { io } = require("../server");

/**
 * Create a gift order → returns payment link + Razorpay order_id
 */
exports.createGift = async (req, res) => {
  try {
    const { senderId, receiverId, type, amount, conversationId } = req.body;

    if (!senderId || !receiverId || !amount || !type || !conversationId)
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });

    // Create order in Razorpay
    const order = await createOrder({
      order_id: `gift_${Date.now()}`,
      amount,
      notes: {
        payment_for: "gift",
        sender_id: senderId,
        receiver_id: receiverId,
        gift_type: type,
        conversation_id: conversationId,
      },
    });

    // Save gift record (pending)
    const gift = await Gift.create({
      senderId,
      receiverId,
      type,
      amount,
      orderId: order.id,
      status: "pending",
      conversationId,
    });

    return res.json({
      success: true,
      message: "Gift order created successfully",
      orderId: order.id,
      amount: order.amount / 100,
      currency: order.currency,
      gift,
    });
  } catch (err) {
    console.error("Gift create error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};
