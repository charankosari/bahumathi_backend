const app = require("./app");
const { config } = require("dotenv");
const connectDatabase = require("./config/database");
const { createServer } = require("http");
const { Server } = require("socket.io");
const { initChatSocket } = require("./sockets/chatSocket");
const redisAdapter = require("@socket.io/redis-adapter");
const { createClient } = require("redis");
process.on("uncaughtException", (err) => {
  console.log(`Error: ${err.message}`);
  console.log("shutting down the server due to uncaught error...........");
  process.exit(1);
});
config();
connectDatabase();

// Create HTTP server
const httpServer = createServer(app);

// Initialize Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: "*", // restrict this in production
    methods: ["GET", "POST"],
  },
});

// Redis adapter for scaling (optional)
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

// Initialize chat sockets
initChatSocket(io);

const PORT = process.env.PORT || 5000;
const server = httpServer.listen(PORT, () =>
  console.log(`Server running on port ${PORT}`)
);

// Graceful shutdown
process.on("unhandledRejection", (err) => {
  console.log(`Error: ${err.message}`);
  console.log(
    "shutting down the server due to Unhandled promise rejection..........."
  );
  server.close(() => process.exit(1));
});
