import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isASAN, tmpdirSync } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import tls from "node:tls";

type TLSOptions = {
  cert: string;
  key: string;
  passphrase?: string;
};

import { expiredTls, invalidTls, tls as validTls } from "harness";

const CERT_LOCALHOST_IP = { ...validTls };
const CERT_EXPIRED = { ...expiredTls };
// Self-signed leaf whose only SAN is DNS:localhost (no iPAddress SAN), so a
// connection dialled to 127.0.0.1 must fail hostname verification.
const CERT_LOCALHOST_ONLY = {
  cert: readFileSync(join(import.meta.dir, "../../../regression/issue/27890-localhost-only.crt"), "utf8"),
  key: readFileSync(join(import.meta.dir, "../../../regression/issue/27890-localhost-only.key"), "utf8"),
};

// Note: Do not use bun.sh as the example domain
// Cloudflare sometimes blocks automated requests to it.
// so it will cause flaky tests.
async function createServer(cert: TLSOptions, callback: (port: number) => Promise<any>) {
  using server = Bun.serve({
    port: 0,
    tls: cert,
    fetch() {
      return new Response("Hello World");
    },
  });
  await callback(server.port);
}

describe.concurrent("fetch-tls", () => {
  it("drops a caller-supplied Host header on a cross-origin redirect and never verifies TLS against it", async () => {
    // The redirect target records the Host header it actually receives.
    const receivedHostHeaders: (string | null)[] = [];
    using target = Bun.serve({
      port: 0,
      tls: CERT_LOCALHOST_IP,
      fetch(req) {
        receivedHostHeaders.push(req.headers.get("host"));
        return new Response("from-target");
      },
    });

    // The origin issues a cross-origin redirect (different port => different origin).
    using origin = Bun.serve({
      port: 0,
      tls: CERT_LOCALHOST_IP,
      fetch() {
        return new Response(null, {
          status: 302,
          headers: { Location: `https://127.0.0.1:${target.port}/moved` },
        });
      },
    });

    // fetch() invokes the JS checkServerIdentity callback once per connection
    // in the redirect chain, before that connection's request is written: the
    // request (and any cookies/credentials it carries) must not reach a hop
    // whose certificate the callback has not approved. So a redirect chain
    // yields one observation per hop, in order. The hostname handed to the
    // callback is the URL host of that hop: a request-level Host header is an
    // HTTP field only and never becomes the TLS identity.
    const verifiedHostnames: string[] = [];
    const res = await fetch(`https://127.0.0.1:${origin.port}/`, {
      keepalive: false,
      headers: { Host: "localhost" },
      tls: {
        ca: validTls.cert,
        checkServerIdentity(hostname: string) {
          verifiedHostnames.push(hostname);
          return undefined;
        },
      },
    });
    expect(await res.text()).toBe("from-target");

    expect(verifiedHostnames).toEqual(["127.0.0.1", "127.0.0.1"]);
    // The redirect target must see a Host header derived from its own URL,
    // not the override that was supplied for the previous origin.
    expect(receivedHostHeaders).toEqual([`127.0.0.1:${target.port}`]);
  });

  // The peer certificate is matched against the URL host (RFC 6125 / RFC 9525),
  // never against a caller-supplied Host request header. Otherwise a
  // header-forwarding caller (a reverse proxy passing inbound headers to an
  // upstream IP) lets the remote client pick which certificate name the
  // upstream connection accepts. Node's fetch behaves the same way: it verifies
  // the URL host and ignores the Host header for TLS.
  it("does not let a caller-supplied Host header become the certificate-verification target", async () => {
    const receivedHostHeaders: (string | null)[] = [];
    using server = Bun.serve({
      port: 0,
      tls: CERT_LOCALHOST_ONLY,
      fetch: req => {
        receivedHostHeaders.push(req.headers.get("host"));
        return new Response("ok");
      },
    });
    const ipUrl = `https://127.0.0.1:${server.port}/`;

    const attempt = (url: string, init?: RequestInit & { tls?: object }) =>
      fetch(url, { keepalive: false, ...init, tls: { ca: CERT_LOCALHOST_ONLY.cert, ...(init?.tls ?? {}) } }).then(
        r => ({ ok: true, status: r.status }),
        e => ({ ok: false, code: e.code }),
      );

    // Baseline: the certificate has no IP SAN, so verifying against the URL
    // host (127.0.0.1) must fail.
    expect(await attempt(ipUrl)).toEqual({ ok: false, code: "ERR_TLS_CERT_ALTNAME_INVALID" });

    // A Host header naming the certificate's DNS SAN must not make the IP
    // connection acceptable, and neither must any other value.
    expect(await attempt(ipUrl, { headers: { host: "localhost" } })).toEqual({
      ok: false,
      code: "ERR_TLS_CERT_ALTNAME_INVALID",
    });
    expect(await attempt(ipUrl, { headers: { host: "evil.test" } })).toEqual({
      ok: false,
      code: "ERR_TLS_CERT_ALTNAME_INVALID",
    });

    // The hostname handed to a JS checkServerIdentity is the URL host too.
    let seenHostname = "";
    expect(
      await attempt(ipUrl, {
        headers: { host: "localhost" },
        tls: {
          checkServerIdentity(hostname: string, cert: tls.PeerCertificate) {
            seenHostname = hostname;
            return tls.checkServerIdentity(hostname, cert);
          },
        },
      }),
    ).toEqual({ ok: false, code: "ERR_TLS_CERT_ALTNAME_INVALID" });
    expect(seenHostname).toBe("127.0.0.1");

    // tls.servername is the documented opt-in for "dial an IP, verify a name".
    // It keeps working, and the Host header still has no say.
    expect(await attempt(ipUrl, { tls: { servername: "localhost" } })).toEqual({ ok: true, status: 200 });
    expect(await attempt(ipUrl, { headers: { host: "evil.test" }, tls: { servername: "localhost" } })).toEqual({
      ok: true,
      status: 200,
    });

    // The inverse (issue #26579): a Host header that names nothing in the
    // certificate must not break a request whose URL host the certificate does
    // cover. The header still reaches the server as given.
    expect(await attempt(`https://localhost:${server.port}/`, { headers: { host: "whatever.invalid" } })).toEqual({
      ok: true,
      status: 200,
    });
    expect(receivedHostHeaders).toEqual(["127.0.0.1:" + server.port, "evil.test", "whatever.invalid"]);
  });

  // SNI follows the URL host as well. A server that selects its certificate by
  // SNI (or rejects unknown names) would otherwise answer with a certificate
  // for the Host header value, which can never match the URL host it is then
  // verified against.
  it("sends the URL host as the ClientHello SNI, not the Host request header", async () => {
    const seen: { sni: string | null; host: string | undefined }[] = [];
    const server = tls.createServer(
      {
        ...CERT_LOCALHOST_IP,
        SNICallback(servername, cb) {
          if (servername !== "localhost") return cb(new Error(`unexpected SNI ${servername}`));
          cb(null, tls.createSecureContext(CERT_LOCALHOST_IP));
        },
      },
      socket => {
        socket.once("data", data => {
          const host = /^host:\s*(.*)\r\n/im.exec(data.toString())?.[1];
          seen.push({ sni: socket.servername || null, host });
          socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
        });
      },
    );
    await new Promise<void>(resolve => server.listen(0, resolve));
    try {
      const port = (server.address() as import("node:net").AddressInfo).port;
      const get = async (url: string, host?: string) => {
        const res = await fetch(url, {
          keepalive: false,
          headers: host ? { Host: host } : {},
          tls: { ca: CERT_LOCALHOST_IP.cert },
        });
        return `${res.status} ${await res.text()}`;
      };
      // DNS URL host with a foreign Host header: SNI is the URL host.
      expect(await get(`https://localhost:${port}/`, "other.example")).toBe("200 ok");
      // IP URL host: no SNI at all (RFC 6066), whatever the Host header says.
      expect(await get(`https://127.0.0.1:${port}/`, "localhost")).toBe("200 ok");
      expect(seen).toEqual([
        { sni: "localhost", host: "other.example" },
        { sni: null, host: "localhost" },
      ]);
    } finally {
      server.close();
    }
  });

  it("can handle multiple requests with non native checkServerIdentity", async () => {
    await createServer(CERT_LOCALHOST_IP, async port => {
      async function request() {
        let called = false;
        const result = await fetch(`https://localhost:${port}`, {
          keepalive: false,
          tls: {
            ca: validTls.cert,
            checkServerIdentity(hostname: string, cert: tls.PeerCertificate) {
              called = true;
              return tls.checkServerIdentity(hostname, cert);
            },
          },
        }).then((res: Response) => res.blob());
        expect(result?.size).toBeGreaterThan(0);
        expect(called).toBe(true);
      }
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(request());
      }
      await Promise.all(promises);
    });
  });

  it("fetch with valid tls should not throw", async () => {
    await createServer(CERT_LOCALHOST_IP, async port => {
      const urls = [`https://localhost:${port}`, `https://127.0.0.1:${port}`];
      const promises = urls.map(async url => {
        const result = await fetch(url, { keepalive: false, tls: { ca: validTls.cert } }).then((res: Response) =>
          res.blob(),
        );
        expect(result?.size).toBeGreaterThan(0);
      });

      await Promise.all(promises);
    });
  });

  it("fetch with valid tls and non-native checkServerIdentity should work", async () => {
    await createServer(CERT_LOCALHOST_IP, async port => {
      for (const isBusy of [true, false]) {
        let count = 0;
        const urls = [`https://localhost:${port}`, `https://127.0.0.1:${port}`];
        const promises = urls.map(async url => {
          await fetch(url, {
            keepalive: false,
            tls: {
              ca: validTls.cert,
              checkServerIdentity(hostname: string, cert: tls.PeerCertificate) {
                count++;
                return tls.checkServerIdentity(hostname, cert);
              },
            },
          }).then((res: Response) => res.blob());
        });
        if (isBusy) {
          const start = performance.now();
          while (performance.now() - start < 500) {}
        }
        await Promise.all(promises);
        expect(count).toBe(2);
      }
    });
  });

  it("fetch with valid tls and non-native checkServerIdentity that throws should reject", async () => {
    await createServer(CERT_LOCALHOST_IP, async port => {
      let count = 0;
      const urls = [`https://localhost:${port}`, `https://127.0.0.1:${port}`];
      const promises = urls.map(async url => {
        await fetch(url, {
          keepalive: false,
          tls: {
            ca: validTls.cert,
            checkServerIdentity(hostname: string, cert: tls.PeerCertificate) {
              count++;
              throw new Error("CustomError");
            },
          },
        });
      });
      const start = performance.now();
      while (performance.now() - start < 1000) {}
      expect((await Promise.allSettled(promises)).every(p => p.status === "rejected")).toBe(true);
      expect(count).toBe(2);
    });
  });

  it("fetch with rejectUnauthorized: false should not call checkServerIdentity", async () => {
    await createServer(CERT_LOCALHOST_IP, async port => {
      let count = 0;

      await fetch(`https://localhost:${port}`, {
        keepalive: false,
        tls: {
          rejectUnauthorized: false,
          checkServerIdentity(hostname: string, cert: tls.PeerCertificate) {
            count++;
            return tls.checkServerIdentity(hostname, cert);
          },
        },
      }).then((res: Response) => res.blob());
      expect(count).toBe(0);
    });
  });

  // A second fetch to the same origin after `Connection: close` has to open a
  // fresh TLS connection (no keep-alive socket to reuse). With a client-side
  // session cache, that connect offers the ticket from the first handshake and
  // the server observes a resumed session; without one, it's a full handshake.
  // TLS 1.2 delivers the session inside SSL_do_handshake (before
  // checkServerIdentity runs), TLS 1.3 as a post-handshake NewSessionTicket;
  // both paths must cache. Each fixture run exercises every scenario against
  // its own server (fresh port) so the cache key keeps them isolated.
  describe("client-side TLS session resumption", () => {
    const fixture = join(import.meta.dir, "fetch.tls.session-resumption-fixture.ts");
    async function run(version: string, env: Record<string, string> = {}) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), fixture, version],
        env: { ...bunEnv, ...env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toMatch(/AddressSanitizer|ERROR: (Leak|Thread)Sanitizer/);
      expect(stdout.trim()).toStartWith("{");
      expect(exitCode).toBe(0);
      return JSON.parse(stdout.trim()) as {
        default: boolean[];
        mismatch: boolean[];
        checkServerIdentity: boolean[];
        portIsolation: { a: boolean[]; b: boolean[] };
        hostIsolation: boolean[];
      };
    }

    // Each run starts six TLS servers and performs ~12 handshakes in a
    // debug+ASAN subprocess, which can exceed the default timeout when all
    // four run under `describe.concurrent`.
    const timeout = isASAN ? 20_000 : 10_000;
    for (const version of ["TLSv1.2", "TLSv1.3"]) {
      it(
        `caches only verified sessions keyed on (host, port) (${version})`,
        async () => {
          const r = await run(version);
          expect({
            default: r.default,
            checkServerIdentity: r.checkServerIdentity,
            portIsolation: r.portIsolation,
            hostIsolation: r.hostIsolation,
          }).toEqual({
            // Second fresh connect to the same origin resumes.
            default: [false, true],
            // A JS checkServerIdentity callback is excluded (verdict arrives
            // off-thread after on_handshake), so the second fetch sees no
            // cached ticket.
            checkServerIdentity: [false, false],
            // Same hostname + SSLConfig, different port: no resumption.
            portIsolation: { a: [false], b: [false] },
            // Same port + SSLConfig, different connect hostname: no resumption.
            hostIsolation: [false, false],
          });
          // A handshake rejected by checkServerIdentity (trusted chain, wrong
          // SAN) must not seed the cache. The fixture asserts each fetch
          // rejects with ERR_TLS_CERT_ALTNAME_INVALID; the client may RST
          // before the server completes its side of a TLS 1.3 handshake, so
          // fewer than two entries is acceptable.
          expect(r.mismatch).not.toContain(true);
        },
        timeout,
      );

      it(
        `is disabled by BUN_FEATURE_FLAG_DISABLE_FETCH_TLS_SESSION_CACHE (${version})`,
        async () => {
          const r = await run(version, { BUN_FEATURE_FLAG_DISABLE_FETCH_TLS_SESSION_CACHE: "1" });
          expect(r.default).toEqual([false, false]);
        },
        timeout,
      );
    }
  });

  // Covers a family of HTTP-thread crashes (sentry BUN-2WC6 and siblings) where
  // a certificate identity failure during a handshake completed from the
  // SSL_read path, racing aborts, idle timeouts, and keepalive churn, caused a
  // finished HTTPClient to deliver its final result twice: the second delivery
  // read the freed AsyncHTTP clone and called through a null callback pointer.
  // The fixture drives that exact traffic shape and exits non-zero on any
  // unexpected outcome; every failure must surface as a catchable error.
  it("rejects a trusted cert with a mismatched hostname cleanly under abort/timeout/keepalive churn", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "fetch.tls.cert-mismatch-churn.fixture.ts")],
      env: { ...bunEnv, BUN_CONFIG_HTTP_IDLE_TIMEOUT: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Check stderr for sanitizer reports first (and unconditionally): a
    // recovered ASAN report can leave exit code 0, and on an abort this
    // surfaces the actual report instead of a bare exit-code mismatch.
    // Don't assert emptiness: debug builds emit benign startup noise.
    expect(stderr).not.toMatch(/AddressSanitizer|ERROR: (Leak|Thread)Sanitizer/);
    // Fixture reports unexpected outcomes on stdout.
    expect(stdout).toStartWith("OK ");
    expect(exitCode).toBe(0);
    // The fixture's stalled handshakes wait for the padded 1s idle timer,
    // which the 4s sweep fires at ~4-8s, so this outlives the 5s default.
  }, 30_000);

  // When checkServerIdentity is provided, the HTTP thread sends an intermediate
  // progress update carrying the server certificate before response headers
  // arrive. If the connection then fails (e.g. an mTLS server rejects a
  // cert-less client and closes the socket after the handshake — issue #27275),
  // the failure result must still reject the fetch promise instead of being
  // swallowed by the "wait for metadata" early return.
  for (const withAbortSignal of [false, true]) {
    it(`fetch with checkServerIdentity rejects when connection closes before response headers${
      withAbortSignal ? " (with AbortSignal)" : ""
    }`, async () => {
      // TLS server that completes the handshake, receives the request, and
      // then immediately closes the socket without sending any HTTP response.
      const server = tls.createServer({ key: validTls.key, cert: validTls.cert }, socket => {
        socket.once("data", () => socket.destroy());
      });
      try {
        const { promise: listening, resolve: onListening } = Promise.withResolvers<void>();
        server.listen(0, onListening);
        await listening;
        const port = (server.address() as import("node:net").AddressInfo).port;

        const controller = withAbortSignal ? new AbortController() : undefined;
        let checkServerIdentityCalled = false;
        let err: unknown;
        try {
          await fetch(`https://localhost:${port}/`, {
            keepalive: false,
            signal: controller?.signal,
            tls: {
              ca: validTls.cert,
              checkServerIdentity() {
                checkServerIdentityCalled = true;
                return undefined;
              },
            },
          });
        } catch (e) {
          err = e;
        }

        // Previously the `await fetch(...)` above never settled and this test
        // timed out; with an AbortSignal attached, `controller.abort()` fired
        // the DOM event but the promise still hung because the FetchTasklet
        // had already been torn down. Node's `https.get` in the same scenario
        // emits `error` with ECONNRESET ("socket hang up").
        expect(checkServerIdentityCalled).toBe(true);
        expect(err).toBeInstanceOf(Error);
        expect((err as NodeJS.ErrnoException).code).toBe("ECONNRESET");

        // Aborting after the promise settled is a no-op but must not throw.
        controller?.abort();
        if (controller) expect(controller.signal.aborted).toBe(true);
      } finally {
        // Not awaited: Bun's tls.Server currently doesn't decrement its
        // connection count when the server-side socket is destroyed, so the
        // close callback never fires here. The listening handle is released
        // immediately regardless.
        server.close();
      }
    });
  }

  it("fetch with self-sign tls should throw", async () => {
    await createServer(CERT_LOCALHOST_IP, async port => {
      const urls = [`https://localhost:${port}`, `https://127.0.0.1:${port}`];
      await Promise.all(
        urls.map(async url => {
          try {
            await fetch(url).then((res: Response) => res.blob());
            expect.unreachable();
          } catch (e: any) {
            expect(e.code).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
          }
        }),
      );
    });
  });

  it("fetch with invalid tls should throw", async () => {
    await createServer(CERT_EXPIRED, async port => {
      await Promise.all(
        [`https://localhost:${port}`, `https://127.0.0.1:${port}`].map(async url => {
          try {
            await fetch(url).then((res: Response) => res.blob());
            expect.unreachable();
          } catch (e: any) {
            expect(e.code).toBe("CERT_HAS_EXPIRED");
          }
        }),
      );
    });
  });

  it("fetch with checkServerIdentity failing should throw", async () => {
    await createServer(CERT_LOCALHOST_IP, async port => {
      try {
        await fetch(`https://localhost:${port}`, {
          keepalive: false,
          tls: {
            ca: validTls.cert,
            checkServerIdentity() {
              return new Error("CustomError");
            },
          },
        }).then((res: Response) => res.blob());

        expect.unreachable();
      } catch (e: any) {
        expect(e.message).toBe("CustomError");
      }
    });
  });

  it("checkServerIdentity rejection prevents the request from being transmitted", async () => {
    // Records every plaintext (post-TLS-decryption) byte each connection
    // delivers. Nothing here waits on the rejected connection's server-side
    // lifecycle: the client tears that connection down as soon as
    // checkServerIdentity rejects, and on Windows the RST can arrive before
    // the server even accepts the socket, so its 'connection'/'close' events
    // are not guaranteed to fire.
    const receivedPerConnection: Buffer[][] = [];
    const server = tls.createServer({ key: validTls.key, cert: validTls.cert }, socket => {
      const chunks: Buffer[] = [];
      receivedPerConnection.push(chunks);
      socket.on("data", chunk => {
        chunks.push(chunk);
        // Reply to any complete request so the control fetch below can
        // round-trip.
        if (Buffer.concat(chunks).includes("\r\n\r\n")) {
          socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
        }
      });
      socket.on("error", () => {});
    });
    server.on("connection", rawSocket => {
      rawSocket.on("error", () => {});
    });
    try {
      const { promise: listening, resolve: onListening } = Promise.withResolvers<void>();
      server.listen(0, onListening);
      await listening;
      const port = (server.address() as import("node:net").AddressInfo).port;

      let err: unknown;
      try {
        await fetch(`https://localhost:${port}/`, {
          keepalive: false,
          headers: { Authorization: "Bearer super-secret-token" },
          tls: {
            ca: validTls.cert,
            checkServerIdentity() {
              return new Error("pinned");
            },
          },
        });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe("pinned");

      // Prove the rejected request never reached the server without waiting on
      // that connection's events: complete a full round trip on a control
      // request, then assert the control request is the only plaintext the
      // server ever decrypted. Anything the rejected connection had
      // transmitted would have been recorded long before the control response
      // made it back.
      const control = await fetch(`https://localhost:${port}/control`, {
        keepalive: false,
        tls: { ca: validTls.cert },
      });
      expect(await control.text()).toBe("ok");
      expect(control.status).toBe(200);

      // `localhost` can resolve to both ::1 and 127.0.0.1 and the client races
      // both, so connections that delivered no plaintext (handshake aborted or
      // race loser) are expected; none of them may have carried request bytes.
      const nonEmpty = receivedPerConnection.map(chunks => Buffer.concat(chunks)).filter(b => b.byteLength > 0);
      expect(nonEmpty.map(b => b.toString())).toEqual([expect.stringMatching(/^GET \/control HTTP\/1\.1\r\n/)]);
      expect(nonEmpty[0].includes("super-secret-token")).toBe(false);
    } finally {
      server.close();
    }
  });

  it("checkServerIdentity approval still transmits the request and round-trips the response", async () => {
    const receivedPerConnection: Buffer[][] = [];
    const server = tls.createServer({ key: validTls.key, cert: validTls.cert }, socket => {
      const chunks: Buffer[] = [];
      receivedPerConnection.push(chunks);
      socket.on("data", chunk => {
        chunks.push(chunk);
        // Reply once the request headers have fully arrived.
        if (Buffer.concat(chunks).includes("\r\n\r\n")) {
          socket.end("HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\napproved");
        }
      });
      socket.on("error", () => {});
    });
    try {
      const { promise: listening, resolve: onListening } = Promise.withResolvers<void>();
      server.listen(0, onListening);
      await listening;
      const port = (server.address() as import("node:net").AddressInfo).port;

      const verified: string[] = [];
      const res = await fetch(`https://localhost:${port}/`, {
        keepalive: false,
        tls: {
          ca: validTls.cert,
          checkServerIdentity(hostname: string) {
            verified.push(hostname);
            return undefined;
          },
        },
      });
      expect(await res.text()).toBe("approved");
      expect(verified).toEqual(["localhost"]);
      expect(receivedPerConnection.length).toBe(1);
      const request = Buffer.concat(receivedPerConnection[0]).toString();
      expect(request).toStartWith("GET / HTTP/1.1\r\n");
    } finally {
      server.close();
    }
  });

  // A keep-alive HTTPS server that counts accepted TCP connections (not
  // completed handshakes, so a client that aborts after verifying still counts).
  async function countingKeepAliveServer() {
    let connections = 0;
    const server = tls.createServer({ key: validTls.key, cert: validTls.cert }, socket => {
      const chunks: Buffer[] = [];
      socket.on("data", chunk => {
        chunks.push(chunk);
        if (Buffer.concat(chunks).includes("\r\n\r\n")) {
          chunks.length = 0;
          socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
        }
      });
      socket.on("error", () => {});
    });
    server.on("connection", () => connections++);
    const { promise: listening, resolve: onListening } = Promise.withResolvers<void>();
    server.listen(0, onListening);
    await listening;
    const port = (server.address() as import("node:net").AddressInfo).port;
    return {
      url: `https://127.0.0.1:${port}/`,
      get connections() {
        return connections;
      },
      [Symbol.dispose]() {
        server.close();
      },
    };
  }

  // https://github.com/oven-sh/bun/issues/40308
  it("reuses the keep-alive connection across requests that supply checkServerIdentity", async () => {
    using server = await countingKeepAliveServer();
    const seen: { hostname: string; fingerprint: string }[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await fetch(server.url, {
        tls: {
          ca: validTls.cert,
          // fresh closure per request, as most callers write it
          checkServerIdentity(hostname: string, cert: tls.PeerCertificate) {
            seen.push({ hostname, fingerprint: cert.fingerprint256 });
            return undefined;
          },
        },
      });
      expect(await res.text()).toBe("ok");
    }
    // Like Node's https.Agent: the callback runs when a connection is
    // established, and later requests reuse the approved connection.
    expect(seen).toEqual([{ hostname: "127.0.0.1", fingerprint: expect.any(String) }]);
    expect(server.connections).toBe(1);
  });

  it("keeps connections approved by checkServerIdentity and natively verified ones in separate pools", async () => {
    using server = await countingKeepAliveServer();
    const verified: string[] = [];
    const tlsWithCallback = {
      ca: validTls.cert,
      checkServerIdentity(hostname: string) {
        verified.push(hostname);
        return undefined;
      },
    };

    // 1st connection, identity approved by the callback.
    expect(await fetch(server.url, { tls: tlsWithCallback }).then(res => res.text())).toBe("ok");
    expect(server.connections).toBe(1);
    // No callback: must verify natively on its own (2nd) connection rather than
    // inherit the callback's verdict.
    expect(await fetch(server.url, { tls: { ca: validTls.cert } }).then(res => res.text())).toBe("ok");
    expect(server.connections).toBe(2);
    // Each kind keeps reusing its own connection.
    expect(await fetch(server.url, { tls: tlsWithCallback }).then(res => res.text())).toBe("ok");
    expect(await fetch(server.url, { tls: { ca: validTls.cert } }).then(res => res.text())).toBe("ok");
    expect(server.connections).toBe(2);
    expect(verified).toEqual(["127.0.0.1"]);
  });

  it("a checkServerIdentity request never takes a pooled connection established with NODE_TLS_REJECT_UNAUTHORIZED=0", async () => {
    // Self-signed and not in any CA store: only a lax request can connect.
    // NODE_TLS_REJECT_UNAUTHORIZED (rather than tls.rejectUnauthorized) keeps
    // lax and strict requests on the same default TLS context / pool key.
    using server = await countingKeepAliveServer();
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const url = process.argv[1];
          process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
          for (let i = 0; i < 2; i++) await fetch(url).then(r => r.text());
          process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";
          let calls = 0;
          const result = await fetch(url, { tls: { checkServerIdentity: () => void calls++ } }).then(
            r => r.text(),
            e => e.code,
          );
          // Back to lax: the pooled connection is still there for it.
          process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
          await fetch(url).then(r => r.text());
          console.log(JSON.stringify({ result, calls }));
        `,
        server.url,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    // Had it taken the pooled connection, the request would have succeeded;
    // instead it dialed its own (2nd) connection, which failed chain
    // verification before the callback could run. The final lax request found
    // the 1st connection still pooled.
    expect(JSON.parse(stdout)).toEqual({ result: "DEPTH_ZERO_SELF_SIGNED_CERT", calls: 0 });
    expect(server.connections).toBe(2);
    expect(exitCode).toBe(0);
  });

  it("honors a tls.ciphers list on the request", async () => {
    let secureConnections = 0;
    const server = tls.createServer(
      {
        key: validTls.key,
        cert: validTls.cert,
        ciphers: "ECDHE-RSA-AES128-GCM-SHA256",
        maxVersion: "TLSv1.2",
      },
      socket => {
        secureConnections++;
        const chunks: Buffer[] = [];
        socket.on("data", chunk => {
          chunks.push(chunk);
          if (Buffer.concat(chunks).includes("\r\n\r\n")) {
            socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
          }
        });
        socket.on("error", () => {});
      },
    );
    server.on("tlsClientError", () => {});
    try {
      const { promise: listening, resolve: onListening } = Promise.withResolvers<void>();
      server.listen(0, onListening);
      await listening;
      const port = (server.address() as import("node:net").AddressInfo).port;
      const url = `https://127.0.0.1:${port}/`;

      const matching = await fetch(url, {
        keepalive: false,
        tls: { ca: validTls.cert, ciphers: "ECDHE-RSA-AES128-GCM-SHA256" },
      });
      expect(await matching.text()).toBe("ok");
      expect(matching.status).toBe(200);
      expect(secureConnections).toBe(1);

      let err: unknown;
      try {
        await fetch(url, {
          keepalive: false,
          tls: { ca: validTls.cert, ciphers: "ECDHE-RSA-AES256-GCM-SHA384" },
        });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(Error);
      expect(secureConnections).toBe(1);
    } finally {
      server.close();
    }
  });

  it("fetch with self-sign certificate tls + rejectUnauthorized: false should not throw", async () => {
    await createServer(CERT_LOCALHOST_IP, async port => {
      const urls = [`https://localhost:${port}`, `https://127.0.0.1:${port}`];
      await Promise.all(
        urls.map(async url => {
          try {
            const result = await fetch(url, { tls: { rejectUnauthorized: false } }).then((res: Response) => res.text());
            expect(result).toBe("Hello World");
          } catch {
            expect.unreachable();
          }
        }),
      );
    });
  });

  it("fetch with invalid tls + rejectUnauthorized: false should not throw", async () => {
    await createServer(CERT_EXPIRED, async port => {
      const urls = [`https://localhost:${port}`, `https://127.0.0.1:${port}`];
      await Promise.all(
        urls.map(async url => {
          try {
            const result = await fetch(url, { tls: { rejectUnauthorized: false } }).then((res: Response) => res.text());
            expect(result).toBe("Hello World");
          } catch (e) {
            expect.unreachable();
          }
        }),
      );
    });
  });

  it("fetch should respect rejectUnauthorized env", async () => {
    await createServer(CERT_EXPIRED, async port => {
      const url = `https://localhost:${port}`;

      const promises = [];
      for (let i = 0; i < 2; i++) {
        const proc = Bun.spawn({
          env: {
            ...bunEnv,
            SERVER: url,
            NODE_TLS_REJECT_UNAUTHORIZED: i.toString(),
          },
          stderr: "inherit",
          stdout: "inherit",
          stdin: "inherit",
          cmd: [bunExe(), join(import.meta.dir, "fetch-reject-authorized-env-fixture.js")],
        });

        promises.push(proc.exited);
      }

      const [exitCode1, exitCode2] = await Promise.all(promises);
      expect(exitCode1).toBe(0);
      expect(exitCode2).toBe(1);
    });
  });

  for (const mode of ["main thread", "SHARE_ENV worker"]) {
    it(`delete process.env.NODE_TLS_REJECT_UNAUTHORIZED restores certificate verification (${mode})`, async () => {
      using server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        tls: CERT_EXPIRED,
        fetch() {
          return new Response("Hello World");
        },
      });
      const steps = `
        async function attempt() {
          try {
            const res = await fetch(process.env.SERVER, { keepalive: false });
            return await res.text();
          } catch (e) {
            return e.code;
          }
        }
        async function run() {
          const out = [];
          process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
          out.push(await attempt());
          delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
          out.push(String(process.env.NODE_TLS_REJECT_UNAUTHORIZED));
          out.push(await attempt());
          process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
          out.push(await attempt());
          process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";
          out.push(await attempt());
          return out;
        }
      `;
      const script =
        mode === "SHARE_ENV worker"
          ? `
        const { Worker, SHARE_ENV } = require("worker_threads");
        const worker = new Worker(
          ${JSON.stringify(steps + `run().then(out => require("worker_threads").parentPort.postMessage(out));`)},
          { eval: true, env: SHARE_ENV },
        );
        worker.on("message", out => console.log(JSON.stringify(out)));
        worker.on("error", e => { console.error(e); process.exit(1); });
        worker.on("exit", code => { if (code !== 0) process.exit(code); });
      `
          : steps + `console.log(JSON.stringify(await run()));`;
      const { NODE_TLS_REJECT_UNAUTHORIZED: _, ...env } = bunEnv as Record<string, string | undefined>;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: { ...env, SERVER: `https://127.0.0.1:${server.port}` },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout ? JSON.parse(stdout) : stderr).toEqual([
        "Hello World",
        "undefined",
        "CERT_HAS_EXPIRED",
        "Hello World",
        "CERT_HAS_EXPIRED",
      ]);
      expect(exitCode).toBe(0);
    });
  }

  it("fetch timeout works on tls", async () => {
    using server = Bun.serve({
      tls: validTls,
      // Explicit 127.0.0.1 (in the cert's SAN): "localhost" binds ::1 on
      // v6-first resolvers while the fetch client pins localhost to
      // 127.0.0.1, turning the timeout under test into ConnectionRefused.
      hostname: "127.0.0.1",
      port: 0,
      rejectUnauthorized: false,
      async fetch() {
        async function* body() {
          yield "Hello, ";
          await Bun.sleep(700); // should only take 200ms-350ms
          yield "World!";
        }
        return new Response(body);
      },
    });
    const start = performance.now();
    const TIMEOUT = 200;
    const THRESHOLD = 150 * (isASAN ? 2 : 1); // ASAN can be very slow, so we need to increase the threshold for it

    try {
      await fetch(server.url, {
        signal: AbortSignal.timeout(TIMEOUT),
        tls: { ca: validTls.cert },
      }).then(res => res.text());
      expect.unreachable();
    } catch (e) {
      expect(e.name).toBe("TimeoutError");
    } finally {
      const total = performance.now() - start;
      expect(total).toBeGreaterThanOrEqual(TIMEOUT - THRESHOLD);
      expect(total).toBeLessThanOrEqual(TIMEOUT + THRESHOLD);
    }
  });

  it("fetch should use NODE_EXTRA_CA_CERTS", async () => {
    using server = Bun.serve({
      port: 0,
      tls: validTls,
      fetch() {
        return new Response("OK");
      },
    });
    const cert_path = join(tmpdirSync(), "cert.pem");
    await Bun.write(cert_path, validTls.cert);

    const proc = Bun.spawn({
      env: {
        ...bunEnv,
        SERVER: server.url,
        NODE_EXTRA_CA_CERTS: cert_path,
      },
      stderr: "inherit",
      stdout: "inherit",
      stdin: "inherit",
      cmd: [bunExe(), join(import.meta.dir, "fetch.tls.extra-cert.fixture.js")],
    });

    expect(await proc.exited).toBe(0);
  });

  it("fetch should use NODE_EXTRA_CA_CERTS even if the used CA is not first in bundle", async () => {
    using server = Bun.serve({
      port: 0,
      tls: validTls,
      fetch() {
        return new Response("OK");
      },
    });

    const bundlePath = join(tmpdirSync(), "bundle.pem");
    const bundleContent = `${expiredTls.cert}\n${validTls.cert}`;
    await Bun.write(bundlePath, bundleContent);

    const proc = Bun.spawn({
      env: {
        ...bunEnv,
        SERVER: server.url,
        NODE_EXTRA_CA_CERTS: bundlePath,
      },
      stderr: "inherit",
      stdout: "inherit",
      stdin: "inherit",
      cmd: [bunExe(), join(import.meta.dir, "fetch.tls.extra-cert.fixture.js")],
    });

    expect(await proc.exited).toBe(0);
  });

  it("fetch should ignore invalid NODE_EXTRA_CA_CERTS", async () => {
    using server = Bun.serve({
      port: 0,
      tls: validTls,
      fetch() {
        return new Response("OK");
      },
    });

    for (const invalid of ["not-exist.pem", "", " "]) {
      const proc = Bun.spawn({
        env: {
          ...bunEnv,
          SERVER: server.url,
          NODE_EXTRA_CA_CERTS: invalid,
        },
        stderr: "pipe",
        stdout: "inherit",
        stdin: "inherit",
        cmd: [bunExe(), join(import.meta.dir, "fetch.tls.extra-cert.fixture.js")],
      });

      expect(await proc.exited).toBe(1);
      expect(await proc.stderr.text()).toContain("DEPTH_ZERO_SELF_SIGNED_CERT");
    }
  });

  it("fetch should ignore NODE_EXTRA_CA_CERTS if it's contains invalid cert", async () => {
    using server = Bun.serve({
      port: 0,
      tls: validTls,
      fetch() {
        return new Response("OK");
      },
    });

    const mixedValidAndInvalidCertsBundlePath = join(tmpdirSync(), "mixed-valid-and-invalid-certs-bundle.pem");
    await Bun.write(mixedValidAndInvalidCertsBundlePath, `${invalidTls.cert}\n${validTls.cert}`);

    const mixedInvalidAndValidCertsBundlePath = join(tmpdirSync(), "mixed-invalid-and-valid-certs-bundle.pem");
    await Bun.write(mixedInvalidAndValidCertsBundlePath, `${validTls.cert}\n${invalidTls.cert}`);

    for (const invalid of [mixedValidAndInvalidCertsBundlePath, mixedInvalidAndValidCertsBundlePath]) {
      const proc = Bun.spawn({
        env: {
          ...bunEnv,
          SERVER: server.url,
          NODE_EXTRA_CA_CERTS: invalid,
        },
        stderr: "pipe",
        stdout: "inherit",
        stdin: "inherit",
        cmd: [bunExe(), join(import.meta.dir, "fetch.tls.extra-cert.fixture.js")],
      });

      expect(await proc.exited).toBe(1);
      const stderr = await proc.stderr.text();
      expect(stderr).toContain("DEPTH_ZERO_SELF_SIGNED_CERT");
      expect(stderr).toContain("ignoring extra certs");
    }
  });
});

