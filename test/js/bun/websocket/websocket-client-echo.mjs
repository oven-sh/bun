import { WebSocket } from "ws";

let url;
try {
  url = new URL(process.argv[2]);
} catch {
  throw new Error(`Usage: ${process.argv0} websocket-client-echo.mjs <url>`);
}

const ws = new WebSocket(url, {
  perMessageDeflate: false,
});

ws.on("open", () => {
  if (process.send) {
    process.send("connected");
  }
  console.log(`[${process.versions.bun ? "bun" : "node"}]`, "Connected", ws.url); // read by test script
  console.error(`[${process.versions.bun ? "bun" : "node"}]`, "Connected", ws.url);
});
const logMessages = process.env.LOG_MESSAGES === "1";
ws.on("message", (data, isBinary) => {
  if (logMessages) {
    if (isBinary) {
      console.error("Received binary message:", data);
    } else {
      console.error("Received text message:", data);
      data = data.toString();
    }
  }
  ws.send(data, { binary: !!isBinary });

  if (data === "ping") {
    console.error("Sending ping");
    ws.ping();
  } else if (data === "pong") {
    console.error("Sending pong");
    ws.pong();
  } else if (data === "close") {
    console.error("Sending close");
    ws.close();
  } else if (data === "terminate") {
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

ws.on("error", error => {
  console.error("Received error:", error);
});

ws.on("close", (code, reason, wasClean) => {
  if (wasClean === true) {
    console.error("Received abrupt close:", code, reason);
  } else {
    console.error("Received close:", code, reason);
  }
});

ws.on("redirect", url => {
  console.error("Received redirect:", url);
});

ws.on("unexpected-response", (_, response) => {
  console.error("Received unexpected response:", response.statusCode, { ...response.headers });
});
