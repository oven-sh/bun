#!/usr/bin/env node
import { createServer } from "http";
import crypto from "crypto";

const port = 0;

function generateAccept(key) {
  return crypto
    .createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
}

const server = createServer();

let connectedSocket = null;
let requestHeaders = {};

server.on("upgrade", (request, socket, head) => {
  // Store the headers
  requestHeaders = request.headers;
  
  const key = request.headers["sec-websocket-key"];
  const accept = generateAccept(key);
  
  // Build response headers
  let responseHeaders = [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
  ];
  
  // Echo back the protocol if provided
  if (request.headers["sec-websocket-protocol"]) {
    // Just echo back the first protocol
    const protocols = request.headers["sec-websocket-protocol"].split(",")[0].trim();
    responseHeaders.push(`Sec-WebSocket-Protocol: ${protocols}`);
  }
  
  responseHeaders.push("", ""); // Empty line to end headers
  
  socket.write(responseHeaders.join("\r\n"));
  
  connectedSocket = socket;
  
  // Send headers as first message (simple text frame)
  const message = JSON.stringify({
    type: "headers",
    headers: requestHeaders,
  });
  
  // Simple WebSocket text frame
  const messageBuffer = Buffer.from(message);
  
  // Handle payload length encoding
  let frame;
  if (messageBuffer.length < 126) {
    frame = Buffer.allocUnsafe(2 + messageBuffer.length);
    frame[0] = 0x81; // FIN + text opcode
    frame[1] = messageBuffer.length; // Payload length (no masking for server)
    messageBuffer.copy(frame, 2);
  } else if (messageBuffer.length < 65536) {
    frame = Buffer.allocUnsafe(4 + messageBuffer.length);
    frame[0] = 0x81; // FIN + text opcode
    frame[1] = 126; // Extended payload length (16-bit)
    frame.writeUInt16BE(messageBuffer.length, 2);
    messageBuffer.copy(frame, 4);
  } else {
    // For very large messages (unlikely in our test)
    frame = Buffer.allocUnsafe(10 + messageBuffer.length);
    frame[0] = 0x81; // FIN + text opcode
    frame[1] = 127; // Extended payload length (64-bit)
    frame.writeBigUInt64BE(BigInt(messageBuffer.length), 2);
    messageBuffer.copy(frame, 10);
  }
  
  socket.write(frame);
  
  socket.on("data", (data) => {
    // Simple echo - just bounce back any frames we receive
    // This is not a full WebSocket implementation but enough for testing
    if (data[0] === 0x88) {
      // Close frame
      socket.end();
    }
  });
  
  socket.on("error", (err) => {
    console.error("Socket error:", err);
  });
});

server.listen(port, () => {
  const { port } = server.address();
  const url = `ws://localhost:${port}`;
  
  if (process.send) {
    process.send({ href: url });
  } else {
    console.log(url);
  }
});

process.on("SIGTERM", () => {
  if (connectedSocket) {
    connectedSocket.end();
  }
  server.close();
  process.exit(0);
});