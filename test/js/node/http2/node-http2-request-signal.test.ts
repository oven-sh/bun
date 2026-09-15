/**
 * session.request(headers, { signal }): when the signal aborts, node destroys the stream from JS
 * with an AbortError (lib/internal/http2/core.js request()). The stream is destroyed before the
 * queued DATA frames are dropped, so the abort does not look like a completed write.
 *
 * The RST_STREAM of a destroyed request goes out before the HEADERS frame of the next request
 * that was queued behind the peer's SETTINGS_MAX_CONCURRENT_STREAMS.
 *
 * Works with both:
 *   bun bd test test/js/node/http2/node-http2-request-signal.test.ts
 *   node --test test/js/node/http2/node-http2-request-signal.test.ts
 */
import assert from "node:assert";
import dc from "node:diagnostics_channel";
import { once } from "node:events";
import http2 from "node:http2";
import net from "node:net";
import { describe, test } from "node:test";

const { NGHTTP2_CANCEL } = http2.constants;
const INITIAL_WINDOW = 65535;
const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
const F = { DATA: 0, HEADERS: 1, RST_STREAM: 3, SETTINGS: 4, PING: 6 };
const SETTINGS_MAX_CONCURRENT_STREAMS = 3;

function frame(type: number, flags: number, streamId: number, payload = Buffer.alloc(0)) {
  const b = Buffer.alloc(9 + payload.length);
  b.writeUIntBE(payload.length, 0, 3);
  b[3] = type;
  b[4] = flags;
  b.writeUInt32BE(streamId >>> 0, 5);
  payload.copy(b, 9);
  return b;
}

function setting(id: number, value: number) {
  const b = Buffer.alloc(6);
  b.writeUInt16BE(id, 0);
  b.writeUInt32BE(value, 2);
  return b;
}

/**
 * A raw h2c server for one connection, and the client session connected to it. The server answers
 * SETTINGS and PING and never sends WINDOW_UPDATE, so a request body larger than the initial
 * window stays queued in the client under test.
 *   wire             the HEADERS and RST_STREAM frames received, in order, as "HEADERS 1"
 *   wireLength(n)    settles once `wire` has n entries
 *   windowExhausted  settles once a full window of DATA arrived: the client is now blocked
 *   rstCode          settles with the error code of the first RST_STREAM frame, or with null if
 *                    the connection closes without one
 * wireLength(n) and windowExhausted reject if the connection ends first.
 */
