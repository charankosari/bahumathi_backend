const { encrypt } = require("../utils/crypto.util"); // ✨ IMPORT a
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

    // 2. Handle sending messages with encryption
    socket.on("sendMessage", async (data, callback) => {
      try {
        const { senderId, receiverId, type, content, mediaUrl, giftId } = data;

        // --- CONVERSATION LOGIC ---
        let conversation = await Conversation.findOne({
          participants: { $all: [senderId, receiverId] },
        });

        if (!conversation) {
          conversation = await Conversation.create({
            participants: [senderId, receiverId],
          });
        }

        // Encrypt the 'lastMessage' text before saving it to the conversation
        conversation.lastMessage = {
          text: type === "gift" ? "🎁 Gift" : encrypt(content),
          sender: senderId,
        };
        conversation.lastMessageType = type;

        const currentUnread = conversation.unreadCounts.get(receiverId) || 0;
        conversation.unreadCounts.set(receiverId, currentUnread + 1);
        await conversation.save();
        // --- END CONVERSATION LOGIC ---

        // Create the new message, encrypting the content for database storage
        const newMessage = await Message.create({
          conversationId: conversation._id,
          senderId,
          receiverId,
          type,
          content: type === "text" ? encrypt(content) : content, // Encrypt here
          mediaUrl,
          giftId,
        });

        // IMPORTANT: For the real-time event, we create a temporary object
        // with the ORIGINAL, UNENCRYPTED content for the best user experience.
        const unencryptedMessageForSocket = {
          ...newMessage.toObject(),
          content: content, // Use original content for the live message
        };

        // Emit the unencrypted message to the receiver's room
        io.to(receiverId).emit("receiveMessage", {
          message: unencryptedMessageForSocket,
          conversation,
        });

        // Acknowledge to the sender with the unencrypted message
        if (callback)
          callback({ success: true, message: unencryptedMessageForSocket });
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

        await Conversation.updateOne(
          { _id: conversationId },
          { $set: { [`unreadCounts.${userId}`]: 0 } }
        );
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

    // Your allotGift logic (remains unchanged)
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
