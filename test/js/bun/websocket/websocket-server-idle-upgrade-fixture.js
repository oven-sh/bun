// One TLS connection to Bun.serve. The fetch handler awaits, the server's idle timeout ends the
// connection meanwhile, and the handler then calls server.upgrade(req). A TLS shutdown leaves the
// socket in the shut down state while it waits for the peer's close_notify, and uWS refuses to
// adopt such a socket. server.upgrade() has to report that instead of opening a ServerWebSocket on
// it. Prints one JSON line.
const tls = require("node:tls");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");

const keys = path.join(__dirname, "..", "..", "node", "test", "fixtures", "keys");
const connectionEnded = Promise.withResolvers();
const handled = Promise.withResolvers();
let upgradeResult;
let abortedBeforeUpgrade;
let opened = 0;

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  idleTimeout: 1,
  tls: {
    key: fs.readFileSync(path.join(keys, "ec-key.pem")),
    cert: fs.readFileSync(path.join(keys, "ec-cert.pem")),
  },
  async fetch(req, server) {
    await connectionEnded.promise;
    abortedBeforeUpgrade = req.signal.aborted;
    upgradeResult = server.upgrade(req);
    handled.resolve();
    if (upgradeResult) return;
    return new Response("no", { status: 400 });
  },
  websocket: {
    open() {
      opened++;
    },
    message() {},
    close() {},
  },
});

(async () => {
  // allowHalfOpen: the client must not answer the server's close_notify, or its reply closes the
  // socket outright and the upgrade never sees the shut down state.
  const client = tls.connect({
    port: server.port,
    host: "127.0.0.1",
    rejectUnauthorized: false,
    allowHalfOpen: true,
  });
  client.on("error", () => {});
  await once(client, "secureConnect");
  client.write(
    "GET /ws HTTP/1.1\r\nHost: a\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n" +
      "Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
  );
  client.resume();
  await once(client, "end");
  connectionEnded.resolve();
  await handled.promise;

  client.destroy();
  // The crash was in the close dispatch of the server's socket.
  const deadline = Date.now() + 2000;
  while (server.pendingWebSockets > 0 && Date.now() < deadline) await Bun.sleep(10);

  console.log(
    JSON.stringify({
      ok: true,
      abortedBeforeUpgrade,
      upgradeResult,
      opened,
      pendingWebSockets: server.pendingWebSockets,
    }),
  );
  process.exit(0);
})();
