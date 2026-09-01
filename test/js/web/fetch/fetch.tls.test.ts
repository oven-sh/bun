import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows, tmpdirSync } from "harness";
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
        unix?: boolean[];
        unixPathIsolation?: { b: boolean[]; c: boolean[] };
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
          if (!isWindows) {
            expect({ unix: r.unix, unixPathIsolation: r.unixPathIsolation }).toEqual({
              // Second fresh connect over the same socket path resumes.
              unix: [false, true],
              // Same URL + SSLConfig, different socket path: no resumption.
              unixPathIsolation: { b: [false], c: [false] },
            });
          }
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