// Chrome 143 on desktop (node-libcurl-ja3 / tls.peet.ws). The extension field
// lists what Chrome sends; Chrome itself shuffles the order on every connection.
const CHROME_JA3 =
  "771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-5-10-11-13-16-18-23-27-35-43-45-51-17613-65037-65281,4588-29-23-24,0";

const TLS13_SUITES = [0x1301, 0x1302, 0x1303];
const EXT = {
  serverName: 0,
  statusRequest: 5,
  supportedGroups: 10,
  ecPointFormats: 11,
  signatureAlgorithms: 13,
  alpn: 16,
  sct: 18,
  padding: 21,
  extendedMasterSecret: 23,
  compressCertificate: 27,
  sessionTicket: 35,
  supportedVersions: 43,
  pskKeyExchangeModes: 45,
  keyShare: 51,
  alpsOld: 17513,
  alps: 17613,
  ech: 65037,
  renegotiationInfo: 65281,
};

function isGrease(value: number) {
  return (value & 0x0f0f) === 0x0a0a && value >> 8 === (value & 0xff);
}

interface ClientHello {
  version: number;
  ciphers: number[];
  extensions: { type: number; data: Uint8Array }[];
  extensionTypes: number[];
  groups: number[];
  pointFormats: number[];
  alpn: string[];
  supportedVersions: number[];
  keyShareGroups: number[];
  certCompression: number[];
  alps: { codepoint: number; protocols: string[] } | null;
  /** JA3 string: GREASE values removed, SNI kept when present. */
  ja3: string;
}

