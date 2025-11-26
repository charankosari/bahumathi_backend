let ioInstance = null;

const setSocketServer = (io) => {
  ioInstance = io;
};

const emitToUser = (userId, event, payload) => {
  if (!ioInstance || !userId || !event) return;
  try {
    ioInstance.to(String(userId)).emit(event, payload);
  } catch (error) {
    console.error(
      "❌ Failed to emit socket event:",
      event,
      "for user",
      userId,
      error?.message || error
    );
  }
};

module.exports = {
  setSocketServer,
  emitToUser,
};
