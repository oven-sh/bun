import express from "express";

const app = express();
const port = 0;

// The /aborted endpoint
app.post("/aborted", express.raw({ limit: "100mb" }), (req, res) => {
  // This endpoint should receive an aborted request
  // The test will abort before finishing the request body
  res.status(200).end();
});

// Start the server
const server = app.listen(port, () => {
  const address = server.address();

  // Send the port back to the parent process via IPC
  process.send({
    type: "listening",
    host: address.address === "::" ? "localhost" : address.address,
    port: address.port,
  });
});

// Handle shutdown request from parent
process.on("message", message => {
  if (message.type === "shutdown") {
    server.close(() => {
      process.exit(0);
    });
  }
});
