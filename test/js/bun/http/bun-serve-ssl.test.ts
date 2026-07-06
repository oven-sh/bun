import { describe, expect, test } from "bun:test";
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

describe.concurrent("Bun.serve TLS client certificates", () => {
  const keys = join(import.meta.dir, "../../node/test/fixtures/keys");
  const serverCert = readFileSync(join(keys, "agent1-cert.pem"), "utf8");
  const serverKey = readFileSync(join(keys, "agent1-key.pem"), "utf8");
  // agent1 is issued by ca1; agent2 is self-signed, so from ca1's point of
  // view it is a certificate from a completely unrelated issuer.
  const ca1 = readFileSync(join(keys, "ca1-cert.pem"), "utf8");
  const trustedClient = { cert: serverCert, key: serverKey };
  const untrustedClient = {
    cert: readFileSync(join(keys, "agent2-cert.pem"), "utf8"),
    key: readFileSync(join(keys, "agent2-key.pem"), "utf8"),
  };

  /** Resolves to the response status line, or `rejected: <why>` when the server refused us. */
  async function request(port: number, clientTls: object = {}): Promise<string> {
    const { promise, resolve } = Promise.withResolvers<string>();
    const socket = connect({ port, host: "127.0.0.1", rejectUnauthorized: false, ...clientTls }, () => {
      socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    });
    let buffer = "";
    socket.on("data", chunk => (buffer += chunk));
    socket.on("error", err => resolve(`rejected: ${(err as NodeJS.ErrnoException).code ?? err.message}`));
    socket.on("close", () => resolve(buffer.split("\r\n")[0] || "rejected: closed without a response"));
    try {
      return await promise;
    } finally {
      socket.destroy();
    }
  }

  test("a `ca` on its own does not make the server demand a client certificate", async () => {
    using server = Bun.serve({
      port: 0,
      tls: { cert: serverCert, key: serverKey, ca: ca1 },
      fetch: () => new Response("ok"),
    });
    expect(await request(server.port)).toBe("HTTP/1.1 200 OK");
  });

  test("a `ca` on its own does not reject a client certificate from another CA", async () => {
    using server = Bun.serve({
      port: 0,
      tls: { cert: serverCert, key: serverKey, ca: ca1 },
      fetch: () => new Response("ok"),
    });
    expect(await request(server.port, untrustedClient)).toBe("HTTP/1.1 200 OK");
  });

  test("requestCert accepts a client certificate that chains to `ca`", async () => {
    using server = Bun.serve({
      port: 0,
      tls: { cert: serverCert, key: serverKey, ca: ca1, requestCert: true },
      fetch: () => new Response("ok"),
    });
    expect(await request(server.port, trustedClient)).toBe("HTTP/1.1 200 OK");
  });

  test("requestCert rejects a client certificate from another CA", async () => {
    using server = Bun.serve({
      port: 0,
      tls: { cert: serverCert, key: serverKey, ca: ca1, requestCert: true },
      fetch: () => new Response("ok"),
    });
    expect(await request(server.port, untrustedClient)).toStartWith("rejected:");
  });

  test("requestCert rejects a client that presents no certificate", async () => {
    using server = Bun.serve({
      port: 0,
      tls: { cert: serverCert, key: serverKey, ca: ca1, requestCert: true },
      fetch: () => new Response("ok"),
    });
    expect(await request(server.port)).toStartWith("rejected:");
  });

  test("requestCert with rejectUnauthorized:false accepts an unverifiable client certificate", async () => {
    using server = Bun.serve({
      port: 0,
      tls: { cert: serverCert, key: serverKey, ca: ca1, requestCert: true, rejectUnauthorized: false },
      fetch: () => new Response("ok"),
    });
    expect(await request(server.port, untrustedClient)).toBe("HTTP/1.1 200 OK");
  });
});
