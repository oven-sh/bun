import { describe, expect, test } from "bun:test";
import privateKey from "../../third_party/jsonwebtoken/priv.pem" with { type: "text" };
import publicKey from "../../third_party/jsonwebtoken/pub.pem" with { type: "text" };

describe("Bun.serve SSL validations", () => {
  describe("tls option without a server identity", () => {
    const noIdentity: Record<string, Bun.TLSOptions> = {
      "lowMemoryMode": { lowMemoryMode: true },
      "requestCert": { requestCert: true },
      "rejectUnauthorized": { rejectUnauthorized: false },
      "secureOptions": { secureOptions: 1 },
      "passphrase": { passphrase: "x" },
      "serverName": { serverName: "example.com" },
      "ca": { ca: publicKey },
      "cert only": { cert: publicKey },
      "key only": { key: privateKey },
    };

    // An explicit `tls: { ... }` that has no complete cert+key pair must throw
    // rather than start an HTTPS listener that can never complete a handshake.
    for (const [label, tls] of Object.entries(noIdentity)) {
      test(`tls: { ${label} } throws`, () => {
        expect(() => {
          using _ = Bun.serve({ port: 0, tls, fetch: () => new Response("ok") });
        }).toThrow('tls object must specify both "cert" and "key"');
      });
      test(`tls: [{ ${label} }] throws`, () => {
        expect(() => {
          using _ = Bun.serve({ port: 0, tls: [tls], fetch: () => new Response("ok") });
        }).toThrow('tls object must specify both "cert" and "key"');
      });
    }

    // The same keys at the top level (the legacy v0.2 flattened shape) must
    // NOT flip the server into TLS mode. They are silently ignored and the
    // server stays plain HTTP.
    for (const [label, opts] of Object.entries(noIdentity)) {
      test(`top-level { ${label} } stays HTTP`, async () => {
        using server = Bun.serve({
          port: 0,
          ...(opts as object),
          fetch: () => new Response("ok"),
        });
        expect(server.url.protocol).toBe("http:");
        const res = await fetch(server.url);
        expect(await res.text()).toBe("ok");
        expect(res.status).toBe(200);
      });
    }

    // Back-compat: cert/key at the top level (no `tls:` wrapper) still works.
    test("top-level { cert, key } still enables TLS", async () => {
      using server = Bun.serve({
        port: 0,
        // @ts-expect-error legacy flattened shape
        cert: publicKey,
        key: privateKey,
        fetch: () => new Response("ok"),
      });
      expect(server.url.protocol).toBe("https:");
      const res = await fetch(server.url, { tls: { rejectUnauthorized: false } });
      expect(await res.text()).toBe("ok");
      expect(res.status).toBe(200);
    });

    // tls: {} with nothing in it was already treated as "no TLS"; keep that.
    test("tls: {} stays HTTP", async () => {
      using server = Bun.serve({ port: 0, tls: {}, fetch: () => new Response("ok") });
      expect(server.url.protocol).toBe("http:");
      const res = await fetch(server.url);
      expect(res.status).toBe(200);
    });
  });

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
