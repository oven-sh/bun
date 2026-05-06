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
import http2 from "node:http2";

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
      await new Promise<void>(resolve => client.once("connect", () => resolve()));
      {
        const warmup = client.request({ ":path": "/" });
        warmup.resume();
        warmup.end();
        await new Promise<void>(resolve => warmup.on("end", () => resolve()));
      }

      const timeoutFires: string[] = [];
      async function doRequest(label: string) {
        const req = client.request({ ":path": "/" });
        // The per-stream timer must be torn down when the stream closes;
        // it must not fire after the request has already ended.
        req.setTimeout(300, () => {
          timeoutFires.push(label);
        });
        await new Promise<void>(resolve => {
          req.on("end", () => resolve());
          req.resume();
          req.end();
        });
      }

      // Create a handful of completed streams on the shared session.
      await doRequest("req-1");
      await doRequest("req-2");
      await doRequest("req-3");
      await doRequest("req-4");

      // Idle the session for longer than the per-stream timeout we armed.
      // On the buggy path, all four per-stream callbacks — accumulated as
      // once('timeout') listeners on the shared socket — fire on the
      // first socket idle, or the session cascade broadcasts 'timeout' to
      // every still-tracked stream.
      await new Promise(r => setTimeout(r, 500));

      // A follow-up request that succeeds silently. On the buggy path the
      // burst from the previous idle gap already happened before this
      // call returns.
      await doRequest("req-5");

      expect(timeoutFires).toEqual([]);
    } finally {
      client.close();
      server.close();
    }
  });

  it("session-level setTimeout does not cascade 'timeout' to tracked streams", async () => {
    const server = http2.createServer();
    server.on("stream", stream => {
      stream.respond({ ":status": 200 });
      stream.end("ok");
    });

    await new Promise<void>(resolve => server.listen(0, resolve));
    const port = (server.address() as import("node:net").AddressInfo).port;
    const client = http2.connect(`http://localhost:${port}`);
    try {
      await new Promise<void>(resolve => client.once("connect", () => resolve()));

      let sessionFired = false;
      const streamFired: string[] = [];
      client.on("timeout", () => {
        sessionFired = true;
      });

      async function doRequest(label: string) {
        const req = client.request({ ":path": "/" });
        req.on("timeout", () => streamFired.push(label));
        await new Promise<void>(resolve => {
          req.on("end", () => resolve());
          req.resume();
          req.end();
        });
      }

      await doRequest("req-1");
      await doRequest("req-2");

      // Session-level socket idle timeout. Per Node.js this must emit
      // 'timeout' on the session only, never on any stream.
      client.setTimeout(150);

      await new Promise(r => setTimeout(r, 400));

      expect(streamFired).toEqual([]);
      expect(sessionFired).toBe(true);
    } finally {
      client.close();
      server.close();
    }
  });
});