function parseClientHello(bytes: Uint8Array): ClientHello {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  const u8 = () => bytes[p++];
  const u16 = () => {
    const v = view.getUint16(p);
    p += 2;
    return v;
  };
  const u16list = (data: Uint8Array) => {
    const out: number[] = [];
    for (let i = 0; i + 1 < data.length; i += 2) out.push((data[i] << 8) | data[i + 1]);
    return out;
  };

  expect(u8()).toBe(0x16); // handshake record
  u16(); // record version
  u16(); // record length
  expect(u8()).toBe(0x01); // ClientHello
  p += 3; // handshake length
  const version = u16();
  p += 32; // random
  const sessionIdLength = u8();
  p += sessionIdLength;
  const cipherBytes = u16();
  const ciphers: number[] = [];
  for (let i = 0; i < cipherBytes; i += 2) ciphers.push(u16());
  const compressionLength = u8();
  p += compressionLength;
  const extensionBytes = u16();
  const end = p + extensionBytes;
  const extensions: ClientHello["extensions"] = [];
  while (p < end) {
    const type = u16();
    const len = u16();
    extensions.push({ type, data: bytes.subarray(p, p + len) });
    p += len;
  }
  expect(p).toBe(bytes.length);

  const ext = (type: number) => extensions.find(e => e.type === type)?.data;

  const groupsData = ext(EXT.supportedGroups);
  const groups = groupsData ? u16list(groupsData.subarray(2)) : [];
  const formatsData = ext(EXT.ecPointFormats);
  const pointFormats = formatsData ? Array.from(formatsData.subarray(1)) : [];

  const alpn: string[] = [];
  const alpnData = ext(EXT.alpn);
  if (alpnData) {
    let i = 2;
    while (i < alpnData.length) {
      const len = alpnData[i++];
      alpn.push(new TextDecoder().decode(alpnData.subarray(i, i + len)));
      i += len;
    }
  }

  const versionsData = ext(EXT.supportedVersions);
  const supportedVersions = versionsData ? u16list(versionsData.subarray(1)) : [];

  const keyShareGroups: number[] = [];
  const keyShareData = ext(EXT.keyShare);
  if (keyShareData) {
    let i = 2;
    while (i + 4 <= keyShareData.length) {
      keyShareGroups.push((keyShareData[i] << 8) | keyShareData[i + 1]);
      const len = (keyShareData[i + 2] << 8) | keyShareData[i + 3];
      i += 4 + len;
    }
  }

  const compressData = ext(EXT.compressCertificate);
  const certCompression = compressData ? u16list(compressData.subarray(1)) : [];

  let alps: ClientHello["alps"] = null;
  for (const codepoint of [EXT.alps, EXT.alpsOld]) {
    const data = ext(codepoint);
    if (!data) continue;
    const protocols: string[] = [];
    let i = 2;
    while (i < data.length) {
      const len = data[i++];
      protocols.push(new TextDecoder().decode(data.subarray(i, i + len)));
      i += len;
    }
    alps = { codepoint, protocols };
  }

  const extensionTypes = extensions.map(e => e.type);
  const ja3 = [
    version,
    ciphers.filter(c => !isGrease(c)).join("-"),
    extensionTypes.filter(t => !isGrease(t)).join("-"),
    groups.filter(g => !isGrease(g)).join("-"),
    pointFormats.join("-"),
  ].join(",");

  return {
    version,
    ciphers,
    extensions,
    extensionTypes,
    groups,
    pointFormats,
    alpn,
    supportedVersions,
    keyShareGroups,
    certCompression,
    alps,
    ja3,
  };
}

