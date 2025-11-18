const mongoose = require("mongoose"); // Required for transactions
const { encrypt } = require("../utils/crypto.util");
const Message = require("../models/Message");
const Gift = require("../models/Gift");
const Conversation = require("../models/Conversation");
const User = require("../models/user.model");
const UserWithNoAccount = require("../models/UserWithNoAccount");
const {
  sendMessageNotification,
  sendGiftNotification,
  sendGiftWithMessageNotification,
} = require("../services/fcm.service");
const { allocateGift } = require("../services/giftAllocation.service");

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

      // Declare variables outside try block for error handling
      let senderId;
      let receiverId;
      let receiverNumber;
      let giftData;
      try {
        senderId = socket.user.id;
        ({ receiverId, receiverNumber, giftData } = data);

        console.log("🎁 [sendGift] Received data:", {
          senderId,
          receiverId,
          receiverNumber,
          hasGiftData: !!giftData,
        });

        if (!giftData) {
          throw new Error("Gift data is required");
        }

        if (!receiverId && !receiverNumber) {
          throw new Error("Either receiverId or receiverNumber is required");
        }

        // Normalize phone number if provided
        const normalizePhoneNumber = (rawNumber) => {
          if (!rawNumber) return null;
          const str = String(rawNumber);
          const digits = str.replace(/\D/g, "");
          if (digits.length >= 10) {
            return digits.slice(-10);
          }
          return null;
        };

        let actualReceiverId = null;
        let actualReceiverNumber = receiverNumber
          ? normalizePhoneNumber(receiverNumber)
          : null;

        console.log(
          `📞 [sendGift] Initial receiverNumber normalized: ${actualReceiverNumber}`
        );

        // Validate receiverId - it must be a valid ObjectId if provided
        if (receiverId) {
          const isValidObjectId = mongoose.Types.ObjectId.isValid(receiverId);
          console.log(
            `🔍 [sendGift] receiverId validation: "${receiverId}" (type: ${typeof receiverId}) is valid ObjectId: ${isValidObjectId}`
          );
          if (isValidObjectId) {
            actualReceiverId = new mongoose.Types.ObjectId(receiverId);
            console.log(
              `✅ [sendGift] Converted receiverId to ObjectId: ${actualReceiverId}`
            );
          } else {
            // If receiverId is not a valid ObjectId, treat it as a phone number
            console.warn(
              `⚠️ [sendGift] receiverId "${receiverId}" is not a valid ObjectId, treating as phone number`
            );
            actualReceiverNumber = normalizePhoneNumber(receiverId);
            console.log(
              `📞 [sendGift] Normalized phone number from receiverId: ${actualReceiverNumber}`
            );
          }
        }

        // If receiverNumber is provided, try to find user by phone number
        // If not found, create/find UserWithNoAccount and use its _id as receiverId
        if (!actualReceiverId && actualReceiverNumber) {
          console.log(
            `🔍 [sendGift] Searching for user with phone number: ${actualReceiverNumber}`
          );
          const userByNumber = await User.findOne({
            number: actualReceiverNumber,
            active: true,
          }).session(session);
          if (userByNumber) {
            actualReceiverId = userByNumber._id;
            console.log(
              `✅ [sendGift] Found registered user: ${actualReceiverId}`
            );
          } else {
            // No registered user found - create or find UserWithNoAccount
            console.log(
              `ℹ️ [sendGift] No registered user found for phone number: ${actualReceiverNumber}, creating/finding UserWithNoAccount`
            );
            let userWithNoAccount = await UserWithNoAccount.findOne({
              phoneNumber: actualReceiverNumber,
            }).session(session);
            if (!userWithNoAccount) {
              [userWithNoAccount] = await UserWithNoAccount.create(
                [
                  {
                    phoneNumber: actualReceiverNumber,
                    gifts: [],
                    messages: [],
                  },
                ],
                { session }
              );
              console.log(
                `✅ [sendGift] Created UserWithNoAccount: ${userWithNoAccount._id} for phone ${actualReceiverNumber}`
              );
            } else {
              console.log(
                `✅ [sendGift] Found existing UserWithNoAccount: ${userWithNoAccount._id} for phone ${actualReceiverNumber}`
              );
            }
            // Use UserWithNoAccount._id as receiverId - ensure it's an ObjectId
            actualReceiverId =
              userWithNoAccount._id instanceof mongoose.Types.ObjectId
                ? userWithNoAccount._id
                : new mongoose.Types.ObjectId(userWithNoAccount._id);
            console.log(
              `📋 [sendGift] Using UserWithNoAccount._id as receiverId: ${actualReceiverId} (type: ${actualReceiverId.constructor.name})`
            );
          }
        }

        let conversation = null;
        // Create conversation even if receiver doesn't exist (for phone number)
        // Ensure senderId is a valid ObjectId
        console.log(
          `🔍 [sendGift] Validating senderId: "${senderId}" (type: ${typeof senderId})`
        );
        if (!mongoose.Types.ObjectId.isValid(senderId)) {
          console.error(
            `❌ [sendGift] Invalid senderId: "${senderId}" is not a valid ObjectId`
          );
          throw new Error(
            `Invalid senderId: "${senderId}" is not a valid ObjectId`
          );
        }
        const senderObjectId = new mongoose.Types.ObjectId(senderId);
        console.log(
          `✅ [sendGift] senderObjectId: ${senderObjectId} (type: ${senderObjectId.constructor.name})`
        );
        console.log(
          `📊 [sendGift] Final values - actualReceiverId: ${
            actualReceiverId ? actualReceiverId.toString() : null
          }, actualReceiverNumber: ${actualReceiverNumber}`
        );

        if (actualReceiverId) {
          // Ensure receiverId is also a valid ObjectId
          console.log(
            `🔍 [sendGift] Processing with actualReceiverId: ${actualReceiverId} (type: ${actualReceiverId.constructor.name})`
          );

          // Double-check that actualReceiverId is actually an ObjectId
          if (!mongoose.Types.ObjectId.isValid(actualReceiverId)) {
            console.error(
              `❌ [sendGift] actualReceiverId "${actualReceiverId}" is not a valid ObjectId! This should not happen.`
            );
            throw new Error(
              `Invalid actualReceiverId: "${actualReceiverId}" is not a valid ObjectId`
            );
          }

          const receiverObjectId = new mongoose.Types.ObjectId(
            actualReceiverId
          );

          console.log(
            `📋 [sendGift] Creating conversation with participants: [${senderObjectId}, ${receiverObjectId}]`
          );
          console.log(
            `🔍 [sendGift] Participants types: sender=${senderObjectId.constructor.name}, receiver=${receiverObjectId.constructor.name}`
          );
          conversation = await Conversation.findOne({
            participants: { $all: [senderObjectId, receiverObjectId] },
          }).session(session);

          if (!conversation) {
            console.log(
              `🆕 [sendGift] Creating new conversation with participants array: [${senderObjectId}, ${receiverObjectId}]`
            );
            [conversation] = await Conversation.create(
              [{ participants: [senderObjectId, receiverObjectId] }],
              { session }
            );
            console.log(
              `✅ [sendGift] Conversation created successfully: ${conversation._id}`
            );
          } else {
            console.log(
              `📂 [sendGift] Found existing conversation: ${conversation._id}`
            );
          }
        } else {
          console.error(
            `❌ [sendGift] actualReceiverId is not set! This should not happen.`
          );
          throw new Error("Receiver ID is required");
        }

        // --- GIFT CREATION ---
        // actualReceiverId is always set now (either User._id or UserWithNoAccount._id)
        const [giftRecord] = await Gift.create(
          [
            {
              senderId,
              receiverId: actualReceiverId, // Always an ObjectId now
              receiverNumber: actualReceiverNumber || null, // Keep for reference
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
              conversationId: conversation?._id || null,
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
          const sender = await User.findById(senderId).select("fullName image");
          let receiver = null;

          if (actualReceiverId) {
            receiver = await User.findById(actualReceiverId).select(
              "fcmToken fullName image"
            );
          } else if (actualReceiverNumber) {
            // Try to find user by phone number (even if inactive, they might have FCM token)
            receiver = await User.findOne({
              number: actualReceiverNumber,
            }).select("fcmToken fullName image");
          }

          // Check if actualReceiverId is a User (registered) or UserWithNoAccount (non-registered)
          const isUserWithNoAccount = await UserWithNoAccount.findById(
            actualReceiverId
          );

          if (isUserWithNoAccount) {
            // Receiver is a UserWithNoAccount (non-registered user)
            // Update UserWithNoAccount to track gift
            try {
              isUserWithNoAccount.gifts.push({
                giftId: giftRecord._id,
                senderId: senderId,
                createdAt: new Date(),
              });
              await isUserWithNoAccount.save();
              console.log(
                `✅ Gift saved to UserWithNoAccount ${actualReceiverId} for phone ${isUserWithNoAccount.phoneNumber}`
              );
            } catch (saveError) {
              console.error(
                "Error saving gift to UserWithNoAccount:",
                saveError.message
              );
            }
            // No FCM notification for non-registered users (no FCM token)
            console.log(
              `ℹ️ Gift created for non-registered user (phone: ${isUserWithNoAccount.phoneNumber}), no FCM notification sent`
            );
          } else {
            // Receiver is a registered User - try to send FCM notification
            if (receiver?.fcmToken) {
              await sendGiftNotification(receiver.fcmToken, giftRecord, sender);
              console.log(
                `📱 Push notification sent for gift to ${actualReceiverId}`
              );
            } else {
              console.log(
                `ℹ️ No FCM token found for registered user ${actualReceiverId}`
              );
            }
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
        console.error("❌ [sendGift] Error creating gift:", err.message);
        console.error("❌ [sendGift] Error stack:", err.stack);
        console.error("❌ [sendGift] Error details:", {
          name: err.name,
          message: err.message,
          senderId,
          receiverId,
          receiverNumber,
          actualReceiverId: actualReceiverId
            ? actualReceiverId.toString()
            : null,
          actualReceiverNumber,
          senderObjectId: senderObjectId ? senderObjectId.toString() : null,
        });
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

      // Declare variables outside try block for error handling
      let senderId;
      let receiverId;
      let receiverNumber;
      try {
        senderId = socket.user.id;
        ({ receiverId, receiverNumber, type, content, mediaUrl, giftId, gift } =
          data);

        console.log("💬 [sendMessage] Received data:", {
          senderId,
          receiverId,
          receiverNumber,
          type,
          hasContent: !!content,
          hasMediaUrl: !!mediaUrl,
          hasGiftId: !!giftId,
          hasGift: !!gift,
        });

        if (!receiverId && !receiverNumber) {
          throw new Error("Either receiverId or receiverNumber is required");
        }

        // Normalize phone number if provided
        const normalizePhoneNumber = (rawNumber) => {
          if (!rawNumber) return null;
          const str = String(rawNumber);
          const digits = str.replace(/\D/g, "");
          if (digits.length >= 10) {
            return digits.slice(-10);
          }
          return null;
        };

        let actualReceiverId = null;
        let actualReceiverNumber = receiverNumber
          ? normalizePhoneNumber(receiverNumber)
          : null;

        // Validate receiverId - it must be a valid ObjectId if provided
        if (receiverId) {
          if (mongoose.Types.ObjectId.isValid(receiverId)) {
            actualReceiverId = new mongoose.Types.ObjectId(receiverId);
          } else {
            // If receiverId is not a valid ObjectId, treat it as a phone number
            console.warn(
              `⚠️ receiverId "${receiverId}" is not a valid ObjectId, treating as phone number`
            );
            actualReceiverNumber = normalizePhoneNumber(receiverId);
          }
        }

        // If receiverNumber is provided, try to find user by phone number
        // If not found, create/find UserWithNoAccount and use its _id as receiverId
        if (!actualReceiverId && actualReceiverNumber) {
          console.log(
            `🔍 [sendMessage] Searching for user with phone number: ${actualReceiverNumber}`
          );
          const userByNumber = await User.findOne({
            number: actualReceiverNumber,
            active: true,
          }).session(session);
          if (userByNumber) {
            // Ensure _id is converted to ObjectId if needed
            actualReceiverId =
              userByNumber._id instanceof mongoose.Types.ObjectId
                ? userByNumber._id
                : new mongoose.Types.ObjectId(userByNumber._id);
            console.log(
              `✅ [sendMessage] Found registered user: ${actualReceiverId}`
            );
          } else {
            // No registered user found - create or find UserWithNoAccount
            console.log(
              `ℹ️ [sendMessage] No registered user found for phone number: ${actualReceiverNumber}, creating/finding UserWithNoAccount`
            );
            let userWithNoAccount = await UserWithNoAccount.findOne({
              phoneNumber: actualReceiverNumber,
            }).session(session);
            if (!userWithNoAccount) {
              [userWithNoAccount] = await UserWithNoAccount.create(
                [
                  {
                    phoneNumber: actualReceiverNumber,
                    gifts: [],
                    messages: [],
                  },
                ],
                { session }
              );
              console.log(
                `✅ [sendMessage] Created UserWithNoAccount: ${userWithNoAccount._id} for phone ${actualReceiverNumber}`
              );
            } else {
              console.log(
                `✅ [sendMessage] Found existing UserWithNoAccount: ${userWithNoAccount._id} for phone ${actualReceiverNumber}`
              );
            }
            // Use UserWithNoAccount._id as receiverId - ensure it's an ObjectId
            actualReceiverId =
              userWithNoAccount._id instanceof mongoose.Types.ObjectId
                ? userWithNoAccount._id
                : new mongoose.Types.ObjectId(userWithNoAccount._id);
            console.log(
              `📋 [sendMessage] Using UserWithNoAccount._id as receiverId: ${actualReceiverId} (type: ${actualReceiverId.constructor.name})`
            );
          }
        }

        let conversation = null;
        // Create conversation even if receiver doesn't exist (for phone number)
        // Ensure senderId is a valid ObjectId
        if (!mongoose.Types.ObjectId.isValid(senderId)) {
          throw new Error(
            `Invalid senderId: "${senderId}" is not a valid ObjectId`
          );
        }
        const senderObjectId = new mongoose.Types.ObjectId(senderId);

        if (actualReceiverId) {
          // Ensure receiverId is also a valid ObjectId
          console.log(
            `🔍 [sendMessage] Processing with actualReceiverId: ${actualReceiverId} (type: ${actualReceiverId.constructor.name})`
          );

          // Double-check that actualReceiverId is actually an ObjectId
          if (!mongoose.Types.ObjectId.isValid(actualReceiverId)) {
            console.error(
              `❌ [sendMessage] actualReceiverId "${actualReceiverId}" is not a valid ObjectId! This should not happen.`
            );
            throw new Error(
              `Invalid actualReceiverId: "${actualReceiverId}" is not a valid ObjectId`
            );
          }

          const receiverObjectId = new mongoose.Types.ObjectId(
            actualReceiverId
          );

          console.log(
            `📋 [sendMessage] Creating conversation with participants: [${senderObjectId}, ${receiverObjectId}]`
          );
          conversation = await Conversation.findOne({
            participants: { $all: [senderObjectId, receiverObjectId] },
          }).session(session); // Pass session

          if (!conversation) {
            // .create() in a session expects an array
            console.log(
              `🆕 [sendMessage] Creating new conversation with participants: [${senderObjectId}, ${receiverObjectId}]`
            );
            [conversation] = await Conversation.create(
              [{ participants: [senderObjectId, receiverObjectId] }],
              { session } // Pass session
            );
            console.log(
              `✅ [sendMessage] Conversation created: ${conversation._id}`
            );
          }
        } else {
          console.error(
            `❌ [sendMessage] actualReceiverId is not set! This should not happen.`
          );
          throw new Error("Receiver ID is required");
        }

        // --- HANDLE GIFT CREATION IF GIFT DATA PROVIDED (Single Call) ---
        // actualReceiverId is always set now (either User._id or UserWithNoAccount._id)
        let giftRecord = null;
        if (gift) {
          // Create new gift from provided data
          [giftRecord] = await Gift.create(
            [
              {
                senderId,
                receiverId: actualReceiverId, // Always an ObjectId now
                receiverNumber: actualReceiverNumber || null, // Keep for reference
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
                conversationId: conversation?._id || null,
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
            receiverId: actualReceiverId, // Always use ObjectId now
          }).session(session); // Pass session

          if (!giftRecord) {
            // This error will be caught, and the transaction will be aborted
            throw new Error("Gift not found or access denied");
          }
        }

        // --- PREPARE CONVERSATION UPDATE (only if conversation exists) ---
        if (conversation) {
          conversation.lastMessage = {
            text:
              giftRecord || giftId ? "🎁 Gift with message" : encrypt(content),
            sender: senderObjectId, // Use ObjectId, not string
          };
          conversation.lastMessageType =
            giftRecord || giftId ? "giftWithMessage" : type;
          // Update unreadCounts - actualReceiverId is always a valid ObjectId now
          // (either User._id or UserWithNoAccount._id)
          // Ensure it's converted to a string for Mongoose Map
          if (!actualReceiverId) {
            console.error(
              `❌ [sendMessage] actualReceiverId is null/undefined when updating unreadCounts!`
            );
            throw new Error(
              "actualReceiverId is required for unreadCounts update"
            );
          }

          // Convert to string - handle both ObjectId instances and strings
          let receiverIdString;
          if (actualReceiverId instanceof mongoose.Types.ObjectId) {
            receiverIdString = actualReceiverId.toString();
          } else if (typeof actualReceiverId === "string") {
            receiverIdString = actualReceiverId;
          } else {
            receiverIdString = String(actualReceiverId);
          }

          // Double-check it's a valid ObjectId string
          if (!mongoose.Types.ObjectId.isValid(receiverIdString)) {
            console.error(
              `❌ [sendMessage] receiverIdString "${receiverIdString}" is not a valid ObjectId string!`
            );
            throw new Error(`Invalid receiverIdString: ${receiverIdString}`);
          }

          const currentUnread =
            conversation.unreadCounts.get(receiverIdString) || 0;
          conversation.unreadCounts.set(receiverIdString, currentUnread + 1);
          console.log(
            `📊 [sendMessage] Updated unreadCounts for receiver: ${receiverIdString} = ${
              currentUnread + 1
            }`
          );

          await conversation.save({ session }); // Pass session
        }

        // --- MESSAGE CREATION (only if conversation exists) ---
        let newMessage = null;
        if (conversation) {
          [newMessage] = await Message.create(
            [
              {
                conversationId: conversation._id,
                senderId,
                receiverId: actualReceiverId,
                type: giftRecord || giftId ? "giftWithMessage" : type,
                content:
                  type === "text" && content ? encrypt(content) : content,
                mediaUrl,
                giftId: giftRecord ? giftRecord._id : giftId || undefined,
              },
            ],
            { session } // Pass session
          );
        }

        // --- UPDATE GIFT WITH MESSAGE ID (if message was created) ---
        if (giftRecord && newMessage) {
          // We use the same giftRecord variable, findByIdAndUpdate returns the new doc
          giftRecord = await Gift.findByIdAndUpdate(
            giftRecord._id,
            { $set: { messageId: newMessage._id } },
            { new: true, session } // Pass session
          );
        }

        // *** COMMIT THE TRANSACTION ***
        await session.commitTransaction();

        // --- EMIT SOCKET EVENTS (Only if transaction was successful and conversation exists) ---
        if (conversation && newMessage) {
          const unencryptedMessageForSocket = {
            ...newMessage.toObject(),
            content: content, // Send unencrypted content back to clients
            gift: giftRecord ? giftRecord.toObject() : undefined,
            // Include receiverNumber if it's a UserWithNoAccount (for frontend matching)
            receiverNumber: actualReceiverNumber || undefined,
          };

          if (giftRecord) {
            // Combined gift+message events
            io.to(actualReceiverId).emit("receiveGiftWithMessage", {
              message: unencryptedMessageForSocket,
              gift: giftRecord,
              conversation,
            });
            socket.emit("giftWithMessageSent", {
              message: unencryptedMessageForSocket,
              gift: giftRecord,
              conversation,
            });
          } else {
            // Regular message events
            io.to(actualReceiverId).emit("receiveMessage", {
              message: unencryptedMessageForSocket,
              conversation,
            });
            socket.emit("receiveMessage", {
              message: unencryptedMessageForSocket,
              conversation,
            });
          }
        }

        // --- SEND PUSH NOTIFICATIONS ---
        // Always send push notification (even if user is online or not registered)
        // This ensures users get notified even if they're not on the chat screen
        try {
          const sender = await User.findById(senderId).select("fullName image");
          let receiver = null;

          if (actualReceiverId) {
            receiver = await User.findById(actualReceiverId).select(
              "fcmToken fullName image"
            );
          } else if (actualReceiverNumber) {
            // Try to find user by phone number (even if inactive, they might have FCM token)
            receiver = await User.findOne({
              number: actualReceiverNumber,
            }).select("fcmToken fullName image");
          }

          // Check if actualReceiverId is a User (registered) or UserWithNoAccount (non-registered)
          const isUserWithNoAccount = await UserWithNoAccount.findById(
            actualReceiverId
          );

          if (isUserWithNoAccount) {
            // Receiver is a UserWithNoAccount (non-registered user)
            // Update UserWithNoAccount to track gifts/messages
            try {
              if (giftRecord) {
                isUserWithNoAccount.gifts.push({
                  giftId: giftRecord._id,
                  senderId: senderId,
                  createdAt: new Date(),
                });
              }
              if (newMessage) {
                isUserWithNoAccount.messages.push({
                  messageId: newMessage._id,
                  senderId: senderId,
                  content: content,
                  type: type,
                  createdAt: new Date(),
                });
              } else if (content && !giftRecord) {
                // If message wasn't created but content exists, save it anyway
                isUserWithNoAccount.messages.push({
                  senderId: senderId,
                  content: content,
                  type: type,
                  createdAt: new Date(),
                });
              }
              await isUserWithNoAccount.save();
              console.log(
                `✅ Gift/message saved to UserWithNoAccount ${actualReceiverId} for phone ${isUserWithNoAccount.phoneNumber}`
              );
            } catch (saveError) {
              console.error(
                "Error saving gift/message to UserWithNoAccount:",
                saveError.message
              );
            }
            // No FCM notification for non-registered users (no FCM token)
            console.log(
              `ℹ️ Gift/message created for non-registered user (phone: ${isUserWithNoAccount.phoneNumber}), no FCM notification sent`
            );
          } else {
            // Receiver is a registered User - try to send FCM notification
            if (receiver?.fcmToken) {
              if (giftRecord) {
                // Pass unencrypted content for notification
                await sendGiftWithMessageNotification(
                  receiver.fcmToken,
                  giftRecord,
                  newMessage || giftRecord, // Use giftRecord if no message
                  sender,
                  content // Pass unencrypted content
                );
                console.log(
                  `📱 Push notification sent for gift with message to ${actualReceiverId}`
                );
              } else if (newMessage) {
                // Pass unencrypted content for notification
                await sendMessageNotification(
                  receiver.fcmToken,
                  newMessage,
                  sender,
                  content // Pass unencrypted content
                );
                console.log(
                  `📱 Push notification sent for message to ${actualReceiverId}`
                );
              }
            } else {
              console.log(
                `ℹ️ No FCM token found for registered user ${actualReceiverId}`
              );
            }
          }
        } catch (notifError) {
          console.error("Error sending push notification:", notifError.message);
          // Don't fail the message send if notification fails
        }

        if (callback) {
          callback({
            success: true,
            gift: giftRecord || null,
            message: newMessage || null,
            conversation: conversation || null,
          });
        }
      } catch (err) {
        // *** ABORT THE TRANSACTION ***
        await session.abortTransaction();

        console.error(
          "❌ [sendMessage] Error sending message (transaction aborted):",
          err.message
        );
        console.error("❌ [sendMessage] Error stack:", err.stack);
        console.error("❌ [sendMessage] Error details:", {
          name: err.name,
          message: err.message,
          senderId,
          receiverId,
          receiverNumber,
        });
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
    // Uses the same allocation service as REST API for consistency
    socket.on("allotGift", async ({ giftId, chosenType }) => {
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const userId = socket.user.id; // Use trusted user ID

        // Validate allocation type
        if (!chosenType || !["gold", "stock"].includes(chosenType)) {
          await session.abortTransaction();
          return socket.emit("error", {
            message: "chosenType must be either 'gold' or 'stock'",
          });
        }

        // Use the shared allocation service
        const gift = await allocateGift({
          giftId,
          userId,
          allocationType: chosenType,
          session,
        });

        // Commit transaction
        await session.commitTransaction();

        // If allotment was successful:
        socket.emit("giftAllotted", {
          giftId: gift._id,
          gift: gift,
          allocationType: chosenType,
          convertedQuantity: gift.quantity,
        });

        // Let the sender know their gift was accepted
        io.to(String(gift.senderId)).emit("giftAccepted", {
          giftId: gift._id,
          conversationId: gift.conversationId,
          allocationType: chosenType,
        });
      } catch (err) {
        await session.abortTransaction();
        console.error("❌ [allotGift] Error allotting gift:", err.message);
        console.error("❌ [allotGift] Error stack:", err.stack);
        socket.emit("error", {
          message: err.message || "Failed to allot gift.",
        });
      } finally {
        await session.endSession();
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
