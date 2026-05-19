// https://github.com/oven-sh/bun/issues/30307
//
// `req.setTimeout(ms, cb)` on an Http2Stream was delegating to
// `session.setTimeout`, which delegates to the underlying socket's
// `setTimeout`. Two observable consequences:
//
// 1. Each per-stream setTimeout call registered its callback as a
//    `once('timeout')` listener on the shared socket. The callbacks
//    accumulated across requests — a single socket idle fire ran every
//    still-pending per-stream callback at once, including callbacks for
//    streams that had already ended. @fastify/reply-from installs such a
//    callback on every outgoing Http2Stream, so on Bun the fastify-http-proxy
//    log flooded with `FST_REPLY_FROM_HTTP2_REQUEST_TIMEOUT` after any
//    session-idle gap >= requestTimeout.
// 2. Session `#onTimeout` additionally broadcast `'timeout'` to every stream
//    the parser still tracked (`forEachStream(emitTimeout)`), contrary to
//    Node.js semantics where a session-level idle timeout emits on the
//    session only.
//
// The fix gives Http2Stream its own per-instance idle timer (setTimeout.unref
// on stream; refreshed on _write/_writev/pushToStream; cleared on _destroy)
// and removes the session → streams cascade.

import { describe, expect, it } from "bun:test";
import { isASAN } from "harness";
import { once } from "node:events";
import http2 from "node:http2";

// The ASAN lane is measurably slower than release; scale per-stream
// thresholds so a transient stall on a loaded CI box can't trip a
// correctly-cleared timer during the request.
const SCALE = isASAN ? 4 : 1;

describe("#30307", () => {
  it("req.setTimeout does not fire on completed streams after a session-idle gap", async () => {
    const server = http2.createServer();
    server.on("stream", stream => {
      stream.respond({ ":status": 200 });
      stream.end("ok");
    });

    await new Promise<void>(resolve => server.listen(0, resolve));
    const port = (server.address() as import("node:net").AddressInfo).port;
    const client = http2.connect(`http://localhost:${port}`);
    try {
      // Warm the session so subsequent requests return quickly and never
      // approach the per-stream timeout during their own lifetime.
      await once(client, "connect");
      {
        const warmup = client.request({ ":path": "/" });
        warmup.resume();
        warmup.end();
        await once(warmup, "end");
      }

      // The per-stream threshold must elapse during the idle gap below.
      // The gap is driven by the session's own socket idle-timeout
      // firing deterministically, so the timing is event-based.
      const STREAM_TIMEOUT_MS = 150 * SCALE;
      const IDLE_BARRIER_MS = 2 * STREAM_TIMEOUT_MS;

      const timeoutFires: string[] = [];
      async function doRequest(label: string) {
        const req = client.request({ ":path": "/" });
        req.setTimeout(STREAM_TIMEOUT_MS, () => {
          timeoutFires.push(label);
        });
        await new Promise<void>(resolve => {
          req.on("end", () => resolve());
          req.resume();
          req.end();
        });
      }

      await doRequest("req-1");
      await doRequest("req-2");
      await doRequest("req-3");
      await doRequest("req-4");

      // Arm a session-level socket idle timeout as a deterministic
      // barrier: wait for the session's own 'timeout' event rather than
      // sleeping a fixed duration. By the time this fires, the per-stream
      // threshold has elapsed for every completed stream above. On the
      // buggy path the accumulated per-stream callbacks on the shared
      // socket (or the session→streams cascade for completed-but-still-
      // tracked streams) fire first and populate timeoutFires.
      client.setTimeout(IDLE_BARRIER_MS);
      await once(client, "timeout");

      // A follow-up request that also succeeds silently.
      await doRequest("req-5");

      expect(timeoutFires).toEqual([]);
    } finally {
      client.close();
      server.close();
    }
  });

  it("session-level setTimeout does not emit 'timeout' on live streams", async () => {
    // A server that never responds keeps client streams open, so they're
    // still tracked by the session when the socket idle timer fires.
    // On the buggy path, the session #onTimeout did
    // `parser.forEachStream(emitTimeout)` and every live stream saw a
    // spurious 'timeout' event. Per Node.js, session idle timeouts emit
    // on the session only.
    const server = http2.createServer();
    server.on("stream", _stream => {
      // deliberately no response
    });

    await new Promise<void>(resolve => server.listen(0, resolve));
    const port = (server.address() as import("node:net").AddressInfo).port;
    const client = http2.connect(`http://localhost:${port}`);
    try {
      await once(client, "connect");

      const streamFired: string[] = [];
      const req1 = client.request({ ":path": "/a" });
      const req2 = client.request({ ":path": "/b" });
      // Swallow the inevitable ERR_HTTP2_STREAM_ERROR on teardown so it
      // doesn't surface as an uncaught stream error.
      req1.on("error", () => {});
      req2.on("error", () => {});
      req1.on("timeout", () => streamFired.push("req1"));
      req2.on("timeout", () => streamFired.push("req2"));
      req1.end();
      req2.end();

      // Both streams are live (waiting for a response that never comes).
      // Arm the session socket idle timer and wait deterministically for
      // its 'timeout' event. No per-stream 'timeout' must fire.
      client.setTimeout(150 * SCALE);
      await once(client, "timeout");

      expect(streamFired).toEqual([]);

      req1.close(http2.constants.NGHTTP2_CANCEL);
      req2.close(http2.constants.NGHTTP2_CANCEL);
    } finally {
      client.close();
      server.close();
    }
  });
});
