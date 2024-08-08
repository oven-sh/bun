import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const server = createServer();
const wss = new WebSocketServer({
  perMessageDeflate: false,
  noServer: true,
});

server.on("listening", () => {
  const { address, port, family } = server.address();
  const { href } = new URL(family === "IPv6" ? `ws://[${address}]:${port}` : `ws://${address}:${port}`);
  console.log(href);
  console.error("Listening:", href);
});

server.on("request", (request, response) => {
  console.error("Received request:", { ...request.headers });
  response.end();
});

server.on("clientError", (error, socket) => {
  console.error("Received client error:", error);
  socket.end();
});

server.on("error", error => {
  console.error("Received error:", error);
});

server.on("upgrade", (request, socket, head) => {
  console.error("Received upgrade:", { ...request.headers });

  socket.on("data", data => {
    console.error("Received bytes:", data);
  });

  wss.handleUpgrade(request, socket, head, ws => {
    wss.emit("connection", ws, request);
  });
});

wss.on("connection", (ws, request) => {
  console.error("Received connection:", request.socket.remoteAddress);

  ws.on("message", message => {
    console.error("Received message:", message);
    ws.send(message);

    if (message === "ping") {
      console.error("Sending ping");
      ws.ping();
    } else if (message === "pong") {
      console.error("Sending pong");
      ws.pong();
    } else if (message === "close") {
      console.error("Sending close");
      ws.close();
    } else if (message === "terminate") {
      console.error("Sending terminate");
      ws.terminate();
    }
  });

  ws.on("ping", data => {
    console.error("Received ping:", data);
    ws.ping(data);
  });

  ws.on("pong", data => {
    console.error("Received pong:", data);
    ws.pong(data);
  });

  ws.on("close", (code, reason) => {
    console.error("Received close:", code, reason);
  });

  ws.on("error", error => {
    console.error("Received error:", error);
  });
});

server.on("close", () => {
  console.error("Server closed");
});

process.on("exit", exitCode => {
  console.error("Server exited:", exitCode);
});

const hostname = process.env.HOST || "127.0.0.1";
const port = parseInt(process.env.PORT || "0");
server.listen(port, hostname);
