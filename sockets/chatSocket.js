const { encrypt } = require("../utils/crypto.util");
const Message = require("../models/Message");
const Gift = require("../models/Gift");
const Conversation = require("../models/Conversation");

function initChatSocket(io) {
  const onlineUsers = new Map(); // Tracks userId -> socketId

  io.on("connection", (socket) => {
    // The 'socket.user' object is attached by the JWT middleware in server.js
    if (!socket.user || !socket.user.id) {
      console.error(
        "Connection rejected: No user authenticated for this socket."
      );
      return socket.disconnect();
    }

    console.log("New user connected:", socket.id, "| UserID:", socket.user.id);

    // 1. Handle user going online
    socket.on("goOnline", () => {
      const userId = socket.user.id;
      socket.join(userId); // Join this user to a room named after their ID
      onlineUsers.set(userId, socket.id);
      socket.broadcast.emit("userOnline", userId);
      console.log(`User ${userId} is online.`);
    });

    // 2. Handle sending messages (securely)
    socket.on("sendMessage", async (data, callback) => {
      try {
        // ✨ SENDER ID IS NOW TRUSTED, TAKEN FROM THE AUTHENTICATED SOCKET
        const senderId = socket.user.id;

        // The client only needs to send the receiver and content
        const { receiverId, type, content, mediaUrl, giftId } = data;

        // --- CONVERSATION LOGIC ---
        let conversation = await Conversation.findOne({
          participants: { $all: [senderId, receiverId] },
        });
        if (!conversation) {
          conversation = await Conversation.create({
            participants: [senderId, receiverId],
          });
        }

        conversation.lastMessage = {
          text: type === "gift" ? "🎁 Gift" : encrypt(content),
          sender: senderId,
        };
        conversation.lastMessageType = type;
        const currentUnread = conversation.unreadCounts.get(receiverId) || 0;
        conversation.unreadCounts.set(receiverId, currentUnread + 1);
        await conversation.save();

        // --- MESSAGE CREATION ---
        const newMessage = await Message.create({
          conversationId: conversation._id,
          senderId, // Using the trusted senderId
          receiverId,
          type,
          content: type === "text" ? encrypt(content) : content,
          mediaUrl,
          giftId,
        });

        // Create a temporary object with the original, unencrypted content for the live socket event
        const unencryptedMessageForSocket = {
          ...newMessage.toObject(),
          content: content,
        };

        io.to(receiverId).emit("receiveMessage", {
          message: unencryptedMessageForSocket,
          conversation,
        });

        if (callback)
          callback({ success: true, message: unencryptedMessageForSocket });
      } catch (err) {
        console.error("Error sending message:", err.message);
        if (callback) callback({ success: false, error: err.message });
      }
    });

    // 3. Handle read receipts (securely)
    socket.on("markAsRead", async ({ conversationId }) => {
      try {
        const userId = socket.user.id; // Use trusted user ID
        await Message.updateMany(
          { conversationId, receiverId: userId, isRead: false },
          { $set: { isRead: true } }
        );

        await Conversation.updateOne(
          { _id: conversationId },
          { $set: { [`unreadCounts.${userId}`]: 0 } }
        );
      } catch (err) {
        console.error("Error marking as read:", err.message);
      }
    });

    // 4. Handle typing indicators
    socket.on("typing", ({ receiverId }) => {
      io.to(receiverId).emit("userTyping", { senderId: socket.user.id });
    });

    socket.on("stopTyping", ({ receiverId }) => {
      io.to(receiverId).emit("userStoppedTyping", { senderId: socket.user.id });
    });

    // 5. Handle gift allotment (securely)
    socket.on("allotGift", async ({ giftId, chosenType }) => {
      try {
        const userId = socket.user.id; // Use trusted user ID
        const gift = await Gift.findOneAndUpdate(
          { _id: giftId, receiverId: userId, isAllotted: false },
          {
            isAllotted: true,
            allottedAt: new Date(),
            convertedTo: chosenType,
            hiddenFromSender: true,
          },
          { new: true }
        );

        if (!gift)
          return socket.emit("error", "Gift not found or already allotted.");

        socket.emit("giftAllotted", gift);
        io.to(gift.senderId).emit("giftAccepted", { giftId: gift._id });
      } catch (err) {
        console.error("Error allotting gift:", err.message);
      }
    });

    // 6. Handle user disconnection
    socket.on("disconnect", () => {
      const userId = socket.user.id;
      if (userId) {
        onlineUsers.delete(userId);
        socket.broadcast.emit("userOffline", userId);
        console.log(`User ${userId} went offline.`);
      }
      console.log("User disconnected:", socket.id);
    });
  });
}

module.exports = { initChatSocket };
