"use strict";
// Reproduces a use-after-free in H2FrameParser.Stream.flushQueue: the defer
// block dispatched the write callback (user JS) and then continued to
// dereference the *Stream pointer, which points into the streams HashMap's
// backing storage. If the callback creates new streams (session.request()),
// the HashMap can grow/rehash and invalidate that pointer.
//
// Under ASAN this manifests as heap-use-after-free when flushQueue reads
// stream state after the callback returns.

const http2 = require("node:http2");

const server = http2.createServer();
server.on("stream", (stream, headers) => {
  stream.respond({ ":status": 200 });
  // Drain the request body so the server sends WINDOW_UPDATE frames, which
  // trigger the client's flushStreamQueue path.
  stream.on("data", () => {});
  stream.on("end", () => {
    stream.end("ok");
  });
  stream.on("error", () => {});
});

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  const client = http2.connect(`http://127.0.0.1:${port}`);
  client.on("error", err => {
    console.error("client error", err);
    process.exit(1);
  });

  const extras = [];
  let rehashed = false;
  let writeCallbackFired = false;

  client.on("connect", () => {
    const req = client.request({ ":method": "POST", ":path": "/" }, { endStream: false });
    req.on("error", () => {});
    req.on("response", () => {});
    req.on("data", () => {});
    req.on("close", () => {
      finish();
    });

    // Write a payload larger than the default initial window size (65535)
    // so the tail of it is queued by the native frame parser and later
    // flushed from flushStreamQueue -> Stream.flushQueue.
    const payload = Buffer.alloc(128 * 1024, "a");
    req.write(payload, () => {
      writeCallbackFired = true;
      if (rehashed) return;
      rehashed = true;
      // Create many new streams synchronously from inside the write
      // callback. Each request() calls native getNextStream()/request(),
      // which inserts into the streams HashMap and can trigger a rehash,
      // invalidating the *Stream pointer that flushQueue is still holding
      // in its defer block.
      for (let i = 0; i < 100; i++) {
        try {
          const r = client.request({ ":method": "GET", ":path": "/extra" });
          r.on("error", () => {});
          r.on("response", () => {});
          r.on("data", () => {});
          r.on("end", () => {});
          extras.push(r);
        } catch {}
      }
    });
    req.end();
  });

  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    if (!writeCallbackFired) {
      console.error("write callback never fired");
      process.exit(1);
    }
    try {
      client.close();
    } catch {}
    try {
      client.destroy();
    } catch {}
    server.close(() => {
      console.log("ok");
      process.exit(0);
    });
    // Force exit in case close() hangs waiting on the extra streams.
    setTimeout(() => {
      console.log("ok");
      process.exit(0);
    }, 500).unref();
  }
});
