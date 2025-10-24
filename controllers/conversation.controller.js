const axios = require("axios");
const { decrypt } = require("../utils/crypto.util"); // ✨ IMPORT
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");

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
    const conversations = await Conversation.find({ participants: req.user.id })
      .populate("participants", "name profilePic")
      .sort({ updatedAt: -1 });

    // Decrypt + add presigned media if needed
    const decryptedConversations = await Promise.all(
      conversations.map(async (convo) => {
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
    if (!conversation || !conversation.participants.includes(userId)) {
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

    // Decrypt + attach presigned media URLs
    const decryptedMessages = await Promise.all(
      messages.map(async (msg) => {
        const messageObject = msg.toObject();

        // decrypt text messages
        if (messageObject.type === "text" && messageObject.content) {
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

    // Find the conversation between these two users
    const conversation = await Conversation.findOne({
      participants: { $all: [userId, peerId] },
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

    // Decrypt + attach presigned media URLs
    const decryptedMessages = await Promise.all(
      messages.map(async (msg) => {
        const messageObject = msg.toObject();

        // decrypt text messages
        if (messageObject.type === "text" && messageObject.content) {
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
