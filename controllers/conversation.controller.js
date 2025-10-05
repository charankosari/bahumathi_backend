// Get all conversations for the logged-in user
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
exports.getConversations = async (req, res, next) => {
  try {
    const conversations = await Conversation.find({ participants: req.user.id })
      .populate("participants", "name profilePic") // Populate user details
      .sort({ updatedAt: -1 });

    res.status(200).json(conversations);
  } catch (err) {
    next(err);
  }
};

// Get messages for a specific conversation (with pagination)
exports.getMessages = async (req, res, next) => {
  try {
    const { id } = req.params;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = 20;
    const skip = (page - 1) * limit;

    const messages = await Message.find({ conversationId: id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.status(200).json(messages.reverse()); // reverse to show oldest first
  } catch (err) {
    next(err);
  }
};

// @desc    Get messages for a specific conversation
// @route   GET /api/v1/conversations/:conversationId/messages
// @access  Private
exports.getMessagesForConversation = async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;

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

    res.status(200).json(messages.reverse());
  } catch (err) {
    next(err);
  }
};
