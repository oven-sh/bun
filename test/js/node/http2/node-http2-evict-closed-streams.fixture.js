// Asserts that completed HTTP/2 streams are removed from the native session
// map instead of accumulating until connection teardown. Without eviction a
// long-lived keep-alive connection retains one native Stream allocation per
// completed request on both the client and the server parser, which both
// retains memory and eventually trips the maxSessionMemory cap for a
// well-behaved sequential client.
//
// Runs in its own process because the live-stream gauge is process-global.
"use strict";

const http2 = require("node:http2");
const { once } = require("node:events");
const { nodeHttp2Internals } = require("bun:internal-for-testing");

const ROUNDS = 50;

// Exercise both server completion shapes:
// - respond() + end(body): END_STREAM goes out on a DATA frame (sendData path)
// - respond({ endStream: true }) from an async continuation: END_STREAM goes
//   out on the HEADERS frame itself (request() path)
const server = http2.createServer();
server.on("stream", (stream, headers) => {
  if (headers[":path"] === "/empty") {
    // Async so the native request() sees HALF_CLOSED_REMOTE rather than the
    // synchronous-from-'stream'-event OPEN state.
    setImmediate(() => {
      if (stream.destroyed) return;
      stream.respond({ ":status": 204 }, { endStream: true });
    });
  } else {
    stream.respond({ ":status": 200 });
    stream.end("ok");
  }
});

server.listen(0, async () => {
  const port = server.address().port;
  const client = http2.connect(`http://localhost:${port}`);
  client.on("error", err => {
    console.error("client error", err);
    process.exit(1);
  });
  await once(client, "connect");

  for (let i = 0; i < ROUNDS; i++) {
    const path = i % 2 === 0 ? "/body" : "/empty";
    const req = client.request({ ":path": path });
    req.resume();
    req.end();
    await once(req, "close");
  }

  // Let the trailing setImmediate(rstNextTick) host-fn calls (scheduled from
  // each stream's _destroy) run their depth-0 sweep on both parsers.
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  console.log(nodeHttp2Internals.liveStreamCount());

  client.close();
  server.close(() => {
    process.exit(0);
  });
});
