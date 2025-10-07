// server.js
const { config } = require("dotenv");
config();

const app = require("./app");
const connectDatabase = require("./config/database");
const { createServer } = require("http");
const { Server } = require("socket.io");
const { initChatSocket } = require("./sockets/chatSocket");
const redisAdapter = require("@socket.io/redis-adapter");
const { createClient } = require("redis");
const jwt = require("jsonwebtoken");

// Global variable to hold io
let ioInstance = null;

process.on("uncaughtException", (err) => {
  console.log(`Error: ${err.message}`);
  console.log("shutting down the server due to uncaught error...........");
  process.exit(1);
});

connectDatabase();

// Create HTTP server
const httpServer = createServer(app);

// Initialize Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Middleware: Authenticate socket connections
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token)
    return next(new Error("Authentication error: Token not provided."));

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    next(new Error("Authentication error: Invalid token."));
  }
});

// Redis adapter setup (optional)
(async () => {
  try {
    const pubClient = createClient({ url: process.env.REDIS_URL });
    const subClient = pubClient.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(redisAdapter(pubClient, subClient));
  } catch (err) {
    console.warn("Redis not connected, continuing without adapter...");
  }
})();

// Initialize chat socket
initChatSocket(io);

// 🟢 Export the io instance for controllers to use
ioInstance = io;
module.exports.io = ioInstance;

const PORT = process.env.PORT || 5000;
const server = httpServer.listen(PORT, () =>
  console.log(`Server running on port ${PORT}`)
);

// Graceful shutdown
process.on("unhandledRejection", (err) => {
  console.log(`Error: ${err.message}`);
  console.log("shutting down the server due to Unhandled promise rejection...");
  server.close(() => process.exit(1));
});
