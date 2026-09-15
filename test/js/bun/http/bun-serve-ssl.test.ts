import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { once } from "node:events";
import net from "node:net";
import tls from "node:tls";
import { join } from "path";
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

describe("Bun.serve per-serverName client certificate policy", () => {
  const tlsFixtures = join(import.meta.dir, "..", "..", "node", "tls", "fixtures");
  const serverKey = readFileSync(join(tlsFixtures, "agent10-key.pem"), "utf8");
  const serverCert = readFileSync(join(tlsFixtures, "agent10-cert.pem"), "utf8");
  // ec10 chains to ca5; agent1 chains to ca1 and is not trusted by ca5.
  const clientCa = readFileSync(join(tlsFixtures, "ca5-cert.pem"), "utf8");
  const trustedClient = {
    key: readFileSync(join(tlsFixtures, "ec10-key.pem"), "utf8"),
    cert: readFileSync(join(tlsFixtures, "ec10-cert.pem"), "utf8"),
  };
  const untrustedClient = {
    key: readFileSync(join(tlsFixtures, "agent1-key.pem"), "utf8"),
    cert: readFileSync(join(tlsFixtures, "agent1-cert.pem"), "utf8"),
  };

  type ClientOptions = { key?: string; cert?: string; session?: Buffer };
  function request(port: number, servername: string, clientTls: ClientOptions = {}) {
    const { promise, resolve } = Promise.withResolvers<{ status: string; session: Buffer | undefined }>();
    const socket = tls.connect({ host: "127.0.0.1", port, servername, rejectUnauthorized: false, ...clientTls });
    let received = "";
    let session: Buffer | undefined;
    socket.on("secureConnect", () => {
      socket.write(`GET / HTTP/1.1\r\nHost: ${servername}\r\nConnection: close\r\n\r\n`);
    });
    socket.on("session", buf => (session ??= buf));
    socket.on("data", chunk => (received += chunk.toString()));
    // A rejected client sees either a clean close or a reset; both mean no response.
    socket.on("error", () => {});
    socket.on("close", () =>
      resolve({ status: received.split("\r\n")[0] || "connection closed without a response", session }),
    );
    return promise;
  }

  test("requestCert/rejectUnauthorized on a non-default serverName entry are enforced for that name only", async () => {
    using server = Bun.serve({
      port: 0,
      tls: [
        { key: serverKey, cert: serverCert },
        {
          serverName: "admin.example.com",
          key: serverKey,
          cert: serverCert,
          ca: clientCa,
          requestCert: true,
          rejectUnauthorized: true,
        },
        {
          serverName: "lenient.example.com",
          key: serverKey,
          cert: serverCert,
          ca: clientCa,
          requestCert: true,
          rejectUnauthorized: false,
        },
      ],
      fetch: req => new Response(`served ${req.headers.get("host")}`),
    });
    const { status: gatedNoCert } = await request(server.port, "admin.example.com");
    const { status: gatedTrustedCert } = await request(server.port, "admin.example.com", trustedClient);
    const { status: gatedUntrustedCert } = await request(server.port, "admin.example.com", untrustedClient);
    const { status: lenientNoCert } = await request(server.port, "lenient.example.com");
    const { status: defaultNoCert } = await request(server.port, "localhost");
    expect({ gatedNoCert, gatedTrustedCert, gatedUntrustedCert, lenientNoCert, defaultNoCert }).toEqual({
      gatedNoCert: "connection closed without a response",
      gatedTrustedCert: "HTTP/1.1 200 OK",
      gatedUntrustedCert: "connection closed without a response",
      lenientNoCert: "HTTP/1.1 200 OK",
      defaultNoCert: "HTTP/1.1 200 OK",
    });
  });

  test("a session established on the open default name cannot be resumed to bypass a gated name", async () => {
    using server = Bun.serve({
      port: 0,
      tls: [
        { key: serverKey, cert: serverCert },
        {
          serverName: "admin.example.com",
          key: serverKey,
          cert: serverCert,
          ca: clientCa,
          requestCert: true,
          rejectUnauthorized: true,
        },
      ],
      fetch: req => new Response(`served ${req.headers.get("host")}`),
    });
    // Establish a resumable session on the open default name, then offer it on
    // the gated name without presenting a client certificate.
    const { status: defaultFresh, session } = await request(server.port, "localhost");
    expect(session).toBeInstanceOf(Buffer);
    const { status: defaultResumed } = await request(server.port, "localhost", { session });
    const { status: gatedResumed } = await request(server.port, "admin.example.com", { session });
    expect({ defaultFresh, defaultResumed, gatedResumed }).toEqual({
      defaultFresh: "HTTP/1.1 200 OK",
      defaultResumed: "HTTP/1.1 200 OK",
      gatedResumed: "connection closed without a response",
    });
  });

  test("a handshake still queued at a graceful stop() is served under its serverName entry", async () => {
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls: [
        { key: serverKey, cert: serverCert },
        {
          serverName: "admin.example.com",
          // A certificate of its own (CN=agent1), so the client can tell which entry answered.
          ...untrustedClient,
          ca: clientCa,
          requestCert: true,
          rejectUnauthorized: true,
        },
      ],
      fetch: () => new Response("members only"),
    });
    const raws: net.Socket[] = [];
    try {
      // The loop runs a few handshakes per iteration and queues the rest, so
      // ClientHellos sent in one go are not all processed when the first
      // handshake completes.
      for (let i = 0; i < 32; i++) raws.push(net.connect({ host: "127.0.0.1", port: server.port }));
      for (const raw of raws) raw.on("error", () => {});
      await Promise.all(raws.map(raw => once(raw, "connect")));

      const firstHandshake = Promise.withResolvers<void>();
      // No client presents a certificate.
      const outcomes = raws.map(raw => {
        const { promise, resolve } = Promise.withResolvers<{ certificate: string; status: string }>();
        let certificate = "no handshake";
        let received = "";
        const socket = tls.connect({ socket: raw, servername: "admin.example.com", rejectUnauthorized: false }, () => {
          certificate = socket.getPeerCertificate().subject.CN;
          firstHandshake.resolve();
          socket.write("GET / HTTP/1.1\r\nHost: admin.example.com\r\nConnection: close\r\n\r\n");
        });
        socket.on("data", chunk => (received += chunk));
        socket.on("error", () => {});
        socket.on("close", () => resolve({ certificate, status: received.split("\r\n")[0] || "no response" }));
        return promise;
      });
      // If no handshake completes, every outcome settles and the assertions report them.
      await Promise.race([firstHandshake.promise, Promise.all(outcomes)]);
      server.stop();

      const settled = await Promise.all(outcomes);
      // Graceful stop may close a connection that has not started its
      // handshake ("no handshake"). It must not answer one under another entry.
      expect(
        settled.filter(o => o.status !== "no response" || !["agent1", "no handshake"].includes(o.certificate)),
      ).toEqual([]);
      expect(settled.filter(o => o.certificate === "agent1").length).toBeGreaterThan(0);
    } finally {
      server.stop(true);
      for (const raw of raws) raw.destroy();
    }
  });
});
