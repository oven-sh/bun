import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
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

  type ClientOptions = { key?: string; cert?: string; session?: Buffer; hostHeader?: string };
  // servername === undefined connects without SNI (the host is an IP literal,
  // so node sends no server_name extension). hostHeader lets the HTTP Host
  // disagree with the negotiated SNI.
  function request(port: number, servername: string | undefined, clientTls: ClientOptions = {}) {
    const { hostHeader, ...tlsOptions } = clientTls;
    const { promise, resolve } = Promise.withResolvers<{ status: string; session: Buffer | undefined }>();
    const socket = tls.connect({ host: "127.0.0.1", port, servername, rejectUnauthorized: false, ...tlsOptions });
    let received = "";
    let session: Buffer | undefined;
    socket.on("secureConnect", () => {
      socket.write(`GET / HTTP/1.1\r\nHost: ${hostHeader ?? servername}\r\nConnection: close\r\n\r\n`);
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

  // A request whose Host names a gated serverName must not be served over a
  // connection whose handshake never applied that name's client-certificate
  // policy (no SNI, or an SNI that selected another entry). nginx answers 421
  // Misdirected Request here; so do we.
  test("a Host naming a gated serverName gets 421 on a connection that bypassed its policy", async () => {
    // A maximal 253-char DNS name: the Host-normalization buffer must still
    // accept it with a trailing root dot appended.
    const label = Buffer.alloc(63, "a").toString();
    const maxLengthName = `${label}.${label}.${label}.${Buffer.alloc(61, "a").toString()}`;
    expect(maxLengthName.length).toBe(253);
    const routedHosts: string[] = [];
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
        {
          serverName: maxLengthName,
          key: serverKey,
          cert: serverCert,
          ca: clientCa,
          requestCert: true,
          rejectUnauthorized: true,
        },
      ],
      fetch: req => {
        routedHosts.push(req.headers.get("host")!);
        return new Response(`served ${req.headers.get("host")}`);
      },
    });
    const MISDIRECTED = "HTTP/1.1 421 Misdirected Request";
    const { status: noSni } = await request(server.port, undefined, { hostHeader: "admin.example.com" });
    const { status: unknownSni } = await request(server.port, "localhost", { hostHeader: "admin.example.com" });
    const { status: otherNamedSni } = await request(server.port, "lenient.example.com", {
      hostHeader: "admin.example.com",
    });
    const { status: withPort } = await request(server.port, undefined, { hostHeader: "admin.example.com:8443" });
    const { status: upperCase } = await request(server.port, undefined, { hostHeader: "ADMIN.example.com" });
    const { status: trailingDot } = await request(server.port, undefined, { hostHeader: "admin.example.com." });
    const { status: maxLength } = await request(server.port, undefined, { hostHeader: maxLengthName });
    const { status: maxLengthTrailingDot } = await request(server.port, undefined, {
      hostHeader: `${maxLengthName}.`,
    });
    const { status: lenientNoSni } = await request(server.port, undefined, { hostHeader: "lenient.example.com" });
    const { status: defaultNoSni } = await request(server.port, undefined, { hostHeader: "localhost" });
    const { status: gatedWithCert } = await request(server.port, "admin.example.com", trustedClient);
    expect({
      noSni,
      unknownSni,
      otherNamedSni,
      withPort,
      upperCase,
      trailingDot,
      maxLength,
      maxLengthTrailingDot,
      lenientNoSni,
      defaultNoSni,
      gatedWithCert,
    }).toEqual({
      noSni: MISDIRECTED,
      unknownSni: MISDIRECTED,
      otherNamedSni: MISDIRECTED,
      withPort: MISDIRECTED,
      upperCase: MISDIRECTED,
      trailingDot: MISDIRECTED,
      maxLength: MISDIRECTED,
      maxLengthTrailingDot: MISDIRECTED,
      lenientNoSni: MISDIRECTED,
      defaultNoSni: "HTTP/1.1 200 OK",
      gatedWithCert: "HTTP/1.1 200 OK",
    });
    // Rejected requests must never reach the handler: the check runs before routing.
    expect(routedHosts).toEqual(["localhost", "admin.example.com"]);
  });

  test("the gated-Host check applies per request on a keep-alive connection", async () => {
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
    // Handshake without SNI, get an innocent 200, then switch Host on the
    // same connection.
    const { promise, resolve } = Promise.withResolvers<string[]>();
    const socket = tls.connect({ host: "127.0.0.1", port: server.port, rejectUnauthorized: false });
    let received = "";
    let sentSecond = false;
    socket.on("secureConnect", () => {
      socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
    });
    // The first body has no trailing newline, so status lines are not always
    // at a \r\n boundary in the concatenated stream.
    const statuses = () => received.match(/HTTP\/1\.1 \d{3} [^\r]+/g) ?? [];
    socket.on("data", chunk => {
      received += chunk.toString();
      if (!sentSecond && received.includes("served localhost")) {
        sentSecond = true;
        // No Connection: close from the client: the close awaited below must
        // come from the server tearing down the rejected connection.
        socket.write("GET / HTTP/1.1\r\nHost: admin.example.com\r\n\r\n");
      } else if (sentSecond && statuses().length === 2 && received.endsWith("admin.example.com")) {
        // A server without the check serves the second request and keeps the
        // connection open; resolve on the complete response instead of hanging.
        resolve(statuses());
        socket.destroy();
      }
    });
    socket.on("error", () => {});
    socket.on("close", () => resolve(statuses()));
    expect(await promise).toEqual(["HTTP/1.1 200 OK", "HTTP/1.1 421 Misdirected Request"]);
  });

  test("HTTP/3: an :authority naming a gated serverName gets 421 on a connection that bypassed its policy", async () => {
    using server = Bun.serve({
      port: 0,
      http3: true,
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
    const h3 = (headers: Record<string, string> = {}) =>
      fetch(`https://127.0.0.1:${server.port}/`, {
        protocol: "http3",
        headers,
        tls: { rejectUnauthorized: false },
      } as RequestInit);
    // The first request pools a QUIC connection handshaken without SNI (the
    // host is an IP literal): the default context, no client certificate
    // requested. The second rides that connection with a spoofed authority.
    const innocent = await h3();
    const bypass = await h3({ Host: "admin.example.com" });
    expect({ innocent: innocent.status, bypass: bypass.status }).toEqual({ innocent: 200, bypass: 421 });
  });

  // The check resolves the Host against the accepting listener's SNI tree.
  // A graceful server.stop() frees that tree while connections drain, so the
  // check must fail closed: a gated Host on a connection whose policy can no
  // longer be verified gets 421, not served.
  test("a gated Host fails closed on a connection draining after server.stop()", async () => {
    // using: stop() is idempotent, and the scope-exit disposal is the only
    // cleanup on the path where the handshake fails before secureConnect.
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
    const { promise, resolve } = Promise.withResolvers<string>();
    // No SNI (connect by IP): lands on the default context, no client cert.
    const socket = tls.connect({ host: "127.0.0.1", port: server.port, rejectUnauthorized: false });
    let received = "";
    socket.on("secureConnect", () => {
      // Graceful stop frees the listener (and its SNI tree) synchronously,
      // while this handshaked-but-idle connection stays open to drain.
      server.stop();
      socket.write("GET / HTTP/1.1\r\nHost: admin.example.com\r\nConnection: close\r\n\r\n");
    });
    socket.on("data", chunk => (received += chunk.toString()));
    socket.on("error", () => {});
    socket.on("close", () => resolve(received.split("\r\n")[0] || "connection closed without a response"));
    expect(await promise).toBe("HTTP/1.1 421 Misdirected Request");
  });
});
