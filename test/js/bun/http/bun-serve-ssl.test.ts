import { describe, expect, test } from "bun:test";
import { tls as tlsCert } from "harness";
import { once } from "node:events";
import { Server as HttpServer } from "node:http";
import { createServer as createHttpsServer, Server as HttpsServer } from "node:https";
import { connect as tlsConnect } from "node:tls";
import privateKey from "../../third_party/jsonwebtoken/priv.pem" with { type: "text" };
import publicKey from "../../third_party/jsonwebtoken/pub.pem" with { type: "text" };

describe("Bun.serve SSL validations", () => {
  const fixtures = [
    {
      label: "invalid key",
      tls: {
        key: privateKey.slice(100),
        cert: publicKey,
      },
    },
    {
      label: "invalid key #2",
      tls: {
        key: privateKey.slice(0, -20),
        cert: publicKey,
      },
    },
    {
      label: "invalid cert",
      tls: {
        key: privateKey,
        cert: publicKey.slice(0, -40),
      },
    },
    {
      label: "invalid cert #2",
      tls: [
        {
          key: privateKey,
          cert: publicKey,
          serverName: "error-mc-erroryface.com",
        },
        {
          key: privateKey,
          cert: publicKey.slice(0, -40),
          serverName: "error-mc-erroryface.co.uk",
        },
      ],
    },
    {
      label: "invalid serverName: missing serverName",
      tls: [
        {
          key: privateKey,
          cert: publicKey,
          serverName: "hello.com",
        },
        {
          key: privateKey,
          cert: publicKey,
        },
      ],
    },
    {
      label: "invalid serverName: empty serverName",
      tls: [
        {
          key: privateKey,
          cert: publicKey,
          serverName: "hello.com",
        },
        {
          key: privateKey,
          cert: publicKey,
          serverName: "",
        },
      ],
    },
  ];
  for (const development of [true, false]) {
    for (const fixture of fixtures) {
      test(`${fixture.label} ${development ? "development" : "production"}`, () => {
        expect(() => {
          Bun.serve({
            port: 0,
            tls: fixture.tls,
            fetch: () => new Response("Hello, world!"),
            development,
          });
        }).toThrow();
      });
    }
  }

  const validFixtures = [
    {
      label: "valid",
      tls: {
        key: privateKey,
        cert: publicKey,
      },
    },
    {
      label: "valid 2",
      tls: [
        {
          key: privateKey,
          cert: publicKey,
          serverName: "localhost",
        },
        {
          key: privateKey,
          cert: publicKey,
          serverName: "localhost2.com",
        },
      ],
    },
  ];
  for (const development of [true, false]) {
    for (const fixture of validFixtures) {
      test(`${fixture.label} ${development ? "development" : "production"}`, async () => {
        using server = Bun.serve({
          port: 0,
          tls: fixture.tls,
          fetch: () => new Response("Hello, world!"),
          development,
        });
        expect(server.url).toBeDefined();
        expect().pass();
        let serverNames = Array.isArray(fixture.tls) ? fixture.tls.map(({ serverName }) => serverName) : ["localhost"];

        for (const serverName of serverNames) {
          const res = await fetch(server.url, {
            headers: {
              Host: serverName,
            },
            tls: {
              rejectUnauthorized: false,
            },
            keepAlive: false,
          });
          expect(res.status).toBe(200);
          expect(await res.text()).toBe("Hello, world!");
        }

        const res = await fetch(server.url, {
          headers: {
            Host: "badhost.com",
          },
          tls: {
            rejectUnauthorized: false,
          },
          keepAlive: false,
        });
      });
    }
  }
});

