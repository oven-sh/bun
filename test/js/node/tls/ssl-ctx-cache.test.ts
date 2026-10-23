// Native `SSLContextCache`: every JS-thread consumer that turns an SSL
// config into an `SSL_CTX*` should hit the same per-VM cache, so identical
// configs (including `{servername}`-only and inline-CA configs) allocate one
// CTX, not one per connection. The cache holds a ref on the 16 contexts asked
// for last. Any other goes when its last real owner drops it: BoringSSL's
// ex_data free callback tombstones the entry.
import { describe, expect, test } from "bun:test";
import { X509Certificate } from "node:crypto";
import { once } from "node:events";
import tls from "node:tls";
// debug-only export
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
      tls: { servername: "localhost", rejectUnauthorized: false } as Bun.TLSOptions,
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
  const c = tls.createSecureContext({ rejectUnauthorized: false } as tls.SecureContextOptions);
  expect(c.context).not.toBe(a.context);
});

// createSecureContext() doesn't go through the cache, so nothing but the object holds its SSL_CTX.
test("a createSecureContext() SSL_CTX is freed once the object is collected", async () => {
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

  // SecureContext.finalize SSL_CTX_free()s. Finalizer scheduling doesn't
  // guarantee N passes is enough — await the condition.
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
  expect(() => a.addCACert((tlsCerts as any).ca)).toThrow("cannot mutate a shared SecureContext");
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

test("ca: [] verifies against the setDefaultCACertificates() list, like no ca", async () => {
  // Node trusts nothing for an empty list. Here it means no `ca` was given, in every API that takes TLS options.
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

    const c2 = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false, servername: "agent1", ca: [] });
    await once(c2, "secureConnect");
    expect(c2.authorized).toBe(true);
    c2.end();
    await once(c2, "close");

    server.close();
    await once(server, "close");
  } finally {
    tls.setDefaultCACertificates(prevCerts);
  }
});

