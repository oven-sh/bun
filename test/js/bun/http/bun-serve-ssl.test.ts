import { describe, expect, test } from "bun:test";
import { tls as COMMON_CERT } from "harness";
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

describe("Bun.serve ALPN", () => {
  // Resolves with the protocol the server selected, or the error code when the
  // server refused the handshake.
  function probe(port: number, ALPNProtocols: string[] | undefined, servername = "localhost") {
    const { promise, resolve } = Promise.withResolvers<{ alpn?: string | false; code?: string }>();
    const socket = connect({ host: "127.0.0.1", port, servername, ca: COMMON_CERT.cert, ALPNProtocols }, () => {
      resolve({ alpn: socket.alpnProtocol });
      socket.destroy();
    });
    socket.on("error", (err: NodeJS.ErrnoException) => resolve({ code: err.code }));
    return promise;
  }

  const serve = (tls: object) => Bun.serve({ port: 0, tls, fetch: () => new Response("hello") });

  test("selects http/1.1 by default, like node's https.Server", async () => {
    using server = serve({ ...COMMON_CERT });
    expect(await probe(server.port, ["h2", "http/1.1"])).toEqual({ alpn: "http/1.1" });
  });

  test("a client offering no overlapping protocol gets a fatal no_application_protocol alert", async () => {
    using server = serve({ ...COMMON_CERT });
    expect(await probe(server.port, ["bogus/9"])).toEqual({ code: "ERR_SSL_TLSV1_ALERT_NO_APPLICATION_PROTOCOL" });
  });

  test("a client that offers no ALPN at all still completes the handshake", async () => {
    using server = serve({ ...COMMON_CERT });
    expect(await probe(server.port, undefined)).toEqual({ alpn: false });
  });

  test("honors an explicit ALPNProtocols wire-format list", async () => {
    using server = serve({ ...COMMON_CERT, ALPNProtocols: Buffer.from("\x02h2\x08http/1.1", "binary") });
    // The server's list decides the preference order, so h2 wins here.
    expect(await probe(server.port, ["http/1.1", "h2"])).toEqual({ alpn: "h2" });
    expect(await probe(server.port, ["http/1.1"])).toEqual({ alpn: "http/1.1" });
    expect(await probe(server.port, ["bogus/9"])).toEqual({ code: "ERR_SSL_TLSV1_ALERT_NO_APPLICATION_PROTOCOL" });
  });

  test("honors an explicit ALPNProtocols string", async () => {
    using server = serve({ ...COMMON_CERT, ALPNProtocols: "\x06custom" });
    expect(await probe(server.port, ["custom"])).toEqual({ alpn: "custom" });
    expect(await probe(server.port, ["http/1.1"])).toEqual({ code: "ERR_SSL_TLSV1_ALERT_NO_APPLICATION_PROTOCOL" });
  });

  test("fetch reports the refused ALPN offer, not a certificate error", async () => {
    // fetch offers http/1.1, which this server does not support.
    using server = serve({ ...COMMON_CERT, ALPNProtocols: "\x06custom" });
    const err = await fetch(server.url, { tls: { ca: COMMON_CERT.cert } }).catch(e => e);
    expect({ code: err.code, message: err.message }).toEqual({
      code: "ERR_SSL_TLSV1_ALERT_NO_APPLICATION_PROTOCOL",
      message: "The server supports none of the ALPN protocols this request offered",
    });
  });

  test("an empty ALPNProtocols list opts out of negotiation", async () => {
    using server = serve({ ...COMMON_CERT, ALPNProtocols: Buffer.alloc(0) });
    expect(await probe(server.port, ["http/1.1"])).toEqual({ alpn: false });
  });

  // A list that isn't wire format refuses every client that offers ALPN, so say
  // so up front rather than at handshake time. `"h2"` is the shape a reader of
  // node's `ALPNProtocols: ["h2"]` would reach for first.
  test.each([
    ["a bare protocol name", "h2"],
    ["a bare protocol name with a slash", "http/1.1"],
    ["a length byte running past the end", Buffer.from([0xff])],
    ["a name shorter than its length byte", Buffer.from([0x02, 0x68])],
    ["a trailing length byte with no name", Buffer.from("\x02h2\x08", "binary")],
    ["a zero-length name", Buffer.from([0x00])],
    // Legal ALPN, but it cannot survive the C string `protos` is stored as.
    ["a name containing a NUL", Buffer.from([0x03, 0x61, 0x00, 0x62])],
  ])("rejects ALPNProtocols that is not a valid list: %s", (_label, ALPNProtocols) => {
    expect(() => serve({ ...COMMON_CERT, ALPNProtocols })).toThrow(
      /TLSOptions\.ALPNProtocols is not a valid ALPN protocol list/,
    );
  });

  test("SNI contexts negotiate ALPN too", async () => {
    using server = Bun.serve({
      port: 0,
      tls: [{ ...COMMON_CERT }, { ...COMMON_CERT, serverName: "localhost" }],
      fetch: () => new Response("hello"),
    });
    expect(await probe(server.port, ["h2", "http/1.1"])).toEqual({ alpn: "http/1.1" });
    expect(await probe(server.port, ["bogus/9"])).toEqual({ code: "ERR_SSL_TLSV1_ALERT_NO_APPLICATION_PROTOCOL" });
  });
});
