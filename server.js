// server.js
const { config } = require("dotenv");
config();

const app = require("./app");
const connectDatabase = require("./config/database");
const { createServer } = require("http");
const { Server } = require("socket.io");
const { initChatSocket } = require("./sockets/chatSocket");
const { setSocketServer } = require("./sockets/socketEmitter");
const redisAdapter = require("@socket.io/redis-adapter");
const { createClient } = require("redis");
const jwt = require("jsonwebtoken");

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
  const token = socket.handshake.auth?.token;
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

// Async Redis adapter setup (works with local or cloud Redis)
// Uses REDIS_URL env var. If absent, app continues without adapter (single instance).
(async () => {
  const REDIS_URL = process.env.REDIS_URL;
  if (!REDIS_URL) {
    console.warn(
      "REDIS_URL not set — running without Redis adapter (single-instance)."
    );
    return;
  }

  try {
    // createClient accepts rediss:// and redis:// URIs
    const pubClient = createClient({
      url: REDIS_URL,
      socket: {
        // leave TLS detection to the URL scheme (rediss://)
        keepAlive: 30000,
        reconnectStrategy: (retries) => {
          // exponential backoff capped at 2s
          return Math.min(retries * 50, 2000);
        },
      },
    });

    // duplicate for sub client as required by socket.io redis-adapter
    const subClient = pubClient.duplicate();

    // Helpful logging & error handlers
    const onRedisError = (label) => (err) =>
      console.error(`[Redis:${label}] error:`, err?.message || err);
    const onRedisConnect = (label) => () =>
      console.log(`[Redis:${label}] connected.`);
    const onRedisReady = (label) => () =>
      console.log(`[Redis:${label}] ready.`);

    pubClient.on("error", onRedisError("pub"));
    subClient.on("error", onRedisError("sub"));

    pubClient.on("connect", onRedisConnect("pub"));
    subClient.on("connect", onRedisConnect("sub"));

    pubClient.on("ready", onRedisReady("pub"));
    subClient.on("ready", onRedisReady("sub"));

    await Promise.all([pubClient.connect(), subClient.connect()]);

    io.adapter(redisAdapter(pubClient, subClient));
    console.log("Socket.IO Redis adapter initialized.");
  } catch (err) {
    console.warn(
      "Failed to initialize Redis adapter — continuing without it. Error:",
      err?.message || err
    );
    // Note: In a strict production setup you might want to exit here:
    // process.exit(1);
  }
})().catch((err) => {
  console.error("Unexpected error while initializing Redis adapter:", err);
});

// Initialize chat socket handlers (this attaches listeners to `io`)
initChatSocket(io);
setSocketServer(io);

// Start auto-allocation cron job
const { startAutoAllocationCron } = require("./services/autoAllocationCron");
startAutoAllocationCron();

// Graceful shutdown helpers
const PORT = process.env.PORT || 5000;
const server = httpServer.listen(PORT, () =>
  console.log(`Server running on port ${PORT}`)
);

// Export a getter so other modules can access the live io instance safely
module.exports.getIO = () => io;
// Also export io directly for backward compatibility
module.exports.io = io;

// Process-level error handlers
process.on("uncaughtException", (err) => {
  console.error(`Uncaught Exception: ${err?.message || err}`);
  console.error(err?.stack || "");
  console.log("Shutting down the server due to uncaught exception...");
  server.close(() => process.exit(1));
});

process.on("unhandledRejection", (err) => {
  console.error(`Unhandled Rejection: ${err?.message || err}`);
  console.error(err?.stack || "");
  console.log("Shutting down the server due to unhandled rejection...");
  server.close(() => process.exit(1));
});

// Also handle termination signals for graceful shutdown
const shutdown = (signal) => {
  console.log(`Received ${signal}. Closing server...`);
  server.close(() => {
    console.log("HTTP server closed.");
    // If you want to also disconnect redis clients here, do that (if you kept references).
    process.exit(0);
  });
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
