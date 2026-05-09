import { createTest } from "node-harness";
import { once } from "node:events";
import http from "node:http";
const { expect } = createTest(import.meta.path);

// What this test asserts: when the client tears down the connection
// mid-request, the server's IncomingMessage emits "close" and `req.aborted`
// is true.
//
// The original version drove the client side with `fetch()` + an
// AbortController. On Windows that consistently timed out at
// `await closeEvent.promise`: aborting a Bun fetch posts a shutdown to the
// HTTP thread (`http_thread.scheduleShutdown`) which then closes the socket
// asynchronously, and the server's `req` was never observing "close" before
// the runner's timeout. The server-side behaviour under test doesn't care
// *how* the client hangs up, so use `http.get()` + `clientReq.destroy()`
// instead — that closes the underlying socket synchronously from the JS
// thread on every platform, and the test no longer depends on fetch's
// abort-to-socket-close path.

await using server = http.createServer().listen(0);
server.unref();
await once(server, "listening");

const clientReq = http.get({
  host: "127.0.0.1",
  port: server.address().port,
  // Don't let the client agent pool the socket — we want destroy() to
  // actually close it.
  agent: false,
});
clientReq.on("error", () => {});

const [req] = await once(server, "request");
// Not `once(req, "close")`: events.once() also attaches a temporary "error"
// listener, and `_http_server.ts` #onClose only constructs the
// ConnResetException when `req.listenerCount("error") > 0` — which would
// then make once() reject instead of resolving on "close".
const closeEvent = Promise.withResolvers();
req.once("close", () => closeEvent.resolve());
clientReq.destroy();
await closeEvent.promise;
expect(req.aborted).toBe(true);
