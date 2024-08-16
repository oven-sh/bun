const OrigWebSocket = global.WebSocket;
global.WebSocket = require("ws");

if (global.WebSocket === OrigWebSocket) {
  throw new Error("Failed to override WebSocket");
}

new WebSocket("https://example.com");

// Success is not infinite looping due to the overriden `WebSocket` constructor
process.exit(0);