/**
 * Accepts one TCP connection, returns the raw ClientHello it receives, and
 * closes the connection. The fetch then fails; only the first flight matters.
 */
async function captureClientHello(tls: Record<string, unknown>, init: Record<string, unknown> = {}) {
  const { promise, resolve, reject } = Promise.withResolvers<Uint8Array>();
  let received = new Uint8Array(0);
  using listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(socket, chunk) {
        const next = new Uint8Array(received.length + chunk.length);
        next.set(received);
        next.set(chunk, received.length);
        received = next;
        if (received.length < 5) return;
        const recordLength = 5 + ((received[3] << 8) | received[4]);
        if (received.length < recordLength) return;
        resolve(received.subarray(0, recordLength));
        socket.end();
      },
      error(_socket, error) {
        reject(error);
      },
    },
  });

  // The server never answers, so the fetch always fails once the ClientHello is
  // out. A failure before that (`reject` after `resolve` is a no-op) is a real one.
  const request = fetch(`https://127.0.0.1:${listener.port}/`, {
    ...init,
    tls: { rejectUnauthorized: false, ...tls },
  }).catch(reject);
  const hello = parseClientHello(await promise);
  await request;
  return hello;
}

describe("fetch TLS fingerprint options", () => {
  it("the default ClientHello advertises no GREASE and no fingerprint-only extensions", async () => {
    const hello = await captureClientHello({});
    expect(hello.version).toBe(0x0303);
    expect(hello.ciphers.some(isGrease)).toBe(false);
    expect(hello.extensionTypes.some(isGrease)).toBe(false);
    expect(hello.groups.some(isGrease)).toBe(false);
    expect(hello.ciphers.slice(0, 3).sort()).toEqual(TLS13_SUITES);
    expect(hello.alpn).toEqual(["http/1.1"]);
    expect(hello.extensionTypes).toContain(EXT.statusRequest);
    expect(hello.extensionTypes).toContain(EXT.sct);
    expect(hello.extensionTypes).toContain(EXT.sessionTicket);
    expect(hello.extensionTypes).not.toContain(EXT.compressCertificate);
    expect(hello.extensionTypes).not.toContain(EXT.alps);
    expect(hello.extensionTypes).not.toContain(EXT.alpsOld);
    expect(hello.extensionTypes).not.toContain(EXT.ech);
  });

  it("ja3 sets the cipher order, the groups and the extension set", async () => {
    const hello = await captureClientHello({ ja3: CHROME_JA3 });
    const [, ciphers, extensions, groups, formats] = CHROME_JA3.split(",");

    // Cipher suites in the exact order of the string (TLS 1.3 suites forced
    // AES-first so this does not depend on the machine's AES hardware).
    expect(hello.ciphers.join("-")).toBe(ciphers);
    expect(hello.groups.join("-")).toBe(groups);
    expect(hello.pointFormats.join("-")).toBe(formats);

    // Same extension set. BoringSSL fixes the order, and padding (21) depends
    // on the ClientHello size, so compare as sets without it. No SNI: the
    // request goes to an IP literal.
    const expected = extensions
      .split("-")
      .map(Number)
      .filter(t => t !== EXT.serverName)
      .sort((a, b) => a - b);
    const actual = hello.extensionTypes.filter(t => t !== EXT.padding).sort((a, b) => a - b);
    expect(actual).toEqual(expected);

    expect(hello.certCompression).toEqual([2]); // brotli
    expect(hello.alps).toEqual({ codepoint: EXT.alps, protocols: ["h2"] });
    expect(hello.keyShareGroups).toEqual([4588, 29]);
    expect(hello.supportedVersions).toEqual([0x0304, 0x0303]);
    expect(hello.ciphers.some(isGrease)).toBe(false);
  });

  it("ja3 without TLS 1.3 suites offers TLS 1.2 only", async () => {
    const hello = await captureClientHello({
      ja3: "771,49195-49199-156-47,0-5-10-11-13-16-18-23-35-65281,29-23,0",
    });
    expect(hello.ciphers).toEqual([49195, 49199, 156, 47]);
    expect(hello.extensionTypes).not.toContain(EXT.supportedVersions);
    expect(hello.extensionTypes).not.toContain(EXT.keyShare);
    expect(hello.extensionTypes).not.toContain(EXT.pskKeyExchangeModes);
    expect(hello.groups).toEqual([29, 23]);
  });

  it("ja3 with TLS 1.3 suites only offers TLS 1.3 only", async () => {
    const hello = await captureClientHello({ ja3: "771,4865-4866-4867,0-10-13-16-43-45-51,29," });
    expect(hello.ciphers).toEqual(TLS13_SUITES);
    expect(hello.supportedVersions).toEqual([0x0304]);
    expect(hello.extensionTypes).not.toContain(EXT.sessionTicket);
    expect(hello.extensionTypes).not.toContain(EXT.extendedMasterSecret);
    expect(hello.extensionTypes).not.toContain(EXT.renegotiationInfo);
    expect(hello.extensionTypes).not.toContain(EXT.ecPointFormats);
  });

  it("ja3 can put ChaCha20 first among the TLS 1.3 suites", async () => {
    const hello = await captureClientHello({ ja3: "771,4867-4865-4866-49195,0-10-11-13-16-23-43-45-51-65281,29,0" });
    expect(hello.ciphers).toEqual([0x1303, 0x1301, 0x1302, 49195]);
  });

  it("ja3 GREASE values turn on grease", async () => {
    const hello = await captureClientHello({
      ja3: "771,2570-4865-4866-4867-49195,0-10-11-13-16-23-43-45-51-65281-2570,2570-29-23,0",
    });
    expect(hello.ciphers.filter(isGrease)).toHaveLength(1);
    expect(hello.groups.filter(isGrease)).toHaveLength(1);
    expect(hello.extensionTypes.filter(isGrease).length).toBeGreaterThan(0);
  });

  it("grease adds GREASE values to ciphers, extensions, groups and versions", async () => {
    const hello = await captureClientHello({ grease: true });
    expect(hello.ciphers.filter(isGrease)).toHaveLength(1);
    expect(hello.ciphers[0]).toSatisfy(isGrease);
    expect(hello.groups.filter(isGrease)).toHaveLength(1);
    expect(hello.supportedVersions.filter(isGrease)).toHaveLength(1);
    expect(hello.extensionTypes.filter(isGrease).length).toBeGreaterThan(0);
  });

  it("permuteExtensions shuffles the extension order", async () => {
    const fixed = await Promise.all([captureClientHello({}), captureClientHello({})]);
    expect(fixed[0].extensionTypes).toEqual(fixed[1].extensionTypes);

    // BoringSSL appends a padding extension (21) whenever the shuffle leaves an
    // empty-bodied extension last, so compare the sets without it.
    const withoutPadding = (types: number[]) => types.filter(t => t !== EXT.padding).sort((a, b) => a - b);
    const orders = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const hello = await captureClientHello({ permuteExtensions: true });
      orders.add(hello.extensionTypes.join("-"));
      expect(withoutPadding(hello.extensionTypes)).toEqual(withoutPadding(fixed[0].extensionTypes));
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it("certificateCompression lists the algorithms in the given order", async () => {
    expect((await captureClientHello({ certificateCompression: true })).certCompression).toEqual([2]);
    expect(
      (await captureClientHello({ certificateCompression: ["zstd", "zlib", "brotli", "zlib"] })).certCompression,
    ).toEqual([3, 1, 2]);
    expect((await captureClientHello({ certificateCompression: false })).extensionTypes).not.toContain(
      EXT.compressCertificate,
    );
  });

  it("applicationSettings picks the ALPS codepoint", async () => {
    expect((await captureClientHello({ applicationSettings: true })).alps).toEqual({
      codepoint: EXT.alps,
      protocols: ["h2"],
    });
    expect((await captureClientHello({ applicationSettings: 17513 })).alps).toEqual({
      codepoint: EXT.alpsOld,
      protocols: ["h2"],
    });
    expect((await captureClientHello({ applicationSettings: 17613 })).alps?.codepoint).toBe(EXT.alps);
  });

  it("echGrease adds a GREASE encrypted_client_hello extension", async () => {
    const hello = await captureClientHello({ echGrease: true });
    const ech = hello.extensions.find(e => e.type === EXT.ech);
    expect(ech).toBeDefined();
    expect(ech!.data.length).toBeGreaterThan(32);
  });

  it("ocspStapling, signedCertificateTimestamps and sessionTickets remove their extensions", async () => {
    const hello = await captureClientHello({
      ocspStapling: false,
      signedCertificateTimestamps: false,
      sessionTickets: false,
    });
    expect(hello.extensionTypes).not.toContain(EXT.statusRequest);
    expect(hello.extensionTypes).not.toContain(EXT.sct);
    expect(hello.extensionTypes).not.toContain(EXT.sessionTicket);
  });

  it("explicit options win over what ja3 implies", async () => {
    const hello = await captureClientHello({
      ja3: CHROME_JA3,
      certificateCompression: false,
      applicationSettings: false,
      echGrease: false,
      ciphers: "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256",
      ecdhCurve: "X25519",
    });
    expect(hello.extensionTypes).not.toContain(EXT.compressCertificate);
    expect(hello.extensionTypes).not.toContain(EXT.alps);
    expect(hello.extensionTypes).not.toContain(EXT.ech);
    expect(hello.ciphers).toEqual([...TLS13_SUITES, 49199]);
    expect(hello.groups).toEqual([29]);

    // `ecdhCurve: "auto"` asks for BoringSSL's default groups and also wins.
    const autoGroups = await captureClientHello({ ja3: CHROME_JA3, ecdhCurve: "auto" });
    expect(autoGroups.groups).toEqual([29, 23, 24]);

    // The other direction: an extension ja3 leaves out can be added back.
    const withTickets = await captureClientHello({
      ja3: "771,4865-4866-4867-49195,0-10-11-13-16-23-43-45-51-65281,29,0",
      sessionTickets: true,
    });
    expect(withTickets.extensionTypes).toContain(EXT.sessionTicket);
  });

  it("the ClientHello inside a CONNECT tunnel carries the fingerprint", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<Uint8Array>();
    let connectRequest: string | null = null;
    let received = new Uint8Array(0);
    using proxy = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(socket, chunk) {
          const next = new Uint8Array(received.length + chunk.length);
          next.set(received);
          next.set(chunk, received.length);
          received = next;
          if (connectRequest === null) {
            // The CONNECT request ends at the blank line; the client waits for
            // the 200 before it sends the ClientHello.
            const text = new TextDecoder().decode(received);
            const end = text.indexOf("\r\n\r\n");
            if (end === -1) return;
            connectRequest = text.slice(0, end + 4);
            received = received.subarray(Buffer.byteLength(connectRequest));
            socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
          }
          if (received.length < 5) return;
          const recordLength = 5 + ((received[3] << 8) | received[4]);
          if (received.length < recordLength) return;
          resolve(received.subarray(0, recordLength));
          socket.end();
        },
        error(_socket, error) {
          reject(error);
        },
      },
    });
    const request = fetch("https://example.invalid/", {
      proxy: `http://127.0.0.1:${proxy.port}`,
      tls: { rejectUnauthorized: false, ja3: CHROME_JA3, grease: true },
    }).catch(reject);
    const hello = parseClientHello(await promise);
    await request;

    expect(connectRequest).toStartWith("CONNECT example.invalid:443 ");
    expect(hello.ciphers.filter(c => !isGrease(c)).join("-")).toBe(CHROME_JA3.split(",")[1]);
    expect(hello.ciphers.filter(isGrease)).toHaveLength(1);
    expect(hello.groups.filter(g => !isGrease(g))).toEqual([4588, 29, 23, 24]);
    expect(hello.certCompression).toEqual([2]);
    expect(hello.alps?.protocols).toEqual(["h2"]);
    expect(hello.extensionTypes).toContain(EXT.ech);
  });

  it("the fingerprinted ClientHello completes a handshake with Bun.serve", async () => {
    using server = Bun.serve({
      port: 0,
      tls: validTls,
      fetch: () => new Response("hello"),
    });
    const response = await fetch(`https://localhost:${server.port}/`, {
      tls: {
        ca: validTls.cert,
        ja3: CHROME_JA3,
        grease: true,
        permuteExtensions: true,
      },
    });
    expect(await response.text()).toBe("hello");
    expect(response.status).toBe(200);
  });

  describe("invalid options throw", () => {
    const attempt = async (tls: Record<string, unknown>) => fetch("https://127.0.0.1:1/", { tls });

    it.each([
      ["771,4865", "expected 5 comma-separated fields"],
      ["771,4865-4866-4867,0,29", "expected 5 comma-separated fields"],
      ["771,4865-x,0,29,0", "ciphers must be dash-separated decimal numbers"],
      ["771,4865-4866-4867,0-10-13-16-43-45-51,70000,", "groups must be dash-separated decimal numbers"],
      ["768,4865-4866-4867,0,29,0", "unsupported TLS version 768"],
      ["772,4865-4866-4867,0,29,0", "unsupported TLS version 772"],
      ["771,,0-10,29,0", "the cipher list is empty"],
      ["771,255-4865-4866-4867,0,29,0", "cipher suite 255 is not supported"],
      ["771,4865-4866-4867-52396,0,29,0", "cipher suite 52396 is not supported"],
      ["771,4865-4866,0,29,0", "TLS 1.3 cipher suites must lead the list as"],
      ["771,4865-4867-4866,0,29,0", "TLS 1.3 cipher suites must lead the list as"],
      ["771,49195-4865-4866-4867,0,29,0", "TLS 1.3 cipher suites must lead the list as"],
      ["771,4865-49195-4866-4867,0,29,0", "TLS 1.3 cipher suites must lead the list as"],
      ["771,4865-4866-4867,0-34,29,0", "extension 34 cannot be sent"],
      ["771,4865-4866-4867,0-28,29,0", "extension 28 cannot be sent"],
      ["771,4865-4866-4867-49195,0-5-10-11-13-18-35-43-45-51-65281,29,0", "extension 16 is always sent"],
      ["771,4865-4866-4867-49195,0-10-11-13-16-43-45-51-65281,29,0", "extension 23 is always sent"],
      ["771,4865-4866-4867,0-10-13-16,29,0", "extension 43 is always sent"],
      ["771,49195-49199,0-5-10-11-13-16-18-23-35-43-45-51-65281,29,0", "extension 43 is not sent"],
      ["771,49195,0-10-11-13-16-23-65281-65037,29,0", "extension 65037 is not sent"],
      ["771,49195,0-10-11-13-16-23-41-65281,29,0", "extension 41 is not sent"],
      ["771,4865-4866-4867,0-10-11-13-16-23-43-45-51-65281,29,0", "extension 11 is not sent"],
      ["771,4865-4866-4867,0-10-13-16-35-43-45-51,29,0", "extension 35 is not sent"],
      ["771,4865-4866-4867,0-10-13-16-43-45-51,,", "the supported groups list is empty"],
      ["771,4865-4866-4867,0-10-13-16-43-45-51,2570,", "the supported groups list is empty"],
      ["771,4865-4866-4867,0-10-13-16-43-45-51,256-29,", "supported group 256 is not supported"],
      ["771,4865-4866-4867-49195-49195,0-10-11-13-16-23-43-45-51-65281,29,0", "ciphers lists 49195 more than once"],
      ["771,4865-4866-4867-49195,0-5-5-10-11-13-16-23-43-45-51-65281,29,0", "extensions lists 5 more than once"],
      ["771,4865-4866-4867,0-10-13-16-43-45-51,29-29-23,", "groups lists 29 more than once"],
      ["771,4865-4866-4867-49195,0-10-11-13-16-23-43-45-51-65281,29,1", "the point formats field must be"],
      ["771,4865-4866-4867-49195,0-10-11-13-16-23-43-45-51-65281,29,", "the point formats field must be"],
      ["771,4865-4866-4867,0-10-13-16-43-45-51,29,0", "the point formats field must be"],
    ])("ja3 %s", async (ja3, message) => {
      await expect(attempt({ ja3 })).rejects.toThrow(message);
    });

    it("applicationSettings must be a boolean or a known codepoint", async () => {
      await expect(attempt({ applicationSettings: 1234 })).rejects.toThrow(
        "applicationSettings must be a boolean, 17513 or 17613",
      );
    });

    it("certificateCompression entries must be known algorithms", async () => {
      await expect(attempt({ certificateCompression: ["gzip"] })).rejects.toThrow(
        'certificateCompression entries must be "zlib", "brotli" or "zstd"',
      );
    });
  });
});
