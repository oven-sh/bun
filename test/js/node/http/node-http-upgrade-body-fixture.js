// A server accepts one Upgrade request that has a 100-byte body. The JSON in argv[2] says what the client sends and
// what the 'upgrade' listener does when it has read the last chunk. Prints `events` (what the request and the upgrade
// socket emitted, in order), `eofs` (how many times the request got its EOF after the listener ran) and `upgrade`
// (what the listener got). Also runs in Node.js.
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const tls = require("node:tls");
const fs = require("node:fs");
const path = require("node:path");

const {
  // "data" or "readable": the event the listener reads the request with.
  read = "data",
  // What the listener does inside the last chunk.
  act,
  // The second half of the body comes in a later read than the head.
  split = false,
  secure = false,
  // The client sends this after the server's FIN, as bytes of the tunnel.
  tunnelBytes = "",
  // The listener reads the upgrade socket and writes more to it than a client that does not read takes.
  spill = false,
  // "throws": the listener ends the socket and throws. "none": shouldUpgradeCallback accepts the request, and no
  // listener takes it.
  listener = "reads",
} = JSON.parse(process.argv[2]);

const keys = path.join(__dirname, "..", "test", "fixtures", "keys");
const server = (secure ? https : http).createServer(
  secure
    ? {
        key: fs.readFileSync(path.join(keys, "agent1-key.pem")),
        cert: fs.readFileSync(path.join(keys, "agent1-cert.pem")),
      }
    : {},
);

const body = Buffer.alloc(100, "B").toString();
const events = [];
let eofs = 0;
let upgrade;
let client;
const serverSocketClosed = Promise.withResolvers();
const clientClosed = Promise.withResolvers();
process.on("uncaughtException", err => events.push(`uncaughtException: ${err.message}`));

function letGo(req, socket) {
  switch (act) {
    case "req.destroy()":
      return void req.destroy();
    case "req.destroy(err)":
      return void req.destroy(new Error("stop"));
    case "socket.destroy() then req.destroy()":
      socket.destroy();
      return void req.destroy();
    case "req.destroy() then throw":
      req.destroy();
      throw new Error("listener threw");
    case "socket.destroy()":
      return void socket.destroy();
    case "socket.resetAndDestroy()":
      return void socket.resetAndDestroy();
    case "socket.destroySoon()":
      return void socket.destroySoon();
    case "socket.end()":
      return void socket.end();
    default:
      throw new Error(`unknown act: ${act}`);
  }
}

function onUpgrade(req, socket, head) {
  upgrade = { head: head.length, complete: req.complete, readableLength: req.readableLength };
  const push = req.push;
  req.push = function (chunk) {
    if (chunk === null) eofs++;
    return push.apply(this, arguments);
  };
  for (const name of ["aborted", "end", "close"]) req.on(name, () => events.push(`req ${name}`));
  req.on("error", err => events.push(`req error: ${err.message}`));
  socket.on("error", err => events.push(`socket error: ${err.message}`));
  socket.on("end", () => events.push("socket end"));
  socket.on("close", () => {
    events.push("socket close");
    serverSocketClosed.resolve();
  });
  if (listener === "throws") {
    socket.end();
    throw new Error("listener threw");
  }
  if (tunnelBytes) socket.on("data", chunk => events.push(`socket data ${chunk.length}`));
  if (spill) {
    socket.on("data", () => {});
    socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n");
    socket.write(Buffer.alloc(16 * 1024 * 1024, "x"));
  }

  let received = 0;
  function onChunk(chunk) {
    events.push(`req ${read} ${chunk.length}`);
    received += chunk.length;
    if (received < body.length) {
      // In a later turn of the event loop than the read that carried the first half.
      return void setImmediate(() => client.write(body.slice(received)));
    }
    // The close of a socket with spilled bytes waits for them, or for the reset that this causes.
    if (spill) process.nextTick(() => client.destroy());
    letGo(req, socket);
  }
  if (read === "data") {
    req.on("data", onChunk);
  } else {
    req.on("readable", () => {
      const chunk = req.read();
      if (chunk !== null) onChunk(chunk);
    });
  }
}
if (listener === "none") {
  server.shouldUpgradeCallback = () => true;
  server.on("connection", socket => socket.on("close", serverSocketClosed.resolve));
} else {
  server.on("upgrade", onUpgrade);
}

server.listen(0, "127.0.0.1", () => {
  const options = { port: server.address().port, host: "127.0.0.1", allowHalfOpen: tunnelBytes !== "" };
  client = secure ? tls.connect({ ...options, rejectUnauthorized: false }) : net.connect(options);
  client.on("error", () => {});
  client.on("close", clientClosed.resolve);
  if (spill) client.pause();
  else client.resume();
  if (tunnelBytes) client.on("end", () => client.end(tunnelBytes));
  client.on(secure ? "secureConnect" : "connect", () => {
    client.write(
      `POST /upgrade HTTP/1.1\r\nHost: a\r\nConnection: Upgrade\r\nUpgrade: test\r\nContent-Length: ${body.length}\r\n\r\n` +
        (split ? body.slice(0, 50) : body),
    );
  });
});

Promise.all([serverSocketClosed.promise, clientClosed.promise]).then(() => {
  server.close();
  // One more turn: an event that follows the close of the socket is part of the result.
  setImmediate(() => console.log(JSON.stringify({ events, eofs, upgrade })));
});
