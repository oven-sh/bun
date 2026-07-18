"use strict";
// Worker body for the "terminate during native property iteration" leak test. Drive
// an http2 client/server over a JS duplex pair so each tick calls the native
// header-encode path (which walks the headers object via the C++ JSPropertyIterator),
// then ask the parent to terminate() us while that is in flight.
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
