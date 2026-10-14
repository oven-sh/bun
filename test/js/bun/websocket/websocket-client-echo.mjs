// Echoes every message, ping and pong back to the server. websocket-server.test.ts spawns ~90 of
// these per run, so start-up has to stay minimal: it deliberately uses the built-in WebSocket and
// no module on top of it ("ws" and the modules it pulls in cost ~1.6s per client on a debug build).
let url;
try {
  url = new URL(process.argv[2]);
} catch {
  throw new Error(`Usage: ${process.argv0} websocket-client-echo.mjs <url>`);
}

const ws = new WebSocket(url, {
  perMessageDeflate: false,
});
ws.binaryType = "nodebuffer";

ws.addEventListener("open", () => {
  if (process.send) {
    process.send("connected");
  }
});

const logMessages = process.env.LOG_MESSAGES === "1";
ws.addEventListener("message", ({ data }) => {
  if (logMessages) {
    console.error(typeof data === "string" ? "Received text message:" : "Received binary message:", data);
  }
  // data is a string for text frames and a Buffer for binary frames, so send() echoes the same frame type.
  ws.send(data);
});

ws.addEventListener("ping", ({ data }) => {
  console.error("Received ping:", data);
  ws.ping(data);
});

ws.addEventListener("pong", ({ data }) => {
  console.error("Received pong:", data);
  ws.pong(data);
});

ws.addEventListener("error", ({ error, message }) => {
  console.error("Received error:", error ?? message);
});

ws.addEventListener("close", ({ code, reason, wasClean }) => {
  console.error(wasClean ? "Received close:" : "Received abrupt close:", code, reason);
});