test("setDefaultCACertificates() applies to a server whose ca is falsy, as to one with no ca", async () => {
  // tls.Server counts a falsy ca as absent:
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1451-L1454
  const keys = (f: string) => readFileSync(join(import.meta.dir, "../test/fixtures/keys", f), "utf8");
  const agent1 = { key: keys("agent1-key.pem"), cert: keys("agent1-cert.pem") };
  const prevCerts = tls.getCACertificates("default");
  tls.setDefaultCACertificates([keys("ca1-cert.pem")]);
  try {
    for (const ca of ["", false, 0]) {
      const server = tls.createServer({ ...agent1, ca, requestCert: true, rejectUnauthorized: false } as any);
      try {
        const authorized = Promise.withResolvers<boolean>();
        server.on("secureConnection", socket => {
          authorized.resolve(socket.authorized);
          socket.end();
        });
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const port = (server.address() as import("net").AddressInfo).port;
        // ca1, now a process default, issued the client's certificate.
        const client = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false, ...agent1 });
        await once(client, "secureConnect");
        expect([ca, await authorized.promise]).toEqual([ca, true]);
        client.end();
        await once(client, "close");
      } finally {
        server.close();
      }
    }
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

// In a process of its own, so that the cache keeps nothing from an earlier test. Prints what `script` assigns to `result`.
async function inAFreshProcess(script: string) {
  const prelude = `
    const { sslCtxLiveCount } = require("bun:internal-for-testing");
    const tls = ${JSON.stringify(tlsCerts)};
    const result = {};
    // A config that no other call has, and so an SSL_CTX of its own.
    let configs = 0;
    const own = options => ({ ...options, passphrase: String(configs++) });
    const turn = () => new Promise(resolve => setImmediate(resolve));
    // uSockets frees a closed socket, and with it the SSL, at the end of the loop iteration.
    async function settle(before, expected) {
      for (let i = 0; i < 100 && sslCtxLiveCount() - before > expected; i++) await turn();
      return sslCtxLiveCount() - before;
    }
    const sockets = [];
    let builds = 0;
    // One connection: handshake, close. The context is built inside the call, so the count rises across it.
    function connectOnce(port, options) {
      const { promise, resolve, reject } = Promise.withResolvers();
      const live = sslCtxLiveCount();
      Bun.connect({
        hostname: "127.0.0.1",
        port,
        tls: options,
        socket: {
          data() {},
          open(socket) { sockets.push(socket); },
          handshake(socket) { socket.end(); },
          close() { resolve(); },
          error(socket, error) { reject(error); },
          connectError(socket, error) { reject(error); },
        },
      }).catch(reject);
      if (sslCtxLiveCount() > live) builds++;
      return promise;
    }
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `${prelude}${script}\nconsole.log(JSON.stringify(result)); process.exit(0);`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { result: stdout.startsWith("{") ? JSON.parse(stdout) : stdout, stderr, exitCode };
}

describe.concurrent("how long the cache keeps a context that nothing else holds", () => {
  // Neither a collection nor an open connection keeps the context here: each one has closed, and a turn of the loop has freed it.
  test.each([
    ["tls: true", "true"],
    ["a ca", "{ ca: tls.cert }"],
    [
      "the bundled roots and one more as ca, cert and key",
      `{ ca: [...require("node:tls").rootCertificates, tls.cert], ...tls }`,
    ],
  ])("connections made one at a time with %s build their SSL_CTX once", async (_name, options) => {
    expect(
      await inAFreshProcess(`
        using listener = Bun.listen({ hostname: "127.0.0.1", port: 0, tls, socket: { data() {} } });
        for (let i = 0; i < 10; i++) {
          await connectOnce(listener.port, ${options});
          await turn();
          await turn();
        }
        result.builds = builds;
      `),
    ).toEqual({ result: { builds: 1 }, stderr: "", exitCode: 0 });
  });

  test("it keeps the 16 asked for last, however many there were", async () => {
    expect(
      await inAFreshProcess(`
        using listener = Bun.listen({ hostname: "127.0.0.1", port: 0, tls, socket: { data() {} } });
        const before = sslCtxLiveCount();
        for (let i = 0; i < 40; i++) await connectOnce(listener.port, own({ ca: tls.cert }));
        result.after40Configs = await settle(before, 16);
        for (let i = 0; i < 20; i++) await connectOnce(listener.port, { ca: tls.cert });
        result.after20ConnectionsWithOneMore = await settle(before, 16);
      `),
    ).toEqual({ result: { after40Configs: 16, after20ConnectionsWithOneMore: 16 }, stderr: "", exitCode: 0 });
  });

  test("the one used last stays, not the one made last", async () => {
    expect(
      await inAFreshProcess(`
        const listen = options => Bun.listen({ hostname: "127.0.0.1", port: 0, tls: options, socket: { data() {} } });
        // The others stay open and so hold their contexts. Pushing one out frees nothing, so a build shows as one more.
        const open = [];
        function builtFor(options) {
          const live = sslCtxLiveCount();
          listen(options).stop();
          return sslCtxLiveCount() - live;
        }
        const used = own(tls), unused = own(tls);
        result.first = [builtFor(used), builtFor(unused)];
        result.usedAfterEachOther = 0;
        for (let i = 0; i < 30; i++) {
          open.push(listen(own(tls)));
          result.usedAfterEachOther += builtFor(used);
        }
        result.notUsedSince = builtFor(unused);
      `),
    ).toEqual({ result: { first: [1, 1], usedAfterEachOther: 0, notUsedSince: 1 }, stderr: "", exitCode: 0 });
  });

  test("a context it keeps doesn't answer for options that have come to mean something else", async () => {
    expect(
      await inAFreshProcess(`
        const node = require("node:tls");
        const server = node.createServer({ ...tls, maxVersion: "TLSv1.2" }, socket => socket.on("error", () => {}));
        await require("node:events").once(server.listen(0, "127.0.0.1"), "listening");
        // The same options each time, with nothing left open in between.
        async function connect() {
          const { promise, resolve, reject } = Promise.withResolvers();
          Bun.connect({
            hostname: "127.0.0.1",
            port: server.address().port,
            tls: { serverName: "localhost", rejectUnauthorized: false },
            socket: {
              data() {},
              handshake(socket, ok, error) {
                resolve((socket.authorized ? "authorized" : error.code) + " " + socket.getCipher().name);
                socket.end();
              },
              connectError: (socket, error) => reject(error),
            },
          }).catch(reject);
          const outcome = await promise;
          await turn();
          await turn();
          return outcome;
        }
        const roots = node.getCACertificates("default"), ciphers = node.DEFAULT_CIPHERS;
        result.atFirst = await connect();
        node.setDefaultCACertificates([tls.cert]);
        result.withTheCertificateAsDefaultCA = await connect();
        node.setDefaultCACertificates(roots);
        result.withTheRootsAgain = await connect();
        node.DEFAULT_CIPHERS = "ECDHE-RSA-AES256-GCM-SHA384";
        result.withOtherDefaultCiphers = await connect();
        node.DEFAULT_CIPHERS = ciphers;
        result.withTheFirstCiphersAgain = await connect();
      `),
    ).toEqual({
      result: {
        atFirst: "DEPTH_ZERO_SELF_SIGNED_CERT ECDHE-RSA-AES128-GCM-SHA256",
        withTheCertificateAsDefaultCA: "authorized ECDHE-RSA-AES128-GCM-SHA256",
        withTheRootsAgain: "DEPTH_ZERO_SELF_SIGNED_CERT ECDHE-RSA-AES128-GCM-SHA256",
        withOtherDefaultCiphers: "DEPTH_ZERO_SELF_SIGNED_CERT ECDHE-RSA-AES256-GCM-SHA384",
        withTheFirstCiphersAgain: "DEPTH_ZERO_SELF_SIGNED_CERT ECDHE-RSA-AES128-GCM-SHA256",
      },
      stderr: "",
      exitCode: 0,
    });
  });

  // It used to be dropped only when the GC finalized the Listener, so a listener the program still
  // references, or any at process exit, kept its CTX alive. A tls.Server's listener serves the
  // Server's own context, which outlives close(). One from Bun.listen() shows its reference in the count.
  test("Listener.stop() releases its SSL_CTX without waiting for GC", async () => {
    expect(
      await inAFreshProcess(`
        const before = sslCtxLiveCount();
        // The program holds every Listener, so no collection can finalize one.
        const listeners = [];
        for (let i = 0; i < 20; i++) {
          listeners.push(Bun.listen({ hostname: "127.0.0.1", port: 0, tls: own(tls), socket: { data() {} } }));
        }
        result.listening = sslCtxLiveCount() - before;
        for (const listener of listeners) listener.stop();
        result.stopped = sslCtxLiveCount() - before;
      `),
      // `listening` is the control: a listener does hold its context. What is left is what the cache keeps.
    ).toEqual({ result: { listening: 20, stopped: 16 }, stderr: "", exitCode: 0 });
  });

  test("Bun.serve() and Bun.listen() servers with the same tls options share one SSL_CTX", async () => {
    expect(
      await inAFreshProcess(`
        const before = sslCtxLiveCount();
        const servers = [];
        for (let i = 0; i < 5; i++) {
          servers.push(Bun.serve({ port: 0, tls, fetch: () => new Response("ok") }));
          servers.push(Bun.listen({ hostname: "127.0.0.1", port: 0, tls, socket: { data() {} } }));
        }
        result.live = sslCtxLiveCount() - before;
      `),
    ).toEqual({ result: { live: 1 }, stderr: "", exitCode: 0 });
  });

  test("a Worker's contexts go with the Worker", async () => {
    expect(
      await inAFreshProcess(`
        const before = sslCtxLiveCount();
        const worker = new Worker(
          "data:text/javascript," +
            encodeURIComponent(\`
              const tls = \${JSON.stringify(tls)};
              for (let i = 0; i < 20; i++) {
                Bun.listen({ hostname: "127.0.0.1", port: 0, tls: { ...tls, passphrase: String(i) }, socket: { data() {} } }).stop();
              }
              postMessage("done");
            \`),
        );
        await new Promise(resolve => (worker.onmessage = resolve));
        result.whileTheWorkerRuns = sslCtxLiveCount() - before;
        await worker.terminate();
        result.afterItsEnd = await settle(before, 0);
      `),
    ).toEqual({ result: { whileTheWorkerRuns: 16, afterItsEnd: 0 }, stderr: "", exitCode: 0 });
  });
});

