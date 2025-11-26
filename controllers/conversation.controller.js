const axios = require("axios");
const { decrypt } = require("../utils/crypto.util"); // ✨ IMPORT
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const Gift = require("../models/Gift");
const UserWithNoAccount = require("../models/UserWithNoAccount");
const User = require("../models/user.model");
const mongoose = require("mongoose");

const UPLOADS_SERVICE_BASE = "http://localhost:4000";

// Helper: get presigned URL from uploads service
async function fetchPresignedUrlForKey(key) {
  try {
    const resp = await axios.get(
      `${UPLOADS_SERVICE_BASE}/api/v1/uploads/getpresignedurl`,
      { params: { key } }
    );
    return resp.data?.url || null; // your API gives { success:true, url:"..." }
  } catch (err) {
    console.error(`Failed to fetch presigned URL for key=${key}:`, err.message);
    return null;
  }
}

exports.getConversations = async (req, res, next) => {
  try {
    // Get conversations where user is a participant OR sender with phone number
    const conversations = await Conversation.find({
      $or: [
        { participants: req.user.id },
        { senderId: req.user.id, receiverNumber: { $exists: true } },
      ],
    })
      .populate("participants", "fullName image number")
      .populate("senderId", "fullName image number")
      .sort({ updatedAt: -1 });

    // Filter out self-gift conversations (where both participants are the same user)
    const filteredConversations = conversations.filter((convo) => {
      const convoObj = convo.toObject();

      // If this conversation is for a phone-number (no-account) recipient, keep it
      if (convoObj.receiverNumber) {
        return true;
      }

      // If it's a conversation with participants array
      if (convoObj.participants && convoObj.participants.length > 0) {
        // Check if all participants are the same user (self-conversation)
        const uniqueParticipantIds = [
          ...new Set(
            convoObj.participants.map((p) => p._id || p).filter(Boolean)
          ),
        ];
        if (uniqueParticipantIds.length === 1) {
          console.log(`🚫 Filtering out self-conversation: ${convoObj._id}`);
          return false; // Filter out self-conversations
        }
      }

      return true; // Keep regular conversations
    });

    // Decrypt + add presigned media if needed
    const decryptedConversations = await Promise.all(
      filteredConversations.map(async (convo) => {
        const convoObject = convo.toObject();

        // Text message decryption
        if (convoObject.lastMessage && convoObject.lastMessageType === "text") {
          try {
            convoObject.lastMessage.text = decrypt(
              convoObject.lastMessage.text
            );
          } catch {
            convoObject.lastMessage.text = "[Encrypted Message]";
          }
        }

        // If lastMessage is media type → get presigned URL
        if (
          convoObject.lastMessage &&
          convoObject.lastMessage.mediaUrl &&
          ["image", "voice"].includes(convoObject.lastMessage.type)
        ) {
          const url = await fetchPresignedUrlForKey(
            convoObject.lastMessage.mediaUrl
          );
          convoObject.lastMessage.media = url || null;
        } else if (convoObject.lastMessage) {
          convoObject.lastMessage.media = null;
        }

        return convoObject;
      })
    );

    res.status(200).json(decryptedConversations);
  } catch (err) {
    next(err);
  }
};
// -------------------- GET MESSAGES --------------------
exports.getMessagesForConversation = async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;

    // Security check: ensure user is a participant
    const conversation = await Conversation.findById(conversationId);
    const participantIds = conversation
      ? conversation.participants.map((p) => p.toString())
      : [];

    if (!conversation || !participantIds.includes(userId.toString())) {
      return res.status(403).json({
        message: "Forbidden: You are not a participant in this conversation.",
      });
    }

    const page = parseInt(req.query.page, 10) || 1;
    const limit = 25;
    const skip = (page - 1) * limit;

    const messages = await Message.find({ conversationId })
      .populate("giftId")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Filter out self-gift messages
    // First, collect all giftIds that need to be checked
    const giftIdsToCheck = [];
    messages.forEach((msg) => {
      const msgObj = msg.toObject();
      if (msgObj.giftId) {
        const gift = msgObj.giftId;
        // If gift is not populated (just an ObjectId), we need to fetch it
        if (typeof gift === "object" && gift._id) {
          giftIdsToCheck.push(gift._id.toString());
        } else if (mongoose.Types.ObjectId.isValid(gift)) {
          giftIdsToCheck.push(gift.toString());
        }
      }
    });

    // Fetch all gifts in one query to check isSelfGift
    const giftsMap = new Map();
    if (giftIdsToCheck.length > 0) {
      const gifts = await Gift.find({
        _id: { $in: giftIdsToCheck },
      }).select("_id isSelfGift");
      gifts.forEach((gift) => {
        giftsMap.set(gift._id.toString(), gift.isSelfGift);
      });
    }

    // Filter out self-gift messages
    const filteredMessages = messages.filter((msg) => {
      const msgObj = msg.toObject();
      // Check if message has a gift and if it's a self-gift
      if (msgObj.giftId) {
        const gift = msgObj.giftId;
        let isSelfGift = false;

        // Check if gift is populated (object with properties)
        if (gift && typeof gift === "object" && gift._id) {
          isSelfGift = gift.isSelfGift === true;
          // Also check in the map (in case populate didn't include isSelfGift)
          if (!isSelfGift && giftsMap.has(gift._id.toString())) {
            isSelfGift = giftsMap.get(gift._id.toString()) === true;
          }
        } else if (mongoose.Types.ObjectId.isValid(gift)) {
          // Gift is just an ObjectId, check in map
          isSelfGift = giftsMap.get(gift.toString()) === true;
        }

        if (isSelfGift) {
          console.log(
            `🚫 [getMessagesForConversation] Filtering out self-gift message: ${
              msgObj._id
            }, giftId: ${gift._id || gift}`
          );
          return false; // Filter out self-gift messages
        }
      }
      return true; // Keep all other messages
    });

    // Decrypt + attach presigned media URLs
    const decryptedMessages = await Promise.all(
      filteredMessages.map(async (msg) => {
        const messageObject = msg.toObject();

        // decrypt text messages
        if (
          ["text", "giftWithMessage"].includes(messageObject.type) &&
          messageObject.content
        ) {
          try {
            messageObject.content = decrypt(messageObject.content);
          } catch {
            messageObject.content = "[Encrypted Message]";
          }
        }

        // media: fetch presigned url if type is image/audio
        if (
          messageObject.mediaUrl &&
          ["image", "voice"].includes(messageObject.type)
        ) {
          const url = await fetchPresignedUrlForKey(messageObject.mediaUrl);
          messageObject.media = url || null;
        } else {
          messageObject.media = null;
        }

        // Add gift data if message has a gift
        if (messageObject.giftId) {
          messageObject.gift = messageObject.giftId;
          delete messageObject.giftId; // Clean up the reference
        }

        return messageObject;
      })
    );

    res.status(200).json(decryptedMessages.reverse());
  } catch (err) {
    next(err);
  }
};
exports.getMessagesByUserId = async (req, res, next) => {
  try {
    const peerId = req.params.peerId || req.body.peerId;
    const userId = req.user.id;

    if (!peerId) {
      return res
        .status(400)
        .json({ success: false, message: "peerId is required" });
    }

    // Normalize phone number helper
    const normalizePhoneNumber = (rawNumber) => {
      if (!rawNumber) return null;
      const str = String(rawNumber);
      const digits = str.replace(/\D/g, "");
      if (digits.length >= 10) {
        return digits.slice(-10);
      }
      return null;
    };

    // Determine actual peer ID - could be ObjectId or phone number
    let actualPeerId = peerId;
    let normalizedNumberForPeer = null;

    // Check if peerId is a phone number (10 digits) or ObjectId (24 hex chars)
    const isPhoneNumber = /^\d{10}$/.test(peerId);
    const isObjectId =
      mongoose.Types.ObjectId.isValid(peerId) &&
      /^[0-9a-fA-F]{24}$/.test(peerId);

    if (isPhoneNumber && !isObjectId) {
      // peerId is a phone number - find UserWithNoAccount or newly registered user
      normalizedNumberForPeer = normalizePhoneNumber(peerId);
      if (normalizedNumberForPeer) {
        const userWithNoAccount = await UserWithNoAccount.findOne({
          phoneNumber: normalizedNumberForPeer,
        });
        if (userWithNoAccount) {
          actualPeerId = userWithNoAccount._id.toString();
          console.log(
            `📞 [getMessagesByUserId] Found UserWithNoAccount ${actualPeerId} for phone ${normalizedNumberForPeer}`
          );
        } else {
          const registeredUser = await User.findOne({
            number: normalizedNumberForPeer,
          }).select("_id number");
          if (registeredUser) {
            actualPeerId = registeredUser._id.toString();
            console.log(
              `✅ [getMessagesByUserId] Found registered user ${actualPeerId} for phone ${normalizedNumberForPeer}`
            );
          } else {
            // No user of any kind for the phone number
            return res.status(200).json({
              success: true,
              messages: [],
            });
          }
        }
      }
    } else if (!isObjectId) {
      // Invalid format
      return res.status(400).json({
        success: false,
        message:
          "Invalid peerId format. Must be a valid ObjectId or phone number.",
      });
    }

    // Find the conversation between these two users
    const conversation = await Conversation.findOne({
      participants: { $all: [userId, actualPeerId] },
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "No conversation found between these users.",
      });
    }

    const page = parseInt(req.query.page, 10) || 1;
    const limit = 25;
    const skip = (page - 1) * limit;

    // Get last 25 messages for that conversation with gift data
    const messages = await Message.find({ conversationId: conversation._id })
      .populate("giftId")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Filter out self-gift messages
    // First, collect all giftIds that need to be checked
    const giftIdsToCheck = [];
    messages.forEach((msg) => {
      const msgObj = msg.toObject();
      if (msgObj.giftId) {
        const gift = msgObj.giftId;
        // If gift is not populated (just an ObjectId), we need to fetch it
        if (typeof gift === "object" && gift._id) {
          giftIdsToCheck.push(gift._id.toString());
        } else if (mongoose.Types.ObjectId.isValid(gift)) {
          giftIdsToCheck.push(gift.toString());
        }
      }
    });

    // Fetch all gifts in one query to check isSelfGift
    const giftsMap = new Map();
    if (giftIdsToCheck.length > 0) {
      const gifts = await Gift.find({
        _id: { $in: giftIdsToCheck },
      }).select("_id isSelfGift");
      gifts.forEach((gift) => {
        giftsMap.set(gift._id.toString(), gift.isSelfGift);
      });
    }

    // Filter out self-gift messages
    const filteredMessages = messages.filter((msg) => {
      const msgObj = msg.toObject();
      // Check if message has a gift and if it's a self-gift
      if (msgObj.giftId) {
        const gift = msgObj.giftId;
        let isSelfGift = false;

        // Check if gift is populated (object with properties)
        if (gift && typeof gift === "object" && gift._id) {
          isSelfGift = gift.isSelfGift === true;
          // Also check in the map (in case populate didn't include isSelfGift)
          if (!isSelfGift && giftsMap.has(gift._id.toString())) {
            isSelfGift = giftsMap.get(gift._id.toString()) === true;
          }
        } else if (mongoose.Types.ObjectId.isValid(gift)) {
          // Gift is just an ObjectId, check in map
          isSelfGift = giftsMap.get(gift.toString()) === true;
        }

        if (isSelfGift) {
          console.log(
            `🚫 [getMessagesByUserId] Filtering out self-gift message: ${
              msgObj._id
            }, giftId: ${gift._id || gift}`
          );
          return false; // Filter out self-gift messages
        }
      }
      return true; // Keep all other messages
    });

    // Decrypt + attach presigned media URLs
    const decryptedMessages = await Promise.all(
      filteredMessages.map(async (msg) => {
        const messageObject = msg.toObject();

        // decrypt text messages
        if (
          ["text", "giftWithMessage"].includes(messageObject.type) &&
          messageObject.content
        ) {
          try {
            messageObject.content = decrypt(messageObject.content);
          } catch {
            messageObject.content = "[Encrypted Message]";
          }
        }

        // media: fetch presigned url if type is image/voice
        if (
          messageObject.mediaUrl &&
          ["image", "voice"].includes(messageObject.type)
        ) {
          const url = await fetchPresignedUrlForKey(messageObject.mediaUrl);
          messageObject.media = url || null;
        } else {
          messageObject.media = null;
        }

        // Add gift data if message has a gift
        if (messageObject.giftId) {
          messageObject.gift = messageObject.giftId;
          delete messageObject.giftId; // Clean up the reference
        }

        return messageObject;
      })
    );

    res.status(200).json({
      success: true,
      messages: decryptedMessages.reverse(), // oldest → newest
    });
  } catch (err) {
    next(err);
  }
};
