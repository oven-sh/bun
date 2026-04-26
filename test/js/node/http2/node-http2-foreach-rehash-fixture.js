// Reproduces a use-after-free in H2FrameParser.forEachStream(): the raw
// HashMap valueIterator() was held across a JS callback. When the session
// socket times out, #onTimeout() calls parser.forEachStream(emitTimeout),
// which emits 'timeout' on every open stream. If a 'timeout' listener calls
// session.request(), that reaches handleReceivedStreamID() -> streams.getOrPut(),
// which can grow/rehash the hashmap and free the backing storage the iterator
// is still pointing at. Under ASAN this is a heap-use-after-free.
"use strict";

const http2 = require("node:http2");
const { once } = require("node:events");

const server = http2.createServer();
// Never respond so streams stay open and the socket goes idle.
server.on("stream", () => {});

server.listen(0, async () => {
  const port = server.address().port;
  const client = http2.connect(`http://localhost:${port}`);
  client.on("error", () => {});
  await once(client, "connect");

  // Create enough streams to put the parser's stream hashmap near/over its
  // grow threshold, so that adding more from inside the iteration forces a
  // rehash while the raw iterator is still live.
  const INITIAL_STREAMS = 24;
  const streams = [];
  for (let i = 0; i < INITIAL_STREAMS; i++) {
    const req = client.request({ ":path": "/", ":method": "POST" });
    req.on("error", () => {});
    // Inside forEachStream's callback: add more streams to force a rehash.
    req.on("timeout", () => {
      for (let j = 0; j < 4; j++) {
        try {
          const extra = client.request({ ":path": "/", ":method": "POST" });
          extra.on("error", () => {});
        } catch {}
      }
    });
    streams.push(req);
  }

  // Arm the socket inactivity timeout; when it fires, #onTimeout() runs
  // parser.forEachStream(emitTimeout) over all open streams.
  const fired = once(client, "timeout");
  client.setTimeout(50);
  await fired;

  // Give any additional iterator steps a chance to run before shutting down.
  await new Promise(resolve => setImmediate(resolve));

  client.destroy();
  server.close(() => {
    console.log("OK");
    process.exit(0);
  });
});