describe("servers that share an SSL_CTX", () => {
  const key = (name: string) => readFileSync(join(import.meta.dir, "../test/fixtures/keys", name), "utf8");
  // ca1 signs agent1, ca2 signs agent3. agent2 is self-signed.
  const agent1 = { key: key("agent1-key.pem"), cert: key("agent1-cert.pem") };
  const agent2 = { key: key("agent2-key.pem"), cert: key("agent2-cert.pem") };
  const agent3 = { key: key("agent3-key.pem"), cert: key("agent3-cert.pem") };
  const ca = [key("ca1-cert.pem"), agent2.cert];
  const fetch = () => new Response("ok");

  // Resolves with what the handshake settled, or with the error code.
  function hello(port: number, options: tls.ConnectionOptions = {}) {
    const { promise, resolve } = Promise.withResolvers<string>();
    const socket = tls.connect(
      { port, host: "127.0.0.1", ca, checkServerIdentity: () => undefined, ...options },
      () => {
        const settled = `${socket.getPeerCertificate().subject.CN} ${socket.alpnProtocol} ${socket.isSessionReused()}`;
        // A TLS 1.3 server refuses the client's certificate after the client's handshake has ended.
        socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
        socket.once("data", () => resolve(settled));
        socket.once("close", () => resolve("closed"));
      },
    );
    socket.on("error", (err: NodeJS.ErrnoException) => resolve(String(err.code)));
    return promise.finally(() => socket.destroy());
  }

  test("each select their own ALPN protocol", async () => {
    using http2 = Bun.serve({ port: 0, tls: agent1, http2: true, fetch });
    using http2Only = Bun.serve({ port: 0, tls: agent1, http2: true, http1: false, fetch });
    using http1 = Bun.serve({ port: 0, tls: agent1, fetch });
    using listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      tls: { ...agent1, ALPNProtocols: "\x03foo" },
      socket: { data: socket => void socket.end("ok") },
    });
    const ALPNProtocols = ["foo", "http/1.1", "h2"];
    // Twice, because a selector on the shared context would be that of the server that accepted last.
    for (let round = 0; round < 2; round++) {
      expect({
        http2: await hello(http2.port!, { ALPNProtocols }),
        http2Only: await hello(http2Only.port!, { ALPNProtocols }),
        http1: await hello(http1.port!, { ALPNProtocols }),
        listener: await hello(listener.port, { ALPNProtocols }),
      }).toEqual({
        http2: "agent1 h2 false",
        http2Only: "agent1 h2 false",
        http1: "agent1 false false",
        listener: "agent1 foo false",
      });
    }
    expect({
      http2: await hello(http2.port!, { ALPNProtocols: ["foo"] }),
      http2Only: await hello(http2Only.port!, { ALPNProtocols: ["foo"] }),
    }).toEqual({ http2: "agent1 false false", http2Only: "ERR_SSL_TLSV1_ALERT_NO_APPLICATION_PROTOCOL" });
  });

  test("each have their own server names", async () => {
    using named = Bun.serve({ port: 0, tls: [agent1, { ...agent2, serverName: "two.test" }], fetch });
    using sameDefault = Bun.serve({ port: 0, tls: agent1, fetch });
    using sameAsTheName = Bun.serve({ port: 0, tls: agent2, fetch });
    const rows = {};
    for (const [name, server] of Object.entries({ named, sameDefault, sameAsTheName })) {
      rows[name] = [
        await hello(server.port!, { servername: "two.test" }),
        await hello(server.port!, { servername: "other.test" }),
      ];
    }
    expect(rows).toEqual({
      named: ["agent2 false false", "agent1 false false"],
      sameDefault: ["agent1 false false", "agent1 false false"],
      sameAsTheName: ["agent2 false false", "agent2 false false"],
    });
  });

  test("ask for a client certificate only where their own options say so", async () => {
    const mutual = { ...agent2, ca: key("ca2-cert.pem"), requestCert: true, rejectUnauthorized: true };
    using perName = Bun.serve({ port: 0, tls: [agent1, { ...mutual, serverName: "mutual.test" }], fetch });
    using whole = Bun.serve({ port: 0, tls: mutual, fetch });
    const servername = "mutual.test";
    const refused = "ERR_SSL_TLSV1_ALERT_CERTIFICATE_REQUIRED";
    expect({
      perName: [
        await hello(perName.port!),
        await hello(perName.port!, { servername }),
        await hello(perName.port!, { servername, ...agent3 }),
        await hello(perName.port!, { servername, ...agent1 }),
      ],
      whole: [
        await hello(whole.port!),
        await hello(whole.port!, { servername }),
        await hello(whole.port!, { servername, ...agent3 }),
        await hello(whole.port!, { servername, ...agent1 }),
      ],
    }).toEqual({
      perName: ["agent1 false false", refused, "agent2 false false", "closed"],
      whole: [refused, refused, "agent2 false false", "closed"],
    });
  });

  test.each(["TLSv1.2", "TLSv1.3"] as const)(
    "resume each other's %s sessions, and no other server's",
    async maxVersion => {
      using first = Bun.serve({ port: 0, tls: agent1, fetch });
      using sameOptions = Bun.serve({ port: 0, tls: agent1, fetch });
      using otherOptions = Bun.serve({ port: 0, tls: { ...agent1, ciphers: "ECDHE-RSA-AES256-GCM-SHA384" }, fetch });
      const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
      const socket = tls.connect({ port: first.port!, host: "127.0.0.1", ca, servername: "agent1", maxVersion });
      socket.on("session", resolve).on("error", reject);
      socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
      const session = await promise;
      socket.destroy();
      expect({
        first: await hello(first.port!, { session, maxVersion }),
        sameOptions: await hello(sameOptions.port!, { session, maxVersion }),
        otherOptions: await hello(otherOptions.port!, { session, maxVersion }),
      }).toEqual({ first: "agent1 false true", sameOptions: "agent1 false true", otherOptions: "agent1 false false" });
    },
  );
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
    await step("the first connection closes", 0, () => close(kept));
    await step("reassignment", 0, () => assign("ECDHE-RSA-AES128-GCM-SHA256"));
    await step("connection after the reassignment", 1, async () => close(await open()));
    // The cache keeps the 16 contexts asked for last, so only 16 others show whether anything else holds a replaced one.
    await step("16 other contexts push out the two that were replaced", 14, async () => {
      for (let i = 0; i < 16; i++) {
        Bun.listen({ hostname: "127.0.0.1", port: 0, tls: { ...${JSON.stringify(tlsCerts)}, passphrase: String(i) }, socket: { data() {} } }).stop();
      }
    });
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
    "the first connection closes": 0,
    "reassignment": 0,
    "connection after the reassignment": 1,
    "16 other contexts push out the two that were replaced": 14,
  });
  expect(exitCode).toBe(0);
});
