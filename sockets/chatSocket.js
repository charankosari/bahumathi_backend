// sockets/chatSocket.js
const Message = require("../models/Message");
const Gift = require("../models/Gift");
const Conversation = require("../models/Conversation");

function initChatSocket(io) {
  const onlineUsers = new Map(); // Tracks userId -> socketId

  io.on("connection", (socket) => {
    console.log("New user connected:", socket.id);

    // 1. Handle user going online
    socket.on("goOnline", (userId) => {
      socket.join(userId); // Join personal room for notifications
      onlineUsers.set(userId, socket.id);
      socket.broadcast.emit("userOnline", userId);
      console.log(`User ${userId} is online.`);
    });

    // 2. Handle sending messages (REVISED LOGIC)
    socket.on("sendMessage", async (data, callback) => {
      try {
        const { senderId, receiverId, type, content, mediaUrl, giftId } = data;

        // --- START: REVISED CONVERSATION LOGIC ---

        // Step 1: Try to find the conversation.
        let conversation = await Conversation.findOne({
          participants: { $all: [senderId, receiverId] },
        });

        // Step 2: If no conversation exists, create a new one.
        if (!conversation) {
          conversation = await Conversation.create({
            participants: [senderId, receiverId],
          });
        }

        // Step 3: Update the conversation with the latest message details.
        conversation.lastMessage = {
          text: type === "gift" ? "🎁 Gift" : content,
          sender: senderId,
        };
        conversation.lastMessageType = type;

        // Mongoose 6+ handles Map updates more easily.
        // Get the current count, default to 0, then increment.
        const currentUnread = conversation.unreadCounts.get(receiverId) || 0;
        conversation.unreadCounts.set(receiverId, currentUnread + 1);

        // Save the updated conversation
        await conversation.save();

        // --- END: REVISED CONVERSATION LOGIC ---

        const newMessage = await Message.create({
          conversationId: conversation._id,
          senderId,
          receiverId,
          type,
          content,
          mediaUrl,
          giftId,
        });

        // Emit to receiver's room
        io.to(receiverId).emit("receiveMessage", {
          message: newMessage,
          conversation,
        });

        // Acknowledge to the sender that the message was sent
        if (callback) callback({ success: true, message: newMessage });
      } catch (err) {
        console.error("Error sending message:", err.message);
        if (callback) callback({ success: false, error: err.message });
      }
    });

    // 3. Handle read receipts
    socket.on("markAsRead", async ({ userId, conversationId }) => {
      try {
        await Message.updateMany(
          { conversationId, receiverId: userId, isRead: false },
          { $set: { isRead: true } }
        );

        // Reset unread count for the user in that conversation
        const conversation = await Conversation.findById(conversationId);
        if (conversation) {
          conversation.unreadCounts.set(userId, 0);
          await conversation.save();
        }
      } catch (err) {
        console.error("Error marking as read:", err.message);
      }
    });

    // 4. Handle typing indicators
    socket.on("typing", ({ conversationId, receiverId }) => {
      io.to(receiverId).emit("userTyping", { conversationId });
    });

    socket.on("stopTyping", ({ conversationId, receiverId }) => {
      io.to(receiverId).emit("userStoppedTyping", { conversationId });
    });

    // Your allotGift logic
    socket.on("allotGift", async ({ giftId, userId, chosenType }) => {
      try {
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

    // Handle user disconnection
    socket.on("disconnect", () => {
      for (let [userId, sockId] of onlineUsers.entries()) {
        if (sockId === socket.id) {
          onlineUsers.delete(userId);
          socket.broadcast.emit("userOffline", userId);
          console.log(`User ${userId} went offline.`);
          break;
        }
      }
      console.log("User disconnected:", socket.id);
    });
  });
}

module.exports = { initChatSocket };
