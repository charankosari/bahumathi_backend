const express = require("express");
const app = express();

const cookieParser = require("cookie-parser");
const logger = require("morgan");
const cors = require("cors");

app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());
app.use(logger("tiny"));
app.use(express.json());
app.get("/", (req, res) => {
  res.send("API is running....");
});

module.exports = app;
