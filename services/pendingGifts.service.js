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

    if (!userWithNoAccount) {
      console.log(
        `ℹ️ No UserWithNoAccount found for phone number: ${normalizedNumber}`
      );
      await session.commitTransaction();
      return { giftsProcessed: 0, messagesProcessed: 0 };
    }

    const userWithNoAccountId = userWithNoAccount._id;
    console.log(
      `📦 Found UserWithNoAccount ${userWithNoAccountId} for phone ${normalizedNumber}, migrating to user ${userId}`
    );

    // Step 1: Update all gifts with UserWithNoAccount._id to use real user._id
    const giftsToUpdate = await Gift.updateMany(
      { receiverId: userWithNoAccountId },
      { $set: { receiverId: userId, receiverNumber: null } },
      { session }
    );
    console.log(
      `✅ Updated ${giftsToUpdate.modifiedCount} gift(s) with new receiverId`
    );

    // Step 2: Update all messages with UserWithNoAccount._id to use real user._id
    const messagesToUpdate = await Message.updateMany(
      { receiverId: userWithNoAccountId },
      { $set: { receiverId: userId, receiverNumber: null } },
      { session }
    );
    console.log(
      `✅ Updated ${messagesToUpdate.modifiedCount} message(s) with new receiverId`
    );

    // Step 3: Update all conversations - replace UserWithNoAccount._id with real user._id in participants
    const conversationsToUpdate = await Conversation.find({
      participants: userWithNoAccountId,
    }).session(session);

    for (const conversation of conversationsToUpdate) {
      // Replace UserWithNoAccount._id with real user._id in participants
      const participantIndex = conversation.participants.findIndex(
        (p) => p.toString() === userWithNoAccountId.toString()
      );
      if (participantIndex !== -1) {
        conversation.participants[participantIndex] = userId;

        // Update unreadCounts - move from UserWithNoAccount._id to real user._id
        const unreadCount =
          conversation.unreadCounts.get(userWithNoAccountId.toString()) || 0;
        if (unreadCount > 0) {
          conversation.unreadCounts.set(userId.toString(), unreadCount);
          conversation.unreadCounts.delete(userWithNoAccountId.toString());
        }

        await conversation.save({ session });
        console.log(
          `✅ Updated conversation ${conversation._id} - replaced UserWithNoAccount._id with user._id`
        );
      }
    }

    // Step 4: Process gifts and messages for notifications
    // Use the gifts/messages from userWithNoAccount to know which ones to process
    const processedGifts = [];
    const processedMessages = [];

    // Process each gift from UserWithNoAccount
    for (const giftEntry of userWithNoAccount.gifts) {
      try {
        const gift = await Gift.findById(giftEntry.giftId).session(session);
        if (!gift) {
          console.log(`⚠️ Gift ${giftEntry.giftId} not found, skipping`);
          continue;
        }

        // Gift should already have receiverId = userId from Step 1
        const giftSenderId = giftEntry.senderId;

        // Find or create conversation (should already exist from Step 3, but check anyway)
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

        // Update gift with conversationId if not already set
        if (!gift.conversationId) {
          gift.conversationId = conversation._id;
          await gift.save({ session });
        }

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
              m.messageId?.toString() === gift._id.toString()
          );

          if (messageEntry && messageEntry.content) {
            // Message might already exist, check first
            if (messageEntry.messageId) {
              associatedMessage = await Message.findById(
                messageEntry.messageId
              ).session(session);
            }

            if (!associatedMessage && messageEntry.content) {
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
            }

            // Update conversation
            if (associatedMessage) {
              conversation.lastMessage = {
                text: "🎁 Gift with message",
                sender: giftSenderId,
              };
              conversation.lastMessageType = "giftWithMessage";
              const currentUnread =
                conversation.unreadCounts.get(userId.toString()) || 0;
              conversation.unreadCounts.set(
                userId.toString(),
                currentUnread + 1
              );
              await conversation.save({ session });
            }
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
          `❌ Error processing gift ${gift._id}:`,
          giftError.message
        );
        // Continue with next gift
      }
    }

    // Process messages from UserWithNoAccount that aren't associated with gifts
    for (const messageEntry of userWithNoAccount.messages) {
      try {
        // Skip if message is already associated with a gift (processed above)
        if (
          processedGifts.some(
            (pg) =>
              pg.message?._id?.toString() === messageEntry.messageId?.toString()
          )
        ) {
          continue;
        }

        let message = null;
        if (messageEntry.messageId) {
          message = await Message.findById(messageEntry.messageId).session(
            session
          );
        }

        const messageSenderId = messageEntry.senderId;

        // Find or create conversation
        let conversation = await Conversation.findOne({
          participants: { $all: [messageSenderId, userId] },
        }).session(session);

        if (!conversation) {
          [conversation] = await Conversation.create(
            [{ participants: [messageSenderId, userId] }],
            { session }
          );
        }

        // Create message if it doesn't exist
        if (!message && messageEntry.content) {
          [message] = await Message.create(
            [
              {
                conversationId: conversation._id,
                senderId: messageSenderId,
                receiverId: userId,
                type: messageEntry.type || "text",
                content:
                  messageEntry.type === "text" && messageEntry.content
                    ? encrypt(messageEntry.content)
                    : messageEntry.content,
              },
            ],
            { session }
          );
        } else if (message && !message.conversationId) {
          // Update message with conversationId if not already set
          message.conversationId = conversation._id;
          await message.save({ session });
        }

        if (message) {
          processedMessages.push({
            message,
            senderId: messageSenderId,
          });

          console.log(
            `✅ Processed message ${message._id} for user ${userId} from sender ${messageSenderId}`
          );
        }
      } catch (messageError) {
        console.error(`❌ Error processing message:`, messageError.message);
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
    await UserWithNoAccount.findByIdAndDelete(userWithNoAccountId).session(
      session
    );
    console.log(
      `🗑️ Deleted UserWithNoAccount record ${userWithNoAccountId} for ${normalizedNumber}`
    );

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
