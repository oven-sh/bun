import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isASAN, tmpdirSync } from "harness";
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
  it("re-derives the Host header and TLS verification hostname from the redirect target on a cross-origin redirect", async () => {
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

    // An explicit Host header overrides both the wire Host header and the
    // hostname used for TLS SNI / certificate verification. checkServerIdentity
    // receives the verification hostname as its first argument.
    //
    // fetch() invokes the JS checkServerIdentity callback once per connection
    // in the redirect chain, before that connection's request is written: the
    // request (and any cookies/credentials it carries) must not reach a hop
    // whose certificate the callback has not approved. So a redirect chain
    // yields one observation per hop, in order.
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

    // The first hop is verified against the explicit Host override
    // ("localhost"). The Host override names the previous origin, so on a
    // cross-origin redirect it must be dropped and the verification hostname
    // re-derived from the redirect target's URL ("127.0.0.1"). The vulnerable
    // behavior carries the stale override and verifies the second connection
    // against "localhost" instead.
    expect(verifiedHostnames).toEqual(["localhost", "127.0.0.1"]);
    // The redirect target must see a Host header derived from its own URL,
    // not the override that was supplied for the previous origin.
    expect(receivedHostHeaders).toEqual([`127.0.0.1:${target.port}`]);
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
  });

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

  it("runs checkServerIdentity on its own connection for each request that supplies it", async () => {
    let connections = 0;
    const server = tls.createServer({ key: validTls.key, cert: validTls.cert }, socket => {
      connections++;
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
    try {
      const { promise: listening, resolve: onListening } = Promise.withResolvers<void>();
      server.listen(0, onListening);
      await listening;
      const port = (server.address() as import("node:net").AddressInfo).port;
      const url = `https://127.0.0.1:${port}/`;

      const verified: string[] = [];
      const tlsWithCallback = {
        ca: validTls.cert,
        checkServerIdentity(hostname: string) {
          verified.push(hostname);
          return undefined;
        },
      };

      expect(await fetch(url, { tls: tlsWithCallback }).then(res => res.text())).toBe("ok");
      expect(await fetch(url, { tls: { ca: validTls.cert } }).then(res => res.text())).toBe("ok");
      expect(await fetch(url, { tls: tlsWithCallback }).then(res => res.text())).toBe("ok");

      expect(verified).toEqual(["127.0.0.1", "127.0.0.1"]);
      expect(connections).toBe(3);
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
