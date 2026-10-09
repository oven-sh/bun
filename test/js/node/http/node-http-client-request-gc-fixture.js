"use strict";
// Hold the once() wrapper that _http_agent.createSocket passes to
// createConnection and assert every ClientRequest is still collectable.
const http = require("http");

const server = http
  .createServer((req, res) => {
    res.writeHead(200);
    res.end("ok");
  })
  .listen(0, "127.0.0.1", run);

const heldWrappers = [];
const total = 4;
let done = 0;
let collected = 0;
const registry = new FinalizationRegistry(() => {
  collected++;
});

function run() {
  const port = server.address().port;
  const agent = new http.Agent({ keepAlive: true });

  const originalCreateConnection = agent.createConnection;
  agent.createConnection = function (options, oncreate) {
    if (typeof oncreate === "function") heldWrappers.push(oncreate);
    return originalCreateConnection.call(this, options, oncreate);
  };

  for (let i = 0; i < total; i++) {
    const req = http.get({ hostname: "127.0.0.1", port, agent }, res => {
      res.resume();
      res.on("close", () => done++);
    });
    req.on("error", err => {
      console.error(err);
      process.exit(1);
    });
    registry.register(req);
  }

  let iters = 0;
  setImmediate(function status() {
    if (done < total) return setImmediate(status);
    global.gc();
    iters++;
    if (collected === total) {
      console.log("collected " + collected + "/" + total + " holding " + heldWrappers.length + " wrappers");
      server.close();
      agent.destroy();
      return;
    }
    if (iters > 50) {
      console.log("stuck " + collected + "/" + total + " holding " + heldWrappers.length + " wrappers");
      process.exit(1);
    }
    setImmediate(status);
  });
}
