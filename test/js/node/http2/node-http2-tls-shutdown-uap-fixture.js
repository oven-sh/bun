// Reproduces the use-after-poison in TLSSocket onHandshake/onClose that fires
// during VM teardown when the parent Listener has already been finalized.
//
// The process intentionally throws from every server 'stream' handler so the
// VM exits with live TLS connections. With BUN_DESTRUCT_VM_ON_EXIT=1 the GC
// runs finalizers in heap-layout order; with enough concurrent listeners some
// Listener cells land in blocks swept before their child TLSSocket cells, and
// `Listener.deinit()`'s clean-shutdown `ctx.close()` (code 0) can leave the
// underlying TCP socket open waiting for the peer's close_notify. The later
// `TLSSocket.finalize()` force-close then re-enters the Zig `onHandshake` /
// `onClose` callbacks with `handlers` pointing into the freed Listener.
"use strict";
const h2 = require("http2");
const tls = require("tls");
const path = require("path");
const fs = require("fs");

const keysDir = process.env.KEYS_DIR;
const key = fs.readFileSync(path.join(keysDir, "agent1-key.pem"));
const cert = fs.readFileSync(path.join(keysDir, "agent1-cert.pem"));
const ca = fs.readFileSync(path.join(keysDir, "ca1-cert.pem"));

const N = parseInt(process.env.N || "30", 10);

for (let i = 0; i < N; i++) {
  const server = h2.createSecureServer({ cert, key });
  server.on("stream", () => {
    // Uncaught exception -> process begins exiting while connections are live.
    throw new Error("boom " + i);
  });
  server.listen(0, () => {
    const client = h2.connect(`https://localhost:${server.address().port}`, {
      secureContext: tls.createSecureContext({ ca }),
      servername: "agent1",
    });
    client.on("error", () => {});
    const req = client.request();
    req.on("error", () => {});
    req.on("close", () => {});
  });
}
