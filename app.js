const express = require("express");
const app = express();

const cookieParser = require("cookie-parser");
const logger = require("morgan");
const cors = require("cors");
const errorMiddleware = require("./middlewares/errorMiddleware"); // import it

app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());
app.use(logger("tiny"));
app.use(express.json());

app.get("/", (req, res) => {
  res.send("API is running....");
});

app.use("/api/v1/users", require("./routes/user.routes"));

// Error handler middleware (MUST be last)
app.use(errorMiddleware);

module.exports = app;
