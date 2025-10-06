const { decrypt } = require("../utils/crypto.util"); // ✨ IMPORT
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");

// Get all conversations for the logged-in user
exports.getConversations = async (req, res, next) => {
  try {
    const conversations = await Conversation.find({ participants: req.user.id })
      .populate("participants", "name profilePic")
      .sort({ updatedAt: -1 });

    // Decrypt the last message for each conversation
    const decryptedConversations = conversations.map((convo) => {
      const convoObject = convo.toObject();
      if (convoObject.lastMessage && convoObject.lastMessageType === "text") {
        try {
          convoObject.lastMessage.text = decrypt(convoObject.lastMessage.text);
        } catch (e) {
          convoObject.lastMessage.text = "[Encrypted Message]";
        }
      }
      return convoObject;
    });

    res.status(200).json(decryptedConversations);
  } catch (err) {
    next(err);
  }
};

// Get messages for a specific conversation
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
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Decrypt each message content
    const decryptedMessages = messages.map((msg) => {
      const messageObject = msg.toObject();
      if (messageObject.type === "text" && messageObject.content) {
        try {
          messageObject.content = decrypt(messageObject.content);
        } catch (e) {
          console.error(`Failed to decrypt message ${messageObject._id}:`, e);
          messageObject.content = "[Encrypted Message]";
        }
      }
      return messageObject;
    });

    res.status(200).json(decryptedMessages.reverse());
  } catch (err) {
    next(err);
  }
};
