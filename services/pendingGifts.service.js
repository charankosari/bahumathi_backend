const mongoose = require("mongoose");
const UserWithNoAccount = require("../models/UserWithNoAccount");
const Gift = require("../models/Gift");
const Message = require("../models/Message");
const Conversation = require("../models/Conversation");
const User = require("../models/user.model");
const {
  sendGiftNotification,
  sendGiftWithMessageNotification,
  sendMessageNotification,
} = require("./fcm.service");
const { encrypt } = require("../utils/crypto.util");

/**
 * Process pending gifts and messages for a newly registered user
 * @param {string} userId - The newly registered user's ID
 * @param {string} phoneNumber - The user's phone number
 * @returns {Promise<Object>} - Summary of processed gifts and messages
 */
const processPendingGiftsForUser = async (userId, phoneNumber) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Normalize phone number
    const normalizePhoneNumber = (rawNumber) => {
      if (!rawNumber) return null;
      const str = String(rawNumber);
      const digits = str.replace(/\D/g, "");
      if (digits.length >= 10) {
        return digits.slice(-10);
      }
      return null;
    };

    const normalizedNumber = normalizePhoneNumber(phoneNumber);
    if (!normalizedNumber) {
      console.log(`⚠️ Invalid phone number format: ${phoneNumber}`);
      return { giftsProcessed: 0, messagesProcessed: 0 };
    }

    // Find pending gifts/messages for this phone number
    const userWithNoAccount = await UserWithNoAccount.findOne({
      phoneNumber: normalizedNumber,
    }).session(session);

    if (!userWithNoAccount || userWithNoAccount.gifts.length === 0) {
      console.log(
        `ℹ️ No pending gifts found for phone number: ${normalizedNumber}`
      );
      await session.commitTransaction();
      return { giftsProcessed: 0, messagesProcessed: 0 };
    }

    console.log(
      `📦 Processing ${userWithNoAccount.gifts.length} pending gift(s) for user ${userId}`
    );

    const processedGifts = [];
    const processedMessages = [];

    // Process each gift
    for (const giftEntry of userWithNoAccount.gifts) {
      try {
        const gift = await Gift.findById(giftEntry.giftId).session(session);
        if (!gift) {
          console.log(`⚠️ Gift ${giftEntry.giftId} not found, skipping`);
          continue;
        }

        const giftSenderId = giftEntry.senderId;

        // Find or create conversation
        let conversation = await Conversation.findOne({
          participants: { $all: [giftSenderId, userId] },
        }).session(session);

        if (!conversation) {
          [conversation] = await Conversation.create(
            [{ participants: [giftSenderId, userId] }],
            { session }
          );
          console.log(
            `✅ Created conversation ${conversation._id} for sender ${giftSenderId} and receiver ${userId}`
          );
        }

        // Update gift with receiverId and conversationId
        gift.receiverId = userId;
        gift.receiverNumber = null; // Clear phone number since user is now registered
        gift.conversationId = conversation._id;
        await gift.save({ session });

        // Check if there's a message associated with this gift
        let associatedMessage = null;

        if (gift.messageId) {
          associatedMessage = await Message.findById(gift.messageId).session(
            session
          );
        } else {
          // Check if there's a message in userWithNoAccount for this gift
          const messageEntry = userWithNoAccount.messages.find(
            (m) =>
              m.senderId.toString() === giftSenderId.toString() &&
              Math.abs(new Date(m.createdAt) - new Date(giftEntry.createdAt)) <
                5000 // Within 5 seconds
          );

          if (messageEntry && messageEntry.content) {
            // Create the message
            [associatedMessage] = await Message.create(
              [
                {
                  conversationId: conversation._id,
                  senderId: giftSenderId,
                  receiverId: userId,
                  type: messageEntry.type || "text",
                  content:
                    messageEntry.type === "text" && messageEntry.content
                      ? encrypt(messageEntry.content)
                      : messageEntry.content,
                  giftId: gift._id,
                },
              ],
              { session }
            );

            // Update gift with messageId
            gift.messageId = associatedMessage._id;
            await gift.save({ session });

            // Update conversation
            conversation.lastMessage = {
              text: "🎁 Gift with message",
              sender: giftSenderId,
            };
            conversation.lastMessageType = "giftWithMessage";
            const currentUnread = conversation.unreadCounts.get(userId) || 0;
            conversation.unreadCounts.set(userId, currentUnread + 1);
            await conversation.save({ session });
          }
        }

        processedGifts.push({
          gift,
          message: associatedMessage,
          senderId: giftSenderId,
        });

        console.log(
          `✅ Processed gift ${gift._id} for user ${userId} from sender ${giftSenderId}`
        );
      } catch (giftError) {
        console.error(
          `❌ Error processing gift ${giftEntry.giftId}:`,
          giftError.message
        );
        // Continue with next gift
      }
    }

    // Commit transaction
    await session.commitTransaction();

    // Send notifications for all processed gifts (outside transaction)
    const sender = await User.findById(userId).select(
      "fcmToken fullName image"
    );
    for (const { gift, message, senderId: giftSenderId } of processedGifts) {
      try {
        const giftSender = await User.findById(giftSenderId).select(
          "fullName image"
        );

        if (sender?.fcmToken) {
          if (message) {
            // Gift with message
            await sendGiftWithMessageNotification(
              sender.fcmToken,
              gift,
              message,
              giftSender,
              message.content ? "You have a new gift with message!" : null
            );
            console.log(
              `📱 Notification sent for gift with message ${gift._id}`
            );
          } else {
            // Gift only
            await sendGiftNotification(sender.fcmToken, gift, giftSender);
            console.log(`📱 Notification sent for gift ${gift._id}`);
          }
        }
      } catch (notifError) {
        console.error(
          `❌ Error sending notification for gift ${gift._id}:`,
          notifError.message
        );
      }
    }

    // Delete the UserWithNoAccount record after processing
    await UserWithNoAccount.findByIdAndDelete(userWithNoAccount._id);
    console.log(`🗑️ Deleted UserWithNoAccount record for ${normalizedNumber}`);

    return {
      giftsProcessed: processedGifts.length,
      messagesProcessed: processedMessages.length,
    };
  } catch (error) {
    await session.abortTransaction();
    console.error("❌ Error processing pending gifts:", error.message);
    throw error;
  } finally {
    await session.endSession();
  }
};

module.exports = { processPendingGiftsForUser };
