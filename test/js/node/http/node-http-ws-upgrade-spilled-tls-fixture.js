// Four TLS connections hand their response socket to `ws` after a write that the client does not
// read. The first connection's ciphertext does not fit the kernel buffer and parks in the loop's
// one spill slot. The writes of the connections behind it are therefore not batched, so BoringSSL
// parks a record for them, and the short header writes of their 101 fail with BAD_WRITE_RETRY.
// That marks those sockets shut down, and uWS refuses to adopt a shut down socket.
// Prints "ok" when the server survived the close of every socket.
const https = require("node:https");
const tls = require("node:tls");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");
const { WebSocketServer } = require("ws");

const CONNECTIONS = 3;
// More than the kernel takes for a socket whose peer does not read, so the write blocks part way.
const BODY = Buffer.alloc(4 * 1024 * 1024, "x");
const REQUEST =
  "GET / HTTP/1.1\r\nHost: a\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n" +
  "Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n";

const keys = path.join(__dirname, "..", "test", "fixtures", "keys");
const server = https.createServer({
  key: fs.readFileSync(path.join(keys, "ec-key.pem")),
  cert: fs.readFileSync(path.join(keys, "ec-cert.pem")),
});
const wss = new WebSocketServer({ noServer: true });

let upgraded = 0;
let refused = 0;
let serverSocketsClosed = 0;
let guardThrew = null;
const { promise: allHandled, resolve: onAllHandled } = Promise.withResolvers();

server.on("request", (req, res) => {
  res.on("error", () => {});
  req.socket.on("error", () => {});
  req.socket.on("close", () => serverSocketsClosed++);
  res.write(BODY);
  let accepted = false;
  wss.handleUpgrade(req, req.socket, Buffer.alloc(0), ws => {
    accepted = true;
    ws.on("error", () => {});
    ws.on("close", () => serverSocketsClosed++);
    ws.on("message", () => {});
  });
  if (accepted) upgraded++;
  else {
    refused++;
    // The usual "finish it if nobody did" guard of a 'request' listener. A refused upgrade must
    // leave the response endable, not half-closed underneath it.
    try {
      if (!res.writableEnded && !res.destroyed) res.end();
    } catch (error) {
      guardThrew = error.code || String(error);
    }
  }
  if (upgraded + refused === CONNECTIONS) onAllHandled();
});
server.on("clientError", (err, socket) => socket.destroy());

(async () => {
  await once(server.listen(0, "127.0.0.1"), "listening");
  const port = server.address().port;

  // Finish every handshake first, then send all the requests in one tick: the server reads them in
  // one event loop iteration, so the spill of the first connection is still held when the next one
  // writes. Without that the first connection drains its spill before the next request arrives.
  const clients = await Promise.all(
    Array.from({ length: CONNECTIONS }, async () => {
      const client = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
      client.on("error", () => {});
      await once(client, "secureConnect");
      client.pause();
      return client;
    }),
  );
  for (const client of clients) client.write(REQUEST);
  await allHandled;

  for (const client of clients) client.destroy();
  // The crash is in the close dispatch of the server's sockets, so wait for them.
  const deadline = Date.now() + 1500;
  while (serverSocketsClosed < CONNECTIONS && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  server.close();
  console.log(JSON.stringify({ ok: true, upgraded, refused, guardThrew }));
  process.exit(0);
})();
