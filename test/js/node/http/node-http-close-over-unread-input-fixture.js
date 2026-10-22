// A connection closes while bytes of the client wait unread in the kernel, because the server
// stopped the reads of the connection before they came. The kernel turns a close over unread
// input into a reset, and a reset throws away the output that the kernel has not sent yet.
//
// usage: <tcp|tls|unix> <mode> [path of the unix socket]
// Prints one JSON line. Node.js runs this file too, and gives the same line in the cells of the test.
const { once } = require("node:events");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const path = require("node:path");
const tls = require("node:tls");

const [transport, mode, socketPath] = process.argv.slice(2);
const isTLS = transport === "tls";
const keys = path.join(__dirname, "..", "test", "fixtures", "keys");

const events = [];
process.on("uncaughtException", err => events.push(`uncaught: ${err.message}`));

const post = (url, length) => `POST ${url} HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${length}\r\n\r\n`;
// More than a socket buffer takes at once, so it backs up while the client does not read.
const bigLength = 8 * 1024 * 1024;
const big = Buffer.alloc(bigLength, "x");
// Over tcp and tls it takes more than one read to drop this. The buffer of a unix socket holds 8 KiB on macOS.
const lateLength = transport === "unix" ? 6000 : 40000;

// A 'connection' listener wrote `big` to the socket, so the output is backed up when the request
// is dispatched. That stops the reads. `late` is what the client sends after that. With `fin`
// the client also ends its side there.
const modes = {
  // socket.end() waits for the raw write, then the connection closes.
  "socket-end": { request: post("/first", lateLength), late: Buffer.alloc(lateLength, "h") },
  // The dispatch throws. Only the FIN of the client waits (over TLS, behind its close_notify).
  "client-fin-only": { request: post("/first", 5), late: "", fin: true },
};

(async () => {
  const { request, late, fin } = modes[mode];
  const dispatched = Promise.withResolvers();

  const options = isTLS
    ? {
        key: fs.readFileSync(path.join(keys, "agent1-key.pem")),
        cert: fs.readFileSync(path.join(keys, "agent1-cert.pem")),
      }
    : {};
  const server = (isTLS ? https : http).createServer(options, req => {
    req.on("error", () => {});
    events.push(`request ${req.url}`);
    dispatched.resolve();
    if (mode === "socket-end") return void req.socket.end();
    throw new Error("first threw");
  });
  server.on(isTLS ? "secureConnection" : "connection", socket => {
    socket.on("error", () => {});
    socket.write(big);
  });
  await once(server.listen(transport === "unix" ? socketPath : { port: 0, host: "127.0.0.1" }), "listening");

  const address = transport === "unix" ? { path: socketPath } : { port: server.address().port, host: "127.0.0.1" };
  const client = isTLS ? tls.connect({ ...address, rejectUnauthorized: false }) : net.connect(address);
  client.pause();
  // How the connection ended for the client: "end", or the code of its error.
  let end = "none";
  let bigBytes = 0;
  let bigIntact = true;
  let rest = "";
  const closed = Promise.withResolvers();
  client.on("error", err => (end = err.code));
  client.on("end", () => (end = "end"));
  client.on("close", closed.resolve);
  client.on("data", chunk => {
    // One chunk for each turn of the event loop. The kernel of the server then still holds
    // unsent bytes when the server closes, and a reset would throw them away.
    client.pause();
    setImmediate(() => client.resume());
    const bigPart = Math.min(chunk.length, bigLength - bigBytes);
    bigIntact &&= chunk.subarray(0, bigPart).equals(big.subarray(0, bigPart));
    bigBytes += bigPart;
    rest += chunk.toString("latin1", bigPart);
  });
  await once(client, isTLS ? "secureConnect" : "connect");

  client.write(request);
  await dispatched.promise;
  // The server has stopped the reads by now: these bytes stay in its kernel.
  await new Promise(resolve => (fin ? client.end(late, resolve) : client.write(late, resolve)));
  client.resume();
  await closed.promise;

  client.destroy();
  server.close();
  server.closeAllConnections();
  console.log(
    JSON.stringify({
      mode,
      events,
      big: bigBytes === bigLength && bigIntact ? "all" : bigBytes,
      rest,
      end,
    }),
  );
})();
