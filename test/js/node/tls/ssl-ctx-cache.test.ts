// Native weak `SSLContextCache`: every JS-thread consumer that turns an SSL
// config into an `SSL_CTX*` should hit the same per-VM cache, so identical
// configs (including `{servername}`-only and inline-CA configs) allocate one
// CTX, not one per connection. The cache holds zero refs — when the last
// real owner drops, BoringSSL's ex_data free callback tombstones the entry.
import { expect, test } from "bun:test";
import { once } from "node:events";
import tls from "node:tls";
// @ts-expect-error - debug-only export
import { sslCtxLiveCount } from "bun:internal-for-testing";
import { tempDir, tls as tlsCerts } from "harness";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
        // With a `handshake` handler present, `open` fires on TCP-connect
        // (pre-handshake). Calling `s.end()` there leaves the libuv-backed
        // Windows socket in a state where `close` never fires. End after
        // the handshake completes instead.
        open() {},
        handshake(s) {
          s.end();
        },
        close() {
          resolve();
        },
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

// The user-facing `tls.createSecureContext()` is uncached: every call owns its
// SSL_CTX exclusively (so addCACert on one context can never leak into
// another); only internal consumers (tls.connect / Bun.connect / fetch) share
// contexts through the per-digest native cache.
test("createSecureContext owns its native handle exclusively (identical configs get distinct SSL_CTXs)", () => {
  const opts = { ca: tlsCerts.cert, rejectUnauthorized: false };
  const a = tls.createSecureContext(opts);
  const b = tls.createSecureContext({ ...opts });
  // The JS wrapper carries per-call `servername`, so wrappers differ; the
  // SSL_CTX-owning `.context` is the deduped native cell.
  // The user-facing createSecureContext() owns its SSL_CTX exclusively so
  // addCACert on one context can never affect another.
  expect(a.context).not.toBe(b.context);
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
  // pin the count at before+1. JSC's conservative stack scan and finalizer
  // scheduling don't guarantee N passes is enough — await the condition.
  for (let i = 0; i < 50; i++) {
    Bun.gc(true);
    await new Promise<void>(r => setImmediate(r));
    if (sslCtxLiveCount() <= before) break;
  }
  expect(sslCtxLiveCount()).toBeLessThanOrEqual(before);
});

// Same-CA inline configs across repeated `Bun.connect` calls resolve to one
// CTX — the cache is keyed by digest. (Not shared with `new WebSocket`, which
// projects via `asUSocketsForClientVerification()` → different `request_cert`
// → different digest by design.)
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
        // With a `handshake` handler present, `open` fires on TCP-connect
        // (pre-handshake). Calling `s.end()` there leaves the libuv-backed
        // Windows socket in a state where `close` never fires. End after
        // the handshake completes instead.
        open() {},
        handshake(s) {
          s.end();
        },
        close() {
          resolve();
        },
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

test("file-backed config: in-place rotation invalidates cache (mtime+size in digest)", async () => {
  using dir = tempDir("ssl-ctx-rotate", {
    "ca.pem": tlsCerts.cert,
  });
  const caFile = join(String(dir), "ca.pem");

  await withServer(async port => {
    // Exercise the cached connect path (which memoises by config digest);
    // the user-facing createSecureContext() now owns its SSL_CTX exclusively,
    // so it would create a fresh CTX per call and defeat the cache this test
    // is about. Pin each socket so GC between connects can't drop the count.
    const pin: unknown[] = [];
    const connectOnce = async () => {
      const s = tls.connect({ port, caFile, rejectUnauthorized: false } as any);
      pin.push(s);
      await once(s, "secureConnect");
      s.destroy();
      await once(s, "close");
    };

    // Warm: first connect may also lazy-init unrelated CTXs (default client,
    // root store) — measure deltas after the first one.
    await connectOnce();
    const after1 = sslCtxLiveCount();
    await connectOnce();
    // Second connect with identical (path, mtime, size) hits cache.
    expect(sslCtxLiveCount()).toBe(after1);

    // Rotate in place — same path, different content. Rewriting bumps mtime
    // and (here) size; either alone changes the digest.
    writeFileSync(caFile, tlsCerts.cert + "\n");
    await connectOnce();
    // New (mtime, size) → fresh digest → fresh CTX.
    expect(sslCtxLiveCount()).toBe(after1 + 1);
    pin.length = 0;
  });
});

