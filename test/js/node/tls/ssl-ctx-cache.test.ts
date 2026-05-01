// Native weak `SSLContextCache`: every JS-thread consumer that turns an SSL
// config into an `SSL_CTX*` should hit the same per-VM cache, so identical
// configs (including `{servername}`-only and inline-CA configs) allocate one
// CTX, not one per connection. The cache holds zero refs — when the last
// real owner drops, BoringSSL's ex_data free callback tombstones the entry.
import { test, expect } from "bun:test";
import tls from "node:tls";
import { once } from "node:events";
// @ts-expect-error - debug-only export
import { sslCtxLiveCount } from "bun:internal-for-testing";
import { tls as tlsCerts } from "harness";

async function withServer(fn: (port: number) => Promise<void>) {
  const server = tls.createServer({ ...tlsCerts, rejectUnauthorized: false }, s => s.end());
  server.listen(0);
  await once(server, "listening");
  const { port } = server.address() as import("net").AddressInfo;
  try {
    await fn(port);
  } finally {
    server.close();
    await once(server, "close");
  }
}

// Before the native cache, `Bun.connect({tls:{servername}})` set
// `requires_custom_request_ctx` and built a fresh SSL_CTX per call even though
// SNI is per-SSL not per-CTX. The digest now excludes servername, so 50 of
// these share the default client CTX.
test("Bun.connect with servername-only tls reuses one SSL_CTX", async () => {
  await withServer(async port => {
    // Warm: server CTX + the digest-{} client CTX.
    await connectOnce(port);
    Bun.gc(true);
    const before = sslCtxLiveCount();

    for (let i = 0; i < 50; i++) await connectOnce(port);
    await new Promise<void>(r => setImmediate(() => queueMicrotask(r)));
    Bun.gc(true);

    // Old behaviour: Δ ≈ 50. Now: Δ ≤ 2.
    expect(sslCtxLiveCount() - before).toBeLessThanOrEqual(2);
  });

  async function connectOnce(port: number) {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const sock = await Bun.connect({
      hostname: "127.0.0.1",
      port,
      tls: { servername: "localhost", rejectUnauthorized: false },
      socket: {
        open(s) {
          s.end();
        },
        close() {
          resolve();
        },
        handshake() {},
        data() {},
        error(_s, e) {
          reject(e);
        },
        connectError(_s, e) {
          reject(e);
        },
      },
    });
    await promise;
  }
});

// `tls.createSecureContext()` is now WeakGCMap-memoised by digest in native
// code (replacing the SHA-256/WeakRef Map that lived in tls.ts), so the same
// options return the same native handle.
test("createSecureContext returns the same native handle for identical configs", () => {
  const opts = { ca: tlsCerts.cert, rejectUnauthorized: false };
  const a = tls.createSecureContext(opts);
  const b = tls.createSecureContext({ ...opts });
  // The JS wrapper carries per-call `servername`, so wrappers differ; the
  // SSL_CTX-owning `.context` is the deduped native cell.
  expect(a.context).toBe(b.context);
  // Different config → different handle.
  const c = tls.createSecureContext({ rejectUnauthorized: false });
  expect(c.context).not.toBe(a.context);
});

// Weak-cache reclaim: once every owner drops its ref and GC sweeps the
// SecureContext, BoringSSL's free callback tombstones the entry and the live
// count returns to baseline.
test("SSL_CTX is freed once no owners remain (weak cache, not strong)", async () => {
  // Drain anything previous tests left for the sweeper so `before` is stable.
  Bun.gc(true);
  await new Promise<void>(r => setImmediate(r));
  Bun.gc(true);
  const before = sslCtxLiveCount();

  // Build a CTX with a unique digest (custom cipher) so nothing else holds it.
  let sc: any = tls.createSecureContext({ ciphers: "ECDHE-RSA-AES128-GCM-SHA256" });
  expect(sc.context).toBeTruthy();
  // While `sc` is live the CTX must be live — proves the cache doesn't
  // *prevent* allocation either.
  expect(sslCtxLiveCount()).toBe(before + 1);
  sc = undefined;

  // Weak<> handles are reclaimed on full GC; SecureContext.finalize then
  // SSL_CTX_free()s, which fires the ex_data tombstone. A strong cache would
  // pin the count at before+1.
  Bun.gc(true);
  await new Promise<void>(r => setImmediate(r));
  Bun.gc(true);
  expect(sslCtxLiveCount()).toBeLessThanOrEqual(before);
});

// Same-CA inline configs across `Bun.connect` and `tls.connect` should resolve
// to one CTX — the cache is keyed by digest, not by which API asked.
test("Bun.connect with inline ca shares SSL_CTX across calls", async () => {
  await withServer(async port => {
    const tlsOpts = { ca: tlsCerts.cert, rejectUnauthorized: false };
    // Warm.
    await connectOnce(port, tlsOpts);
    Bun.gc(true);
    const before = sslCtxLiveCount();

    for (let i = 0; i < 30; i++) await connectOnce(port, tlsOpts);
    await new Promise<void>(r => setImmediate(() => queueMicrotask(r)));
    Bun.gc(true);

    expect(sslCtxLiveCount() - before).toBeLessThanOrEqual(2);
  });

  async function connectOnce(port: number, tlsOpts: object) {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    await Bun.connect({
      hostname: "127.0.0.1",
      port,
      tls: tlsOpts,
      socket: {
        open(s) {
          s.end();
        },
        close() {
          resolve();
        },
        handshake() {},
        data() {},
        error(_s, e) {
          reject(e);
        },
        connectError(_s, e) {
          reject(e);
        },
      },
    });
    await promise;
  }
});
