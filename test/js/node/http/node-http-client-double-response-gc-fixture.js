"use strict";
// A server that sends a valid response then writes a second raw status line
// on the kept-alive socket. The client's double-response branch destroys the
// socket; the request must still become collectable. Several requests so a
// single conservatively-retained one cannot pass or fail the run on its own.
const http = require("http");
const assert = require("assert");

const server = http
  .createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ hello: "world" }));
    req.socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
  })
  .listen(0, "127.0.0.1", run);

const total = 8;
const refs = [];
let done = 0;
let destroyed = 0;

function issue(port) {
  let sock;
  const req = http.get({ hostname: "127.0.0.1", port }, res => {
    const chunks = [];
    res.on("data", c => chunks.push(c));
    res.on("end", () => {
      assert.strictEqual(JSON.parse(Buffer.concat(chunks)).hello, "world");
    });
  });
  req.on("socket", s => (sock = s));
  req.on("close", () => {
    done++;
    // The double-response branch's only observable effect is socket.destroy();
    // on the plain keep-alive path the socket is still writable and pooled.
    if (sock?.destroyed) destroyed++;
  });
  return new WeakRef(req);
}

function run() {
  const port = server.address().port;
  for (let i = 0; i < total; i++) refs.push(issue(port));

  let iters = 0;
  setImmediate(function status() {
    if (++iters > 200) {
      console.log("stuck done=" + done + " destroyed=" + destroyed);
      process.exit(1);
    }
    if (done < total) return setImmediate(status);
    Bun.gc(true);
    const collected = refs.reduce((n, r) => n + (r.deref() === undefined ? 1 : 0), 0);
    // A hard retention path would keep all of them. JSC's conservative stack
    // scan can hold one or two via a stale register/slot; that is not a leak.
    if (collected >= total - 2) {
      console.log("collected " + collected + "/" + total + " destroyed " + destroyed + "/" + total);
      server.close();
      return;
    }
    setImmediate(status);
  });
}