// `tls: {}` used to fall back to plaintext and tuning-only `tls` stood up a
// cert-less https:// listener; both must now throw synchronously.
describe("Bun.serve tls must carry key+cert", () => {
  const withoutIdentity = [
    ["empty object", {}],
    ["rejectUnauthorized only", { rejectUnauthorized: false }],
    ["requestCert only", { requestCert: true }],
    ["lowMemoryMode only", { lowMemoryMode: true }],
    ["ciphers only", { ciphers: "DEFAULT" }],
    ["key without cert", { key: tlsCert.key }],
    ["cert without key", { cert: tlsCert.cert }],
    ["array entry without cert", [{ key: tlsCert.key, rejectUnauthorized: false }]],
    ["array with only an empty entry", [{}]],
    ["array with only empty entries", [{}, {}]],
  ] as const;
  for (const [label, tls] of withoutIdentity) {
    test(label, () => {
      expect(() =>
        Bun.serve({
          port: 0,
          tls: tls as Bun.TLSOptions,
          fetch: () => new Response("ok"),
        }),
      ).toThrow('tls option requires both "key" and "cert"');
    });
  }

  test("key+cert is accepted and serves over TLS", async () => {
    await using server = Bun.serve({
      port: 0,
      tls: { key: tlsCert.key, cert: tlsCert.cert },
      fetch: () => new Response("ok"),
    });
    expect(server.url.protocol).toBe("https:");
    const res = await fetch(server.url, { tls: { rejectUnauthorized: false } });
    expect(await res.text()).toBe("ok");
  });

  test("top-level tuning field does not arm TLS", async () => {
    await using server = Bun.serve({
      port: 0,
      lowMemoryMode: true,
      requestCert: true,
      fetch: () => new Response("ok"),
    } as any);
    expect(server.url.protocol).toBe("http:");
    const res = await fetch(server.url);
    expect(await res.text()).toBe("ok");
  });

  for (const [label, opts] of [
    ["key without cert", { key: tlsCert.key }],
    ["cert without key", { cert: tlsCert.cert }],
  ] as const) {
    test(`top-level ${label} throws (legacy path)`, () => {
      expect(() => Bun.serve({ port: 0, ...opts, fetch: () => new Response("ok") } as any)).toThrow(
        'tls option requires both "key" and "cert"',
      );
    });
  }

  test("top-level key+cert still arms TLS (legacy path)", async () => {
    await using server = Bun.serve({
      port: 0,
      key: tlsCert.key,
      cert: tlsCert.cert,
      fetch: () => new Response("ok"),
    } as any);
    expect(server.url.protocol).toBe("https:");
  });
});

describe("node:https without key/cert is TLS fail-closed", () => {
  const matrix = [
    ["no options", undefined],
    ["empty options", {}],
    ["requestCert only", { requestCert: true }],
    ["rejectUnauthorized only", { rejectUnauthorized: false }],
  ] as const;
  const makers = [
    ["createServer", (o: any, h: any) => createHttpsServer(o, h)],
    ["new Server", (o: any, h: any) => new HttpsServer(o, h)],
  ] as const;
  for (const [makeLabel, make] of makers) {
    for (const [label, options] of matrix) {
      test(`${makeLabel}: ${label}`, async () => {
        const server = make(options, (_req, res) => res.end("plaintext"));
        await once(server.listen(0), "listening");
        const { port } = server.address() as import("node:net").AddressInfo;
        try {
          // A plaintext HTTP client must not get a response body.
          await expect(
            fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) }).then(r => r.text()),
          ).rejects.toThrow();

          // A TLS client must see the handshake fail (not succeed).
          const handshake = new Promise<void>((resolve, reject) => {
            const sock = tlsConnect({ port, host: "127.0.0.1", rejectUnauthorized: false });
            sock.once("secureConnect", () => {
              sock.destroy();
              reject(new Error("handshake unexpectedly succeeded"));
            });
            sock.once("error", () => {
              sock.destroy();
              resolve();
            });
          });
          await expect(handshake).resolves.toBeUndefined();
        } finally {
          await new Promise<void>(r => server.close(() => r()));
        }
      });
    }
  }

  test("https.Server instanceof http.Server", () => {
    const server = new HttpsServer({});
    expect(server instanceof HttpsServer).toBe(true);
    expect(server instanceof HttpServer).toBe(true);
  });

  test("with key+cert serves over TLS", async () => {
    const server = createHttpsServer({ key: tlsCert.key, cert: tlsCert.cert }, (_req, res) => res.end("ok"));
    await once(server.listen(0), "listening");
    const { port } = server.address() as import("node:net").AddressInfo;
    try {
      const res = await fetch(`https://127.0.0.1:${port}/`, { tls: { rejectUnauthorized: false } });
      expect(await res.text()).toBe("ok");
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });
});
