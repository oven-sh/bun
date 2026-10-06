// Native weak `SSLContextCache`: every JS-thread consumer that turns an SSL
// config into an `SSL_CTX*` should hit the same per-VM cache, so identical
// configs (including `{servername}`-only and inline-CA configs) allocate one
// CTX, not one per connection. The cache holds zero refs — when the last
// real owner drops, BoringSSL's ex_data free callback tombstones the entry.
import { expect, test } from "bun:test";
import { X509Certificate } from "node:crypto";
import { once } from "node:events";
import tls from "node:tls";
// @ts-expect-error - debug-only export
import { sslCtxLiveCount } from "bun:internal-for-testing";
import { bunEnv, bunExe, expiredTls, tempDir, tls as tlsCerts } from "harness";
import { readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

async function withServer(fn: (port: number) => Promise<void>) {
  const server = tls.createServer({ ...tlsCerts, rejectUnauthorized: false }, s => s.end());
  server.listen(0, "127.0.0.1");
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

test("file-backed config: a relative path is keyed on the cwd at the time of the call", async () => {
  // Same name, size and mtime in both directories, so only the resolved path tells the files apart in the digest.
  const pad = (a: string, b: string) => a.padEnd(Math.max(a.length, b.length), "\n");
  using dir = tempDir("ssl-ctx-cafile-cwd", {
    "valid/cert.pem": pad(tlsCerts.cert, expiredTls.cert),
    "valid/key.pem": pad(tlsCerts.key, expiredTls.key),
    "expired/cert.pem": pad(expiredTls.cert, tlsCerts.cert),
    "expired/key.pem": pad(expiredTls.key, tlsCerts.key),
  });
  for (const file of ["valid/cert.pem", "valid/key.pem", "expired/cert.pem", "expired/key.pem"]) {
    utimesSync(join(String(dir), file), 1_700_000_000, 1_700_000_000);
  }

  using server = Bun.serve({ port: 0, hostname: "127.0.0.1", tls: tlsCerts, fetch: () => new Response("OK") });
  const script = `
    import tls from "node:tls";
    import { once } from "node:events";
    const pinned = [];
    function viaBunConnect() {
      return new Promise(resolve => {
        Bun.connect({
          hostname: "127.0.0.1",
          port: ${server.port},
          tls: { caFile: "cert.pem" },
          socket: {
            open(s) { pinned.push(s); },
            handshake(s, ok, err) { resolve(ok ? "OK" : err.code); },
            error(s, err) { resolve(err.code); },
            connectError(s, err) { resolve(err.code); },
            data() {},
            close() {},
          },
        }).catch(err => resolve(err.code));
      });
    }
    function viaNodeTls() {
      return new Promise(resolve => {
        const s = tls.connect({ host: "127.0.0.1", port: ${server.port}, caFile: "cert.pem", servername: "localhost" });
        pinned.push(s);
        s.once("secureConnect", () => resolve("OK"));
        s.once("error", err => resolve(err.code));
      });
    }
    const mtls = tls.createServer({ key: process.env.KEY, cert: process.env.CERT, requestCert: true, rejectUnauthorized: false });
    await once(mtls.listen(0, "127.0.0.1"), "listening");
    async function clientCertificate() {
      const seen = once(mtls, "secureConnection");
      pinned.push(
        await Bun.connect({
          hostname: "127.0.0.1",
          port: mtls.address().port,
          tls: { keyFile: "key.pem", certFile: "cert.pem", rejectUnauthorized: false },
          socket: { data() {} },
        }),
      );
      return (await seen)[0].getPeerCertificate().valid_to;
    }
    const out = {};
    for (const [name, attempt] of [["connect", viaBunConnect], ["tls", viaNodeTls], ["clientCert", clientCertificate]]) {
      out[name] = [];
      for (const cwd of ["valid", "expired", "valid"]) {
        process.chdir(process.env.DIR + "/" + cwd);
        out[name].push(await attempt());
      }
    }
    console.log(JSON.stringify(out));
    process.exit(0);
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, DIR: String(dir), KEY: tlsCerts.key, CERT: tlsCerts.cert },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const validTo = (pem: string) => new X509Certificate(pem).validTo;
  expect(stdout ? JSON.parse(stdout) : stderr).toEqual({
    connect: ["OK", "DEPTH_ZERO_SELF_SIGNED_CERT", "OK"],
    tls: ["OK", "DEPTH_ZERO_SELF_SIGNED_CERT", "OK"],
    clientCert: [validTo(tlsCerts.cert), validTo(expiredTls.cert), validTo(tlsCerts.cert)],
  });
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("addCACert on one user-facing context does not affect another with identical options", () => {
  const a = tls.createSecureContext({});
  const b = tls.createSecureContext({});
  expect(a.context).not.toBe(b.context);
  a.context.addCACert(tlsCerts.cert);
  // b's native context is a different object and stays untouched.
  expect(a.context).not.toBe(b.context);
});

// The digest-interned cache is deliberately reachable only through internal
// paths, but if one leaks (Symbol.for constructor, TLSSocket internals) the
// mutator itself must refuse rather than silently poison every consumer.
test("addCACert on a digest-interned context throws instead of poisoning the cache", () => {
  const NativeSecureContext = tls.Server.prototype[Symbol.for("::buntlsnativesecurecontextctor::")];
  const a = NativeSecureContext.intern({ ca: tlsCerts.cert });
  const b = NativeSecureContext.intern({ ca: tlsCerts.cert });
  expect(a).toBe(b);
  expect(() => a.addCACert(tlsCerts.ca)).toThrow("cannot mutate a shared SecureContext");
});

// The exported constructor is user-facing too: it must never hand out the
// digest-interned SSL_CTX, or addCACert on one instance would silently extend
// the trust store of every context sharing that digest.
test("new tls.SecureContext() owns its native handle exclusively, like createSecureContext()", () => {
  const a = new (tls as any).SecureContext({ ca: tlsCerts.cert });
  const b = new (tls as any).SecureContext({ ca: tlsCerts.cert });
  // The interned cache would hand both the same native cell.
  expect(a.context).not.toBe(b.context);
});

test("addCACert on one exported SecureContext instance does not change what another verifies", async () => {
  // agent6's chain roots at ca1, which is not in the default roots: a client
  // using `b` must keep rejecting it after `a` starts trusting ca1 (Node
  // isolates the contexts and fails this connection closed).
  const fx = (n: string) => readFileSync(join(import.meta.dir, "fixtures", n), "utf8");
  const server = tls.createServer({ key: fx("agent6-key.pem"), cert: fx("agent6-cert.pem") }, s => s.end());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as import("net").AddressInfo;
  const a = new (tls as any).SecureContext({ ca: fx("ca2-cert.pem") });
  const b = new (tls as any).SecureContext({ ca: fx("ca2-cert.pem") });
  a.context.addCACert(fx("ca1-cert.pem"));
  const outcome = Promise.withResolvers<string>();
  const socket = tls.connect({
    port,
    host: "127.0.0.1",
    secureContext: b,
    rejectUnauthorized: true,
    checkServerIdentity: () => undefined,
  });
  socket.on("secureConnect", () => outcome.resolve(`secureConnect authorized=${socket.authorized}`));
  socket.on("error", error => outcome.resolve(`error ${(error as NodeJS.ErrnoException).code}`));
  try {
    expect(await outcome.promise).toBe("error UNABLE_TO_GET_ISSUER_CERT_LOCALLY");
  } finally {
    socket.destroy();
    server.close();
  }
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

test("a server's shared SSL_CTX is interned by its client-certificate policy too", () => {
  // The shared context carries the client-certificate policy in its verify
  // mode, and one SSL_CTX is one session cache. Two servers that share key
  // material but not that policy must get separate contexts: otherwise a
  // session minted by the permissive server resumes on the mTLS server, and a
  // resumed handshake skips client authentication.
  const permissive = tls.createServer({ ...tlsCerts });
  const mutual = tls.createServer({ ...tlsCerts, requestCert: true });
  const optionalCert = tls.createServer({ ...tlsCerts, requestCert: true, rejectUnauthorized: false });
  // The same options still intern to one context, so the split above is the
  // policy and not a broken digest.
  const sameAsPermissive = tls.createServer({ ...tlsCerts });
  const ctx = (s: tls.Server) => (s as any)._sharedCreds.context;
  try {
    expect(ctx(permissive)).not.toBe(ctx(mutual));
    expect(ctx(permissive)).not.toBe(ctx(optionalCert));
    expect(ctx(mutual)).not.toBe(ctx(optionalCert));
    expect(ctx(sameAsPermissive)).toBe(ctx(permissive));
    // requestCert is constructor-only, so a later call does not name it.
    mutual.setSecureContext({ ...tlsCerts });
    expect(ctx(mutual)).not.toBe(ctx(permissive));
  } finally {
    for (const s of [permissive, mutual, optionalCert, sameAsPermissive]) s.close();
  }
});

// `tls.Server.close()` must release the listener's SSL_CTX ref immediately.
// It used to be dropped only when the GC finalized the Listener, so a `Server`
// the program still references — or any server at process exit — kept its CTX
// alive. That is the leak `leak:create_ssl_context_from_bun_options` used to
// suppress. The listen socket up_refs its own ref in
// `us_internal_init_listen_socket` and each accepted socket's `SSL_new()` takes
// another, so releasing at close() cannot dangle.
test("tls.Server.close() releases the listener's SSL_CTX without waiting for GC", async () => {
  // Hold strong references so the GC can never finalize these Listeners; a
  // distinct `sessionTimeout` per server gives each its own cache entry.
  // tls.createServer() builds the server's shared SecureContext up front, and
  // that one lives as long as the Server object (like Node's `_sharedCreds`),
  // so the baseline is taken with the servers constructed: the listener's own
  // SSL_CTX is the one close() must release.
  const kept: tls.Server[] = [];
  for (let i = 0; i < 5; i++) {
    kept.push(tls.createServer({ ...tlsCerts, sessionTimeout: 100 + i }));
  }
  Bun.gc(true);
  const before = sslCtxLiveCount();

  let peak = 0;
  for (const server of kept) {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    peak = Math.max(peak, sslCtxLiveCount() - before);
    server.close();
    await once(server, "close");
  }

  // No Bun.gc() here on purpose: the point is that close() alone frees them.
  // `peak: 1` proves each listen() did hold a context of its own meanwhile.
  expect({ leaked: sslCtxLiveCount() - before, peak, servers: kept.length }).toEqual({
    leaked: 0,
    peak: 1,
    servers: 5,
  });
});

// Releasing at close() must not pull the CTX out from under a socket the
// server already accepted.
test("a connection accepted before close() keeps working after it", async () => {
  const server = tls.createServer({ ...tlsCerts }, s => {
    s.on("error", () => {});
    s.on("data", d => s.write(d));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as import("net").AddressInfo;

  const client = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
  client.on("error", () => {});
  await once(client, "secureConnect");

  server.close(); // drops the listener's ref while `client` is still live
  Bun.gc(true);

  client.write("ping");
  const [echoed] = await once(client, "data");
  expect(echoed.toString()).toBe("ping");
  client.destroy();
});

test("fetch takes a context of its own per tls.DEFAULT_CIPHERS, and none while nothing is assigned", async () => {
  const script = `
    import tls from "node:tls";
    import { sslCtxLiveCount } from "bun:internal-for-testing";
    using server = Bun.serve({ port: 0, tls: ${JSON.stringify(tlsCerts)}, fetch: () => new Response("ok") });
    const request = () => fetch(server.url, { keepalive: false, tls: { rejectUnauthorized: false } }).then(res => res.text());
    await request(); // the server's context and the default one of fetch
    const created = [];
    for (const list of [undefined, undefined, "ECDHE-RSA-AES256-GCM-SHA384", undefined, "ECDHE-RSA-AES128-GCM-SHA256", undefined]) {
      if (list) tls.DEFAULT_CIPHERS = list;
      const before = sslCtxLiveCount();
      await request();
      created.push(sslCtxLiveCount() - before);
    }
    console.log(JSON.stringify(created));
  `;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  // Nothing assigned x2, a first list and the same again, a second list and the same again.
  expect(JSON.parse(stdout)).toEqual([0, 0, 1, 0, 1, 0]);
  expect(exitCode).toBe(0);
});

test("the default client context follows tls.DEFAULT_CIPHERS, and the one it replaces is released", async () => {
  using dir = tempDir("ssl-ctx-default-client", { "ca.pem": tlsCerts.cert });
  const script = `
    import tls from "node:tls";
    import { once } from "node:events";
    import { sslCtxLiveCount } from "bun:internal-for-testing";
    using server = Bun.serve({
      port: 0,
      tls: ${JSON.stringify(tlsCerts)},
      fetch: (req, server) => (server.upgrade(req) ? undefined : new Response("no")),
      websocket: { message: (ws, message) => void ws.send(message) },
    });
    async function open() {
      const ws = new WebSocket("wss://localhost:" + server.port + "/");
      await once(ws, "open");
      return ws;
    }
    async function close(ws) {
      ws.close();
      await once(ws, "close");
    }
    function assign(list) {
      tls.DEFAULT_CIPHERS = list;
      Bun.gc(true); // the context the setter validates the list with
    }
    const deltas = {};
    async function step(name, expected, run) {
      const before = sslCtxLiveCount();
      await run();
      // A closed socket is freed a few turns of the loop after its 'close' event.
      for (let i = 0; i < 1000 && sslCtxLiveCount() - before !== expected; i++) await new Promise(setImmediate);
      deltas[name] = sslCtxLiveCount() - before;
    }
    let kept;
    await step("first connection", 1, async () => void (kept = await open()));
    await step("second connection", 0, async () => close(await open()));
    await step("assignment while a connection is open", 0, () => assign("ECDHE-RSA-AES256-GCM-SHA384"));
    await step("that connection still works", 0, async () => {
      kept.send("ping");
      if ((await once(kept, "message"))[0].data !== "ping") throw new Error("no echo");
    });
    await step("connection after the assignment", 1, async () => close(await open()));
    await step("another one", 0, async () => close(await open()));
    await step("the first connection closes", -1, () => close(kept));
    await step("reassignment", -1, () => assign("ECDHE-RSA-AES128-GCM-SHA256"));
    await step("connection after the reassignment", 1, async () => close(await open()));
    console.log(JSON.stringify(deltas));
    process.exit(0);
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, NODE_EXTRA_CA_CERTS: join(String(dir), "ca.pem") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    "first connection": 1,
    "second connection": 0,
    "assignment while a connection is open": 0,
    "that connection still works": 0,
    "connection after the assignment": 1,
    "another one": 0,
    "the first connection closes": -1,
    "reassignment": -1,
    "connection after the reassignment": 1,
  });
  expect(exitCode).toBe(0);
});
