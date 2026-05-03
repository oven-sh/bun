"use strict";
// Reproduces a use-after-free in H2FrameParser.Stream.flushQueue when the
// parser is using the non-native (JS onWrite) write path.
//
// flushQueue used to peekFront() a *PendingFrame and then call
// dataHeader.write(writer). With a non-native socket that write() reaches
// _write() -> JS onWrite -> socket.write(), which runs user JS
// synchronously. If that JS calls rstStream() on the stream being flushed,
// endStream -> freeResources -> cleanQueue frees every queued frame.buffer
// and replaces dataFrameQueue with an empty one. flushQueue would then read
// the freed buffer and finally unwrap null from dequeue().?.
//
// Under ASAN this is a heap-use-after-free; without ASAN it's a panic on the
// null unwrap.

const http2 = require("node:http2");
const net = require("node:net");
const { Duplex } = require("node:stream");

const kNative = Symbol.for("::bunhttp2native::");

const server = http2.createServer();
server.on("stream", stream => {
  stream.respond({ ":status": 200 });
  // Drain the body so the server sends WINDOW_UPDATE, which triggers the
  // client's flushStreamQueue -> Stream.flushQueue path.
  stream.on("data", () => {});
  stream.on("end", () => stream.end("ok"));
  stream.on("error", () => {});
});
server.on("error", () => {});

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;

  let armed = false;
  let fired = false;
  let rstTarget = 0;
  let session;

  // Wrap a real TCP socket in a Duplex so socket._handle is undefined and the
  // H2FrameParser falls back to the JS onWrite path (native_socket == .none).
  // _write calls its callback synchronously so the Duplex never buffers: by
  // the time req.write() returns below, every direct-send chunk from
  // sendData() has already passed through here and `armed` can only observe
  // writes originating from flushQueue (triggered by WINDOW_UPDATE).
  function createConnection() {
    const raw = net.connect({ port, host: "127.0.0.1" });
    const dup = new Duplex({
      read() {},
      write(chunk, encoding, callback) {
        // Only fire on a DATA frame header for our stream. flushQueue writes
        // the 9-byte header first (type byte at index 3 is 0 for DATA) and
        // then writes the payload; firing here puts cleanQueue between the
        // header write and the payload write that reads frame.buffer.
        if (
          armed &&
          !fired &&
          rstTarget !== 0 &&
          chunk.length === 9 &&
          chunk[3] === 0 /* HTTP_FRAME_DATA */ &&
          (chunk.readUInt32BE(5) & 0x7fffffff) === rstTarget
        ) {
          fired = true;
          // Re-enter the parser synchronously from inside onWrite: this frees
          // the queued frame currently being flushed.
          try {
            session[kNative]?.rstStream(rstTarget, 8 /* CANCEL */);
          } catch {}
        }
        raw.write(chunk, encoding);
        // Signal completion immediately so the Duplex does not queue chunks
        // across the `armed = true` boundary. We do NOT want raw-socket
        // backpressure here; we want flow-control (window exhaustion) to be
        // the reason data lands in the parser's per-stream dataFrameQueue.
        callback();
      },
      final(callback) {
        raw.end();
        callback();
      },
      destroy(err, callback) {
        raw.destroy(err);
        callback(err);
      },
    });
    raw.on("data", d => dup.push(d));
    raw.on("end", () => dup.push(null));
    raw.on("error", e => dup.destroy(e));
    raw.on("connect", () => dup.emit("connect"));
    dup.connecting = true;
    raw.on("connect", () => {
      dup.connecting = false;
    });
    return dup;
  }

  const client = http2.connect(`http://127.0.0.1:${port}`, { createConnection });
  session = client;
  client.on("error", err => {
    console.error("client error", err);
    process.exit(1);
  });

  client.on("connect", () => {
    const req = client.request({ ":method": "POST", ":path": "/" }, { endStream: false });
    rstTarget = req.id;
    req.on("error", () => {});
    req.on("response", () => {});
    req.on("data", () => {});
    req.on("close", () => finish());

    // Write more than the default initial window (65535) so the tail is
    // queued by the native frame parser. flushQueue runs for the queued tail
    // once WINDOW_UPDATE arrives.
    const payload = Buffer.alloc(128 * 1024, 0x61);
    req.write(payload);
    // All direct writes have completed synchronously; the remainder is in the
    // dataFrameQueue. Arm the trap so the NEXT DATA-frame header write (from
    // flushQueue after WINDOW_UPDATE) resets the stream from inside onWrite.
    armed = true;
  });

  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    if (!fired) {
      console.error("rstStream was never invoked from inside onWrite");
      process.exit(1);
    }
    try {
      client.destroy();
    } catch {}
    try {
      server.close();
    } catch {}
    console.log("ok");
    process.exit(0);
  }
});
