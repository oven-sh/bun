// Asserts that the per-connection us_socket_context_t / SSL_CTX leak is gone:
// 200 tls.connect()→destroy() cycles against one server must not allocate 200
// SSL_CTXs (it should allocate ≤2: one for the server, one shared for all
// clients via the memoised SecureContext), and RSS must stay flat.
//
// Regression for #12117 / #24118 / #29887.
import { test, expect } from "bun:test";
import tls from "node:tls";
import { once } from "node:events";
// @ts-expect-error - debug-only export
import { sslCtxLiveCount } from "bun:internal-for-testing";
import { tls as tlsCerts, isASAN, isDebug } from "harness";

test("tls.connect churn does not leak SSL_CTX or us_socket_context_t", async () => {
  const server = tls.createServer({ ...tlsCerts, rejectUnauthorized: false }, sock => {
    sock.end();
  });
  server.listen(0);
  await once(server, "listening");
  const { port } = server.address() as import("net").AddressInfo;

  // Warm: first connect allocates the server SSL_CTX + the memoised client one.
  await connectOnce(port);
  Bun.gc(true);
  const ctxBefore = sslCtxLiveCount();
  const rssBefore = process.memoryUsage.rss();

  // 50 is enough to prove O(1): the old code leaked one SSL_CTX per connect,
  // so the count delta would be ~50 not ≤2. (200 was used originally but
  // debug+ASAN does ~50 ms per handshake, putting it past the default timeout
  // for a property that's just as visible at 50.)
  for (let i = 0; i < 50; i++) await connectOnce(port);
  // The close-list drains on the next loop tick (us_internal_free_closed_sockets
  // runs in loop-post). Await a microtask + macrotask boundary instead of time.
  await new Promise<void>(r => setImmediate(() => queueMicrotask(r)));
  Bun.gc(true);

  const ctxAfter = sslCtxLiveCount();
  const rssAfter = process.memoryUsage.rss();

  server.close();

  // The whole point: no per-connection SSL_CTX. Allow a tiny slack for the
  // close-list / GC race, but 200 connects must not move this by 200.
  expect(ctxAfter - ctxBefore).toBeLessThanOrEqual(2);

  // Pre-fix this grew ~50 KB × 200 ≈ 10 MB in release. Debug+ASAN builds hold
  // freed allocations in quarantine, so RSS deltas there are dominated by
  // quarantine churn rather than live leaks; only enforce the tight bound in
  // release where the original regression was visible.
  const rssBound = isASAN || isDebug ? 64 * 1024 * 1024 : 4 * 1024 * 1024;
  expect(rssAfter - rssBefore).toBeLessThan(rssBound);
  // Debug+ASAN BoringSSL does ~200 ms per full handshake; 50 sequential
  // handshakes can't fit the 5 s default. This is wall-clock cost of the
  // crypto, not a wait-for-condition.
}, 30_000);

test("createSecureContext memoises the native SSL_CTX (not the wrapper) by config", () => {
  const a = tls.createSecureContext({ cert: tlsCerts.cert });
  const b = tls.createSecureContext({ cert: tlsCerts.cert, servername: "other.example" });
  // Same SSL_CTX-relevant fields → same native handle…
  expect(a.context).toBe(b.context);
  // …but the wrapper is fresh so per-call fields don't leak across callers.
  expect(a).not.toBe(b);
  expect(b.servername).toBe("other.example");
  expect(a.servername).toBeUndefined();
  // Different SSL_CTX-relevant config → different native handle.
  const c = tls.createSecureContext({ cert: tlsCerts.cert, rejectUnauthorized: false });
  expect(c.context).not.toBe(a.context);
});

async function connectOnce(port: number) {
  await new Promise<void>((resolve, reject) => {
    const sock = tls.connect({ port, host: "127.0.0.1", ca: tlsCerts.ca, rejectUnauthorized: false }, () => {
      sock.destroy();
      resolve();
    });
    sock.on("error", reject);
  });
}