test("addCACert on one user-facing context does not affect another with identical options", () => {
  const a = tls.createSecureContext({});
  const b = tls.createSecureContext({});
  expect(a.context).not.toBe(b.context);
  a.context.addCACert(tlsCerts.cert);
  // b's native context is a different object and stays untouched.
  expect(a.context).not.toBe(b.context);
});

test("setDefaultCACertificates() override applies to plain tls.connect (no explicit ca)", async () => {
  const keys = (f: string) => readFileSync(join(import.meta.dir, "../test/fixtures/keys", f));
  const prev = tls.getCACertificates("default");
  try {
    tls.setDefaultCACertificates([keys("ca1-cert.pem").toString()]);
    const server = tls.createServer({ key: keys("agent1-key.pem"), cert: keys("agent1-cert.pem") }, s => s.end("ok"));
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as any).port;
    const socket = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: true, servername: "agent1" });
    await once(socket, "secureConnect");
    expect(socket.authorized).toBe(true);
    socket.destroy();
    server.close();
  } finally {
    tls.setDefaultCACertificates(prev);
  }
});

test("ca: [] skips the setDefaultCACertificates override (distinct from ca: undefined)", async () => {
  // Providing any `ca` value - including an empty array - bypasses the
  // process-default override that setDefaultCACertificates() installs (the
  // override only applies when `ca` is absent), so the connection verifies
  // against the bundled roots instead. NOTE: this is not Node's full
  // "ca: [] = empty trust store" semantics (an explicitly-empty list should
  // trust NOTHING, not fall back to bundled roots) - that needs an explicit
  // empty-CA flag through the native config and remains a follow-up. Make a
  // fixture CA a process default first so the two cases are observably
  // different.
  const keys = (f: string) => readFileSync(join(import.meta.dir, "../test/fixtures/keys", f), "utf8");
  const prevCerts = tls.getCACertificates("default");
  tls.setDefaultCACertificates([keys("ca1-cert.pem")]);
  try {
    const server = tls.createServer({ key: keys("agent1-key.pem"), cert: keys("agent1-cert.pem") }, s => s.end());
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as import("net").AddressInfo).port;

    // ca undefined -> the process defaults (which now include ca1) -> authorized.
    const c1 = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false, servername: "agent1" });
    await once(c1, "secureConnect");
    expect(c1.authorized).toBe(true);
    c1.end();
    await once(c1, "close");

    // ca: [] -> the override is skipped, the bundled roots apply (which do not
    // include ca1) -> NOT authorized.
    const c2 = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false, servername: "agent1", ca: [] });
    await once(c2, "secureConnect");
    expect(c2.authorized).toBe(false);
    expect(c2.authorizationError).toBeTruthy();
    c2.end();
    await once(c2, "close");

    server.close();
    await once(server, "close");
  } finally {
    tls.setDefaultCACertificates(prevCerts);
  }
});

test("setDefaultCACertificates() applies to a server's client-cert verification (no explicit ca)", async () => {
  // The server path (setSecureContext -> Bun.listen) does not go through
  // InternalSecureContext; the process-default override must still apply so
  // an mTLS server with no explicit `ca` verifies client certificates against
  // the overridden defaults rather than the bundled roots.
  const keys = (f: string) => readFileSync(join(import.meta.dir, "../test/fixtures/keys", f), "utf8");
  const prevCerts = tls.getCACertificates("default");
  tls.setDefaultCACertificates([keys("ca1-cert.pem")]);
  try {
    const server = tls.createServer({
      key: keys("agent1-key.pem"),
      cert: keys("agent1-cert.pem"),
      requestCert: true,
      rejectUnauthorized: false,
    });
    const authorized = Promise.withResolvers<boolean>();
    server.on("secureConnection", socket => {
      authorized.resolve(socket.authorized);
      socket.end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as import("net").AddressInfo).port;

    // The client presents agent1's cert (signed by ca1, which is now a process
    // default). The server must verify it as authorized.
    const client = tls.connect({
      port,
      host: "127.0.0.1",
      rejectUnauthorized: false,
      key: keys("agent1-key.pem"),
      cert: keys("agent1-cert.pem"),
    });
    await once(client, "secureConnect");
    expect(await authorized.promise).toBe(true);
    client.end();
    await once(client, "close");
    server.close();
    await once(server, "close");
  } finally {
    tls.setDefaultCACertificates(prevCerts);
  }
});
