const express = require("express");
const app = express();

const cookieParser = require("cookie-parser");
const logger = require("morgan");
const cors = require("cors");
const errorMiddleware = require("./middlewares/errorMiddleware"); // import it

app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());
app.use(logger("tiny"));
// Increase body size limit for file uploads (50MB)
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.get("/", (req, res) => {
  res.send("API is running....");
});

app.use("/api/v1/users", require("./routes/user.routes"));
app.use("/api/v1/uploads", require("./routes/upload.routes"));
app.use("/api/v1/gifts", require("./routes/gift.routes"));
app.use("/api/v1/events", require("./routes/event.routes"));
app.use("/api/v1/withdrawals", require("./routes/withdrawal.routes"));
app.use("/api/v1/kyc", require("./routes/kyc.routes"));
app.use("/api/v1/admin", require("./routes/admin.routes"));

// Error handler middleware (MUST be last)
app.use(errorMiddleware);

module.exports = app;
