"use strict";
// When an http.Agent creates a new socket it wraps the connect callback in
// the internal once() helper and hands that wrapper to createConnection().
// The wrapped callback closes over `cb`, which is onSocketCreated bound to
// the ClientRequest. JSC is a conservative collector, so a stale stack word
// that happens to look like the wrapper keeps it (and the request it was
// created for) alive for as long as the keep-alive socket sits in the free
// pool. This fixture makes that retention deterministic by holding the
// wrapper explicitly and then asserting every ClientRequest is still
// collectable once the wrapper has fired.
const http = require("http");

const server = http
  .createServer((req, res) => {
    res.writeHead(200);
    res.end("ok");
  })
  .listen(0, run);

const heldWrappers = [];
const total = 4;
let collected = 0;
const registry = new FinalizationRegistry(() => {
  collected++;
});

function run() {
  const port = server.address().port;
  const agent = new http.Agent({ keepAlive: true });

  const originalCreateConnection = agent.createConnection;
  agent.createConnection = function (options, oncreate) {
    heldWrappers.push(oncreate);
    return originalCreateConnection.call(this, options, oncreate);
  };

  for (let i = 0; i < total; i++) {
    const req = http.get({ hostname: "localhost", port, agent }, res => res.resume());
    registry.register(req);
  }

  let iters = 0;
  setImmediate(function status() {
    global.gc();
    iters++;
    if (collected === total) {
      console.log("collected " + collected + "/" + total);
      server.close();
      agent.destroy();
      return;
    }
    if (iters > 50) {
      console.log("stuck " + collected + "/" + total + " (holding " + heldWrappers.length + " wrappers)");
      process.exit(1);
    }
    setImmediate(status);
  });
}
