// tls.connect({ socket }) on a socket that has already finished writing. The upgrade is refused, so
// the TLSSocket reports an error and closes. It must emit 'close' once, like Node, not once for the
// error and again when the stream it wraps tears down. Three peers: one silent, one that replies to
// the FIN, one that ends. Prints one JSON line of the counts.
//
// The assertion is that no second 'close' arrives, so this waits a fixed time for one. There is no
// event to await for an event that must not happen.
"use strict";
const net = require("node:net");
const tls = require("node:tls");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const counts = {};
  for (const peer of ["silent", "replies", "ends"]) {
    const server = net.createServer({ allowHalfOpen: true }, connection => {
      connection.on("error", () => {});
      connection.on("end", () => {
        if (peer === "replies") connection.write("REPLY");
        if (peer === "ends") connection.end();
      });
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

    const raw = net.connect({ port: server.address().port, host: "127.0.0.1", allowHalfOpen: true });
    raw.on("error", () => {});
    await new Promise(resolve => raw.on("connect", resolve));
    raw.end();
    await new Promise(resolve => raw.on("finish", resolve));

    let closes = 0;
    const tlsSocket = tls.connect({ socket: raw, host: "127.0.0.1" });
    tlsSocket.on("error", () => {});
    tlsSocket.on("close", () => closes++);

    await sleep(800);
    raw.destroy();
    tlsSocket.destroy();
    server.close();
    await sleep(100);
    counts[peer] = closes;
  }
  console.log(JSON.stringify(counts));
  process.exit(0);
})();