async function clientAgainstRawServer(settings = Buffer.alloc(0)) {
  const wire: string[] = [];
  const wireWaiters: { n: number; resolve: () => void }[] = [];
  const windowExhausted = Promise.withResolvers<void>();
  const rstCode = Promise.withResolvers<number | null>();
  const sockets: net.Socket[] = [];
  const rejecters: ((reason: Error) => void)[] = [windowExhausted.reject];
  windowExhausted.promise.catch(() => {}); // Not every test awaits it.
  function record(entry: string) {
    wire.push(entry);
    for (const waiter of wireWaiters) if (wire.length >= waiter.n) waiter.resolve();
  }
  function connectionEnded(cause?: unknown) {
    const err = new Error(`the connection ended first, wire: ${JSON.stringify(wire)}`, { cause });
    for (const reject of rejecters) reject(err);
  }
  const server = net.createServer(socket => {
    sockets.push(socket);
    let buf = Buffer.alloc(0);
    let prefaceSeen = false;
    let received = 0;
    socket.on("error", () => {});
    socket.on("close", () => {
      rstCode.resolve(null);
      connectionEnded();
    });
    socket.on("data", chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (!prefaceSeen) {
        if (buf.length < PREFACE.length) return;
        prefaceSeen = true;
        buf = buf.subarray(PREFACE.length);
        socket.write(frame(F.SETTINGS, 0, 0, settings));
      }
      while (buf.length >= 9) {
        const len = buf.readUIntBE(0, 3);
        if (buf.length < 9 + len) break;
        const type = buf[3];
        const flags = buf[4];
        const streamId = buf.readUInt32BE(5) & 0x7fffffff;
        const payload = buf.subarray(9, 9 + len);
        buf = buf.subarray(9 + len);
        if (type === F.SETTINGS && !(flags & 1)) socket.write(frame(F.SETTINGS, 1, 0));
        else if (type === F.PING && !(flags & 1)) socket.write(frame(F.PING, 1, 0, payload));
        else if (type === F.HEADERS) record(`HEADERS ${streamId}`);
        else if (type === F.RST_STREAM) {
          record(`RST_STREAM ${streamId}`);
          rstCode.resolve(payload.readUInt32BE(0));
        } else if (type === F.DATA && (received += len) >= INITIAL_WINDOW) windowExhausted.resolve();
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const session = http2.connect(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
  session.on("error", connectionEnded);
  session.on("close", () => connectionEnded());
  function close() {
    session.destroy();
    for (const socket of sockets) socket.destroy();
    if (server.listening) server.close();
  }
  try {
    await once(session, "remoteSettings");
  } catch (err) {
    close();
    throw err;
  }
  return {
    session,
    wire,
    wireLength(n: number) {
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      if (wire.length >= n) resolve();
      else {
        wireWaiters.push({ n, resolve });
        rejecters.push(reject);
      }
      return promise;
    },
    windowExhausted: windowExhausted.promise,
    rstCode: rstCode.promise,
    close,
  };
}

/** The usual producer: on 'drain', write until write() reports backpressure again. */
function produceOnDrain(stream: http2.ClientHttp2Stream) {
  const seen = { drains: 0, accepted: 0 };
  stream.on("drain", () => {
    seen.drains++;
    for (let budget = 32; budget > 0 && stream.write(Buffer.alloc(16384)); budget--) seen.accepted++;
  });
  return seen;
}

function recordEvents(stream: http2.ClientHttp2Stream) {
  const events: string[] = [];
  for (const name of ["aborted", "finish", "end", "close"]) stream.on(name, () => events.push(name));
  stream.on("error", err => events.push(`error ${err.name}`));
  return events;
}

/**
 * Settles a turn after 'close', so that a late 'drain' is still counted. The stream sends its
 * RST_STREAM from a setImmediate that is queued before 'close', so that frame is written by then.
 */
function closedAndSettled(stream: http2.ClientHttp2Stream) {
  const { promise, resolve } = Promise.withResolvers<void>();
  stream.on("close", () => setImmediate(resolve));
  return promise;
}

// One window goes out at once. The other 32 KiB stays queued with the write callback held.
const BLOCKED_BODY = Buffer.alloc(INITIAL_WINDOW + 32768, 0x41);

describe("session.request(headers, { signal })", () => {
  test("abort with a flow-control-blocked write emits no 'drain' and the stream accepts no more writes", async () => {
    const { session, windowExhausted, rstCode, close } = await clientAgainstRawServer();
    try {
      const controller = new AbortController();
      const stream = session.request({ ":path": "/upload", ":method": "POST" }, { signal: controller.signal });
      const events = recordEvents(stream);
      const backpressured = !stream.write(BLOCKED_BODY);
      const seen = produceOnDrain(stream);
      await windowExhausted;

      const closed = closedAndSettled(stream);
      controller.abort();
      await closed;
      // The peer reads what was written, then sees the connection close.
      session.destroy();
      const wire = await rstCode;

      assert.deepStrictEqual(
        { backpressured, ...seen, events, rstCode: stream.rstCode, wire },
        {
          backpressured: true,
          drains: 0,
          accepted: 0,
          events: ["aborted", "error AbortError", "close"],
          rstCode: NGHTTP2_CANCEL,
          wire: NGHTTP2_CANCEL,
        },
      );
    } finally {
      close();
    }
  });

  test("abort after end() is not reported as 'aborted'", async () => {
    const { session, windowExhausted, rstCode, close } = await clientAgainstRawServer();
    try {
      const controller = new AbortController();
      const stream = session.request({ ":path": "/upload", ":method": "POST" }, { signal: controller.signal });
      const events = recordEvents(stream);
      // The writable side is ended, but END_STREAM is still queued behind the blocked DATA.
      stream.end(BLOCKED_BODY);
      await windowExhausted;

      const closed = closedAndSettled(stream);
      controller.abort();
      await closed;
      // The peer reads what was written, then sees the connection close.
      session.destroy();
      const wire = await rstCode;

      assert.deepStrictEqual(
        { events, aborted: stream.aborted, rstCode: stream.rstCode, wire },
        { events: ["error AbortError", "close"], aborted: false, rstCode: NGHTTP2_CANCEL, wire: NGHTTP2_CANCEL },
      );
    } finally {
      close();
    }
  });

  test("accepts any event target with an 'aborted' property as the signal", async () => {
    const { session, wireLength, rstCode, close } = await clientAgainstRawServer();
    try {
      const signal = Object.assign(new EventTarget(), { aborted: false, reason: undefined as unknown });
      const stream = session.request({ ":path": "/upload", ":method": "POST" }, { signal: signal as AbortSignal });
      const events = recordEvents(stream);
      const error = Promise.withResolvers<Error>();
      stream.on("error", error.resolve);
      await wireLength(1);

      const closed = closedAndSettled(stream);
      signal.aborted = true;
      signal.reason = new Error("stop");
      signal.dispatchEvent(new Event("abort"));
      await closed;
      // The peer reads what was written, then sees the connection close.
      session.destroy();
      const wire = await rstCode;

      assert.strictEqual((await error.promise).cause, signal.reason);
      assert.deepStrictEqual(
        { events, rstCode: stream.rstCode, wire },
        { events: ["aborted", "error AbortError", "close"], rstCode: NGHTTP2_CANCEL, wire: NGHTTP2_CANCEL },
      );
    } finally {
      close();
    }
  });
});

// The peer counts a stream as open until the RST_STREAM arrives. A HEADERS frame that overtakes
// it exceeds the peer's SETTINGS_MAX_CONCURRENT_STREAMS, and the peer refuses the new stream.
describe("a request queued behind SETTINGS_MAX_CONCURRENT_STREAMS is sent after the RST_STREAM", () => {
  async function cancelFirstOfTwo(cancel: (first: http2.ClientHttp2Stream, controller: AbortController) => void) {
    const { session, wire, wireLength, close } = await clientAgainstRawServer(
      setting(SETTINGS_MAX_CONCURRENT_STREAMS, 1),
    );
    try {
      const controller = new AbortController();
      const first = session.request({ ":path": "/first", ":method": "POST" }, { signal: controller.signal });
      first.on("error", () => {});
      const second = session.request({ ":path": "/second", ":method": "POST" });
      second.on("error", () => {});
      await wireLength(1);

      cancel(first, controller);
      await wireLength(3);
      return wire;
    } finally {
      close();
    }
  }

  test("when a signal aborts the open request", async () => {
    assert.deepStrictEqual(await cancelFirstOfTwo((first, controller) => controller.abort()), [
      "HEADERS 1",
      "RST_STREAM 1",
      "HEADERS 3",
    ]);
  });

  test("when destroy(err) closes the open request", async () => {
    assert.deepStrictEqual(await cancelFirstOfTwo(first => first.destroy(new Error("stop"))), [
      "HEADERS 1",
      "RST_STREAM 1",
      "HEADERS 3",
    ]);
  });

  test("when a diagnostics_channel subscriber destroys the request before request() returns", async () => {
    const { session, wire, wireLength, close } = await clientAgainstRawServer(
      setting(SETTINGS_MAX_CONCURRENT_STREAMS, 1),
    );
    let destroyNext = true;
    function onStreamStart(message: unknown) {
      if (!destroyNext) return;
      destroyNext = false;
      (message as { stream: http2.ClientHttp2Stream }).stream.destroy(new Error("stop"));
    }
    dc.subscribe("http2.client.stream.start", onStreamStart);
    try {
      const first = session.request({ ":path": "/first", ":method": "POST" });
      first.on("error", () => {});
      const second = session.request({ ":path": "/second", ":method": "POST" });
      second.on("error", () => {});

      await wireLength(3);
      assert.deepStrictEqual(
        { firstDestroyedInRequest: !destroyNext, wire },
        { firstDestroyedInRequest: true, wire: ["HEADERS 1", "RST_STREAM 1", "HEADERS 3"] },
      );
    } finally {
      dc.unsubscribe("http2.client.stream.start", onStreamStart);
      close();
    }
  });
});
