// A server accepts one Upgrade request that declares a 100-byte body. The client sends a part of that body and ends.
// Nothing reads the request or the upgrade socket. The JSON in argv[2] says what the client sends and what the 'upgrade'
// listener does. Prints `events` (what the upgrade socket and the server emitted, in order) and `received` (how many
// bytes the client got) when the process exits. Also runs in Node.js.
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const tls = require("node:tls");
const fs = require("node:fs");
const path = require("node:path");

const {
  // How many bytes of the body the client sends. 100 is the whole body.
  sent = 7,
  chunked = false,
  // The client ends in the write that carries the head. Otherwise it ends when the listener has run.
  finWithHead = false,
  secure = false,
  // The path of a unix socket to listen on.
  unix,
  httpAllowHalfOpen = false,
  // The listener writes this many bytes to the upgrade socket.
  queued = 0,
  // The client ends when it has them all.
  finAfterQueued = false,
  // The listener pauses the upgrade socket.
  pause = false,
  // What the listener does in 'end' of the upgrade socket: "write", "end" or nothing.
  inEnd = "write",
} = JSON.parse(process.argv[2]);

const keys = path.join(__dirname, "..", "test", "fixtures", "keys");
const server = (secure ? https : http).createServer({
  httpAllowHalfOpen,
  ...(secure && {
    key: fs.readFileSync(path.join(keys, "agent1-key.pem")),
    cert: fs.readFileSync(path.join(keys, "agent1-cert.pem")),
  }),
});

const events = [];
let received = 0;
let client;
process.on("exit", () => console.log(JSON.stringify({ events, received })));
const settled = name => err => events.push(`${name}: ${err ? err.code : "sent"}`);

server.on("clientError", err => events.push(`clientError: ${err.code}`));
server.on("upgrade", (req, socket) => {
  // The callback runs when the connection has closed.
  server.close(() => events.push("server close"));
  socket.on("error", err => events.push(`socket error: ${err.code}`));
  socket.on("finish", () => events.push("socket finish"));
  socket.on("close", () => events.push("socket close"));
  socket.on("end", () => {
    events.push(`socket end, writable: ${socket.writable}`);
    if (inEnd === "write") socket.write("late", settled("late write"));
    if (inEnd === "end") socket.end();
  });
  if (pause) socket.pause();
  if (queued) socket.write(Buffer.alloc(queued, "x"), settled("queued write"));
  if (!finWithHead && !finAfterQueued) client.end();
});

server.listen(unix ?? 0, () => {
  const framing = chunked ? "Transfer-Encoding: chunked" : "Content-Length: 100";
  // Chunked: one chunk of 100 bytes.
  const body = (chunked ? "64\r\n" : "") + Buffer.alloc(sent, "B").toString() + (chunked && sent === 100 ? "\r\n0\r\n\r\n" : "");
  const request = `POST /upgrade HTTP/1.1\r\nHost: a\r\nConnection: Upgrade\r\nUpgrade: test\r\n${framing}\r\n\r\n${body}`;
  const target = unix ? { path: unix } : { port: server.address().port, host: "127.0.0.1" };
  const options = { ...target, allowHalfOpen: true, rejectUnauthorized: false };
  client = (secure ? tls : net).connect(options, () => (finWithHead ? client.end(request) : client.write(request)));
  client.on("error", () => {});
  // The client holds the process only until it has the bytes that the listener queued: a run in which the server
  // never closes the socket ends too.
  if (!queued) client.unref();
  client.on("data", chunk => {
    const before = received;
    received += chunk.length;
    if (before < queued && received >= queued) {
      if (finAfterQueued) client.end();
      client.unref();
    }
  });
});
