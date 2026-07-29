import { describe, expect, test } from "bun:test";
import { tls as harnessTls } from "harness";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect } from "node:tls";
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

describe("Bun.serve reload({tls})", () => {
  // Two distinct self-signed identities so the test can observe the swap.
  const certA = { ...harnessTls }; // CN=server-bun
  const certB = {
    key: readFileSync(join(import.meta.dir, "../../node/tls/fixtures/rsa_private.pem"), "utf8"),
    cert: readFileSync(join(import.meta.dir, "../../node/tls/fixtures/rsa_cert.crt"), "utf8"),
  }; // CN=localhost

  async function servedCN(port: number, servername?: string) {
    const client = connect({ port, host: "127.0.0.1", rejectUnauthorized: false, servername });
    try {
      await once(client, "secureConnect");
      return client.getPeerCertificate().subject.CN;
    } finally {
      client.destroy();
      await once(client, "close");
    }
  }

  const fetchHandler = () => new Response("ok");

  test("serves the replacement certificate on subsequent handshakes", async () => {
    await using server = Bun.serve({ port: 0, tls: certA, fetch: fetchHandler });
    const port = server.port;
    expect(await servedCN(port)).toBe("server-bun");

    server.reload({ tls: certB, fetch: fetchHandler });
    expect(await servedCN(port)).toBe("localhost");

    // A reload without tls leaves the certificate alone.
    server.reload({ fetch: fetchHandler });
    expect(await servedCN(port)).toBe("localhost");

    server.reload({ tls: certA, fetch: fetchHandler });
    expect(await servedCN(port)).toBe("server-bun");
  });

  test("serves the replacement certificate for clients that send the configured serverName as SNI", async () => {
    // uWS's addServerName registers a separate per-domain context in the SNI
    // tree (not the app's default ssl_ctx), so the entry has to be moved
    // unconditionally - browsers and fetch() always send SNI.
    await using server = Bun.serve({
      port: 0,
      tls: { ...certA, serverName: "example.test" },
      fetch: fetchHandler,
    });
    const port = server.port;
    expect(await servedCN(port, "example.test")).toBe("server-bun");

    server.reload({ tls: { ...certB, serverName: "example.test" }, fetch: fetchHandler });
    expect(await servedCN(port)).toBe("localhost");
    expect(await servedCN(port, "example.test")).toBe("localhost");
  });

  test("rejects an unusable certificate and keeps serving the previous one", async () => {
    await using server = Bun.serve({ port: 0, tls: certA, fetch: fetchHandler });
    const port = server.port;
    expect(await servedCN(port)).toBe("server-bun");

    // Mismatched key/cert pair: the private key does not match the certificate's
    // public key, which Bun.serve()'s startup path rejects with KEY_VALUES_MISMATCH.
    let error: any;
    try {
      server.reload({ tls: { key: certB.key, cert: certA.cert }, fetch: fetchHandler });
    } catch (e) {
      error = e;
    }
    expect(error?.code).toBe("ERR_OSSL_X509_KEY_VALUES_MISMATCH");
    expect(await servedCN(port)).toBe("server-bun");

    // Garbage that is not PEM at all.
    error = undefined;
    try {
      server.reload({ tls: { key: "xxx", cert: "yyy" }, fetch: fetchHandler });
    } catch (e) {
      error = e;
    }
    expect(error?.code).toBe("ERR_OSSL_PEM_NO_START_LINE");
    expect(await servedCN(port)).toBe("server-bun");

    // A valid rotation after the rejected ones still works.
    server.reload({ tls: certB, fetch: fetchHandler });
    expect(await servedCN(port)).toBe("localhost");
  });
});
