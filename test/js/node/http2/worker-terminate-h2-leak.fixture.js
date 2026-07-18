"use strict";
// Worker body for node-http2.test.js "terminating a worker mid-stream releases the H2 parser's
// native allocations": create a server+client H2 session over a JS duplex pair, drive requests
// in a loop, and ask the parent to terminate() us while both parsers are live. Across many
// workers the terminate() lands at arbitrary points in the inbound dispatch path.
const http2 = require("http2");
const { duplexPair } = require("stream");
const { parentPort } = require("worker_threads");

const server = http2.createServer();
let seen = 0;
server.on("stream", stream => {
  if (seen++ === 1) parentPort.postMessage("terminate");
  stream.end("");
});

const [clientSide, serverSide] = duplexPair();
server.emit("connection", serverSide);
const client = http2.connect("http://localhost:80", { createConnection: () => clientSide });

function go() {
  for (let i = 0; i < 3; i++) client.request().end();
  setImmediate(go);
}
go();
