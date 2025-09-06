const app = require("./app");
const { config } = require("dotenv");
const connectDatabase = require("./config/database");

// handling uncaught error
process.on("uncaughtException", (err) => {
  console.log(`Error: ${err.message}`);
  console.log("shutting down the server due to uncaught error...........");
  process.exit(1);
});

// env config
config();

// database connection
connectDatabase();

// app listening at port
const server = app.listen(process.env.PORT, () =>
  console.log(`app is running at port ${process.env.PORT}`)
);

// unhandled promise rejection
process.on("unhandledRejection", (err) => {
  console.log(`Error: ${err.message}`);
  console.log(
    "shutting down the server due to Unhandled promise rejection..........."
  );
  server.close(() => {
    process.exit(1);
  });
});
