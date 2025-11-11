const mongoose = require("mongoose"); // Required for transactions
const { encrypt } = require("../utils/crypto.util");
const Message = require("../models/Message");
const Gift = require("../models/Gift");
const Conversation = require("../models/Conversation");
const User = require("../models/user.model");
const {
  sendMessageNotification,
  sendGiftNotification,
  sendGiftWithMessageNotification,
} = require("../services/fcm.service");

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

    // 2. Handle sending gifts first (without message)
    // This handler can also use a transaction if gift creation involves multiple steps (e.g., updating user wallet)
    // For now, keeping it simple as it's only one 'create' operation.
    socket.on("sendGift", async (data, callback) => {
      // Note: If this logic becomes complex (e.g., debiting user wallet),
      // you should wrap this in a transaction as well.
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const senderId = socket.user.id;
        const { receiverId, giftData } = data;

        if (!giftData) {
          throw new Error("Gift data is required");
        }

        // --- CONVERSATION LOGIC ---
        let conversation = await Conversation.findOne({
          participants: { $all: [senderId, receiverId] },
        }).session(session);

        if (!conversation) {
          [conversation] = await Conversation.create(
            [{ participants: [senderId, receiverId] }],
            { session }
          );
        }

        // --- GIFT CREATION ---
        const [giftRecord] = await Gift.create(
          [
            {
              senderId,
              receiverId,
              type: giftData.type || "gold",
              name: giftData.name || "Gift",
              icon: giftData.icon || null,
              amount: giftData.amount || 0,
              pricePerUnitAtGift: giftData.pricePerUnitAtGift || 0,
              quantity: giftData.quantity || 0,
              valueInINR: giftData.valueInINR || 0,
              orderId: giftData.orderId || null,
              status: "pending",
              note: giftData.note || null,
              conversationId: conversation._id,
            },
          ],
          { session }
        );

        // --- Commit ---
        await session.commitTransaction();

        // Send push notification for gift (without message)
        // Always send push notification (even if user is online)
        // This ensures users get notified even if they're not on the chat screen
        try {
          const [receiver, sender] = await Promise.all([
            User.findById(receiverId).select("fcmToken"),
            User.findById(senderId).select("fullName image"),
          ]);

          if (receiver?.fcmToken) {
            await sendGiftNotification(receiver.fcmToken, giftRecord, sender);
            console.log(`📱 Push notification sent for gift to ${receiverId}`);
          }
        } catch (notifError) {
          console.error(
            "Error sending push notification for gift:",
            notifError.message
          );
          // Don't fail the gift creation if notification fails
        }

        // Return gift data to sender
        if (callback) {
          callback({
            success: true,
            gift: giftRecord,
            giftId: giftRecord._id,
          });
        }
      } catch (err) {
        // --- Abort ---
        await session.abortTransaction();
        console.error("Error creating gift:", err.message);
        if (callback) {
          callback({ success: false, error: err.message });
        }
      } finally {
        await session.endSession();
      }
    });

    // 3. Handle sending messages (with optional giftId or gift data)
    socket.on("sendMessage", async (data, callback) => {
      // Start a session for the transaction
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const senderId = socket.user.id;
        const { receiverId, type, content, mediaUrl, giftId, gift } = data;

        // --- CONVERSATION LOGIC ---
        let conversation = await Conversation.findOne({
          participants: { $all: [senderId, receiverId] },
        }).session(session); // Pass session

        if (!conversation) {
          // .create() in a session expects an array
          [conversation] = await Conversation.create(
            [{ participants: [senderId, receiverId] }],
            { session } // Pass session
          );
        }

        // --- HANDLE GIFT CREATION IF GIFT DATA PROVIDED (Single Call) ---
        let giftRecord = null;
        if (gift) {
          // Create new gift from provided data
          [giftRecord] = await Gift.create(
            [
              {
                senderId,
                receiverId,
                type: gift.type || "gold",
                name: gift.name || "Gift",
                icon: gift.icon || null,
                amount: gift.amount || 0,
                pricePerUnitAtGift: gift.pricePerUnitAtGift || 0,
                quantity: gift.quantity || 0,
                valueInINR: gift.valueInINR || 0,
                orderId: gift.orderId || null,
                status: "pending",
                note: gift.note || null,
                conversationId: conversation._id,
                isSelfGift: gift.isSelfGift || false,
              },
            ],
            { session } // Pass session
          );
        } else if (giftId) {
          // --- VALIDATE EXISTING GIFT (Two-Step Call) ---
          giftRecord = await Gift.findOne({
            _id: giftId,
            senderId: senderId, // Ensure sender owns this gift
            receiverId: receiverId,
          }).session(session); // Pass session

          if (!giftRecord) {
            // This error will be caught, and the transaction will be aborted
            throw new Error("Gift not found or access denied");
          }
        }

        // --- PREPARE CONVERSATION UPDATE ---
        conversation.lastMessage = {
          text:
            giftRecord || giftId ? "🎁 Gift with message" : encrypt(content),
          sender: senderId,
        };
        conversation.lastMessageType =
          giftRecord || giftId ? "giftWithMessage" : type;
        const currentUnread = conversation.unreadCounts.get(receiverId) || 0;
        conversation.unreadCounts.set(receiverId, currentUnread + 1);

        await conversation.save({ session }); // Pass session

        // --- MESSAGE CREATION ---
        const [newMessage] = await Message.create(
          [
            {
              conversationId: conversation._id,
              senderId,
              receiverId,
              type: giftRecord || giftId ? "giftWithMessage" : type,
              content: type === "text" && content ? encrypt(content) : content,
              mediaUrl,
              giftId: giftRecord ? giftRecord._id : giftId || undefined,
            },
          ],
          { session } // Pass session
        );

        // --- UPDATE GIFT WITH MESSAGE ID ---
        if (giftRecord) {
          // We use the same giftRecord variable, findByIdAndUpdate returns the new doc
          giftRecord = await Gift.findByIdAndUpdate(
            giftRecord._id,
            { $set: { messageId: newMessage._id } },
            { new: true, session } // Pass session
          );
        }

        // *** COMMIT THE TRANSACTION ***
        await session.commitTransaction();

        // --- EMIT SOCKET EVENTS (Only if transaction was successful) ---

        const unencryptedMessageForSocket = {
          ...newMessage.toObject(),
          content: content, // Send unencrypted content back to clients
          gift: giftRecord ? giftRecord.toObject() : undefined,
        };

        if (giftRecord) {
          // Combined gift+message events
          io.to(receiverId).emit("receiveGiftWithMessage", {
            message: unencryptedMessageForSocket,
            gift: giftRecord,
            conversation,
          });
          socket.emit("giftWithMessageSent", {
            message: unencryptedMessageForSocket,
            gift: giftRecord,
            conversation,
          });

          // Send push notification for gift with message
          // Always send push notification (even if user is online)
          // This ensures users get notified even if they're not on the chat screen
          try {
            const [receiver, sender] = await Promise.all([
              User.findById(receiverId).select("fcmToken"),
              User.findById(senderId).select("fullName image"),
            ]);

            if (receiver?.fcmToken) {
              // Pass unencrypted content for notification
              await sendGiftWithMessageNotification(
                receiver.fcmToken,
                giftRecord,
                newMessage,
                sender,
                content // Pass unencrypted content
              );
              console.log(
                `📱 Push notification sent for gift with message to ${receiverId}`
              );
            }
          } catch (notifError) {
            console.error(
              "Error sending push notification for gift with message:",
              notifError.message
            );
            // Don't fail the message send if notification fails
          }
        } else {
          // Regular message events
          io.to(receiverId).emit("receiveMessage", {
            message: unencryptedMessageForSocket,
            conversation,
          });
          socket.emit("receiveMessage", {
            message: unencryptedMessageForSocket,
            conversation,
          });

          // Send push notification for regular message
          // Always send push notification (even if user is online)
          // This ensures users get notified even if they're not on the chat screen
          try {
            const [receiver, sender] = await Promise.all([
              User.findById(receiverId).select("fcmToken"),
              User.findById(senderId).select("fullName image"),
            ]);

            if (receiver?.fcmToken) {
              // Pass unencrypted content for notification
              await sendMessageNotification(
                receiver.fcmToken,
                newMessage,
                sender,
                content // Pass unencrypted content
              );
              console.log(
                `📱 Push notification sent for message to ${receiverId}`
              );
            }
          } catch (notifError) {
            console.error(
              "Error sending push notification for message:",
              notifError.message
            );
            // Don't fail the message send if notification fails
          }
        }

        if (callback)
          callback({ success: true, message: unencryptedMessageForSocket });
      } catch (err) {
        // *** ABORT THE TRANSACTION ***
        await session.abortTransaction();

        console.error(
          "Error sending message (transaction aborted):",
          err.message
        );
        if (callback) callback({ success: false, error: err.message });
      } finally {
        // *** END THE SESSION ***
        await session.endSession();
      }
    });

    // 4. Handle read receipts (securely)
    socket.on("markAsRead", async ({ conversationId }) => {
      try {
        const userId = socket.user.id; // Use trusted user ID

        // These can be run in parallel
        await Promise.all([
          Message.updateMany(
            { conversationId, receiverId: userId, isRead: false },
            { $set: { isRead: true } }
          ),
          Conversation.updateOne(
            { _id: conversationId },
            { $set: { [`unreadCounts.${userId}`]: 0 } }
          ),
        ]);
      } catch (err) {
        console.error("Error marking as read:", err.message);
      }
    });

    // 5. Handle typing indicators
    socket.on("typing", ({ receiverId }) => {
      io.to(receiverId).emit("userTyping", { senderId: socket.user.id });
    });

    socket.on("stopTyping", ({ receiverId }) => {
      io.to(receiverId).emit("userStoppedTyping", { senderId: socket.user.id });
    });

    // 6. Handle gift allotment (securely)
    // This should also use a transaction if it involves complex multi-step logic
    // (e.g., updating user's portfolio, creating a log)
    socket.on("allotGift", async ({ giftId, chosenType }) => {
      // For complex allotment, start a session here
      try {
        const userId = socket.user.id; // Use trusted user ID
        const gift = await Gift.findOneAndUpdate(
          { _id: giftId, receiverId: userId, isAllotted: false },
          {
            isAllotted: true,
            allottedAt: new Date(),
            convertedTo: chosenType,
            hiddenFromSender: true,
            status: "allotted", // Update status
          },
          { new: true }
        );

        if (!gift)
          return socket.emit("error", "Gift not found or already allotted.");

        // If allotment was successful:
        socket.emit("giftAllotted", gift);
        // Let the sender know their gift was accepted
        io.to(gift.senderId).emit("giftAccepted", {
          giftId: gift._id,
          conversationId: gift.conversationId,
        });
      } catch (err) {
        console.error("Error allotting gift:", err.message);
        socket.emit("error", "Failed to allot gift.");
      }
    });

    // 7. Handle user disconnection
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
