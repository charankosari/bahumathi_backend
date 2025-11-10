const { io } = require("../../server");
const Gift = require("../../models/Gift");
const Message = require("../../models/Message");
const Conversation = require("../../models/Conversation");
const User = require("../../models/user.model");
const { validateSignature } = require("./razorpay");
const { sendGiftNotification } = require("../../services/fcm.service");

const captureHook = async (req, res) => {
  try {
    const signature = req.headers["x-razorpay-signature"];
    const rawPayload = JSON.stringify(req.body);

    // ✅ Validate Razorpay webhook signature
    const is_valid = validateSignature({
      webhook_signature: signature,
      webhook_secret: process.env.RAZORPAY_HOOK_SECRET,
      payload: rawPayload,
    });

    if (!is_valid) {
      console.warn("❌ Invalid Razorpay webhook signature");
      return res.status(400).json({ message: "Invalid webhook signature" });
    }

    const event = req.body.event;
    const paymentEntity = req.body.payload?.payment?.entity;

    if (!paymentEntity) {
      return res.status(400).json({ message: "Invalid webhook payload" });
    }

    // Extract notes passed during order creation
    const { receiver_id, sender_id, conversation_id, gift_id } =
      paymentEntity.notes || {};

    console.log("🎯 Razorpay Webhook Received:", {
      event,
      paymentId: paymentEntity.id,
      receiver_id,
      sender_id,
      gift_id,
    });

    // ✅ Only process successful payments
    if (event !== "payment.captured") {
      return res.status(200).json({ message: "Ignored non-captured event" });
    }

    // ✅ Find the gift
    const gift = await Gift.findById(gift_id);
    if (!gift) {
      return res.status(404).json({ message: "Gift not found" });
    }

    // ✅ Update payment status
    gift.isPaid = true;
    gift.paymentId = paymentEntity.id;
    gift.paymentStatus = "captured";
    await gift.save();

    // ✅ Ensure conversation exists
    let conversation = await Conversation.findById(conversation_id);
    if (!conversation) {
      conversation = await Conversation.create({
        participants: [sender_id, receiver_id],
        lastMessage: null,
        lastMessageType: null,
        unreadCounts: new Map(),
      });
    }

    // ✅ Create message for this gift
    const messageData = {
      conversation_id,
      sender_id,
      receiver_id,
      type: "gift",
      content:
        gift.type === "gold"
          ? `💰 Sent ${gift.units} units of Gold`
          : `📈 Sent ${gift.units} units of ${gift.stock_name}`,
      metadata: {
        giftType: gift.type, // gold | stock
        units: gift.units,
        stockName: gift.stock_name || null,
        amount: gift.amount,
        rate: gift.rate || null,
      },
    };

    const newMessage = await Message.create(messageData);

    // ✅ Update conversation last message
    conversation.lastMessage = {
      text: messageData.content,
      sender: sender_id,
    };
    conversation.lastMessageType = "gift";

    // Update unread count for receiver
    const currentUnread = conversation.unreadCounts?.get(receiver_id) || 0;
    conversation.unreadCounts?.set(receiver_id, currentUnread + 1);
    await conversation.save();

    // ✅ Emit message to receiver via socket
    io.to(receiver_id).emit("receiveMessage", {
      message: newMessage,
      conversation,
    });

    // ✅ Send push notification for gift payment
    // Check if receiver is online - if not, send push notification
    const onlineUsers = io.sockets.adapter.rooms.get(receiver_id);
    const isReceiverOnline = onlineUsers && onlineUsers.size > 0;

    if (!isReceiverOnline) {
      try {
        const [receiver, sender] = await Promise.all([
          User.findById(receiver_id).select("fcmToken"),
          User.findById(sender_id).select("fullName image"),
        ]);

        if (receiver?.fcmToken) {
          await sendGiftNotification(receiver.fcmToken, gift, sender);
          console.log(
            `📱 Push notification sent for gift payment to ${receiver_id}`
          );
        }
      } catch (notifError) {
        console.error(
          "Error sending push notification for gift payment:",
          notifError.message
        );
        // Don't fail the webhook if notification fails
      }
    }

    console.log("✅ Gift processed successfully:", gift_id);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("⚠️ Webhook error:", error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = { captureHook };
