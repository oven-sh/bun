// An 'upgrade' listener pauses a request that has a body, reads the upgrade socket, writes more than
// the client reads, and destroys the request. The TLS write has spilled, so the close of the socket is
// deferred and the socket is still open when the parser finishes the read that carried the request.
// Prints "ok" when the server survived that.
const https = require("node:https");
const tls = require("node:tls");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");

const keys = path.join(__dirname, "..", "test", "fixtures", "keys");
const server = https.createServer({
  key: fs.readFileSync(path.join(keys, "agent1-key.pem")),
  cert: fs.readFileSync(path.join(keys, "agent1-cert.pem")),
});

const { promise: serverSocketClosed, resolve: onServerSocketClosed } = Promise.withResolvers();
const { promise: destroyed, resolve: onDestroyed } = Promise.withResolvers();
server.on("upgrade", (req, socket) => {
  req.pause();
  req.on("error", () => {});
  socket.on("error", () => {});
  socket.on("close", onServerSocketClosed);
  socket.on("data", () => {});
  socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: test\r\nConnection: Upgrade\r\n\r\n");
  // Far more than the socket buffers hold: the client does not read.
  socket.write(Buffer.alloc(16 * 1024 * 1024, "x"));
  req.destroy();
  onDestroyed();
});

(async () => {
  await once(server.listen(0, "127.0.0.1"), "listening");
  const client = tls.connect({ port: server.address().port, host: "127.0.0.1", rejectUnauthorized: false });
  client.on("error", () => {});
  await once(client, "secureConnect");
  client.pause();
  client.write(
    "POST /upgrade HTTP/1.1\r\nHost: a\r\nConnection: Upgrade\r\nUpgrade: test\r\nContent-Length: 10\r\n\r\n01234",
  );
  await destroyed;
  // The parser finishes the read only after the listener returned. The close of the server's socket
  // comes later still: it waits for the spilled bytes, or for the reset this destroy() causes.
  client.destroy();
  await serverSocketClosed;
  server.close();
  console.log("ok");
})();
