import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isASAN, tmpdirSync } from "harness";
import net from "node:net";
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
      hostname: "localhost",
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

  // Parses the TLS ClientHello out of a raw TCP byte stream and returns the
  // set of extension type IDs it advertises. Returns null if no ClientHello
  // was received. See RFC 8446 §4.1.2 for the message format.
  function parseClientHelloExtensions(bytes: Buffer): number[] | null {
    // TLSPlaintext: type(1) legacy_version(2) length(2) = 5 bytes
    if (bytes.length < 5 || bytes[0] !== 0x16) return null; // 0x16 = handshake
    const recordLen = bytes.readUInt16BE(3);
    if (bytes.length < 5 + recordLen) return null;
    // Handshake: msg_type(1) length(3) = 4 bytes, then ClientHello
    let p = 5;
    if (bytes[p] !== 0x01) return null; // 0x01 = client_hello
    p += 4;
    p += 2; // legacy_version
    p += 32; // random
    const sessionIdLen = bytes[p];
    p += 1 + sessionIdLen;
    const cipherSuitesLen = bytes.readUInt16BE(p);
    p += 2 + cipherSuitesLen;
    const compressionLen = bytes[p];
    p += 1 + compressionLen;
    if (p + 2 > bytes.length) return [];
    const extensionsLen = bytes.readUInt16BE(p);
    p += 2;
    const extensionsEnd = p + extensionsLen;
    const types: number[] = [];
    while (p + 4 <= extensionsEnd) {
      const extType = bytes.readUInt16BE(p);
      const extLen = bytes.readUInt16BE(p + 2);
      types.push(extType);
      p += 4 + extLen;
    }
    return types;
  }

  // Regression test for https://github.com/oven-sh/bun/issues/29780
  //
  // Bun's fetch HTTP client used to enable ECH GREASE (extension type 0xfe0d,
  // RFC 9460/9180 draft) on every TLS ClientHello. That extension carries
  // 200-300 bytes of random payload that some servers/middleboxes treat as
  // hostile: they complete the TCP + TLS handshake and then silently hold
  // the connection open without responding to the HTTP request. curl, Node's
  // undici, and Bun's own node:tls all omit ECH GREASE, so our fetch was the
  // odd one out.
  //
  // This verifies the ClientHello no longer advertises 0xfe0d.
  it("fetch TLS ClientHello does not include ECH GREASE extension (#29780)", async () => {
    const { promise: helloPromise, resolve: resolveHello } =
      Promise.withResolvers<Buffer>();

    await using server = net.createServer(socket => {
      const chunks: Buffer[] = [];
      socket.on("data", chunk => {
        chunks.push(chunk);
        // The ClientHello arrives in the first record; capture it and close
        // so fetch rejects quickly instead of hanging on TLS.
        resolveHello(Buffer.concat(chunks));
        socket.destroy();
      });
      socket.on("error", () => {});
    });

    const { promise: listening, resolve: onListen } =
      Promise.withResolvers<void>();
    server.listen(0, "127.0.0.1", () => onListen());
    await listening;
    const port = (server.address() as net.AddressInfo).port;

    // fetch will fail (the server just drops the connection) — we only care
    // about the ClientHello bytes it sent.
    await fetch(`https://127.0.0.1:${port}/`, {
      tls: { rejectUnauthorized: false },
    }).catch(() => {});

    const hello = await helloPromise;
    const extensions = parseClientHelloExtensions(hello);
    expect(extensions).not.toBeNull();
    // 0xfe0d = encrypted_client_hello (ECH). Must be absent.
    expect(extensions).not.toContain(0xfe0d);
    // Sanity: the ClientHello is well-formed (ALPN = 16, SNI = 0 should be
    // present) so we know the parser actually walked the extensions list.
    expect(extensions).toContain(16); // application_layer_protocol_negotiation
  });
});
