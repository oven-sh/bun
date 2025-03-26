import express from "express";

const app = express();
const port = 0;
const body = Buffer.alloc(10 * 1024, "X");

// Empty endpoint with no body
app.get("/empty", (req, res) => {
  res.end();
});

// Endpoint that consumes request body
app.post("/request-body", express.json({ limit: "10mb" }), (req, res) => {
  // Just consume the body and do nothing with it

  res.end();
});

// Endpoint that sends response body
app.get("/response-body", (req, res) => {
  res.send(body);
});

// Special RSS endpoint to check memory usage from inside the process
app.get("/rss", (req, res) => {
  typeof Bun !== "undefined" && Bun.gc(true);
  res.json({
    rss: process.memoryUsage.rss(),
    objects: smallAssign(typeof Bun !== "undefined" ? require("bun:jsc").heapStats().objectTypeCounts : {}),
  });
});

function smallAssign(obj) {
  for (let k in obj) {
    if (obj[k] < 100) delete obj[k];
  }

  return obj;
}

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
