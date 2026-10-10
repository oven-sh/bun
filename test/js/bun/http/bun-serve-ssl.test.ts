import { describe, expect, test } from "bun:test";
import { readFileSync, symlinkSync } from "fs";
import { bunEnv, bunExe, expiredTls, isWindows, tempDir, tls as tlsCert } from "harness";
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
            keepalive: false,
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
          keepalive: false,
        });
      });
    }
  }
});

describe("Bun.serve top-level TLS options mixed with tls", () => {
  const tlsFixtures = join(import.meta.dir, "..", "..", "node", "tls", "fixtures");
  const serverKey = readFileSync(join(tlsFixtures, "agent10-key.pem"), "utf8");
  const serverCert = readFileSync(join(tlsFixtures, "agent10-cert.pem"), "utf8");
  const clientCa = readFileSync(join(tlsFixtures, "ca5-cert.pem"), "utf8");
  const fetch = () => new Response("Hello, world!");

  const mixed = [
    {
      label: "mTLS keys at the top level next to tls: {cert, key}",
      options: { ca: clientCa, requestCert: true, rejectUnauthorized: true, tls: { key: serverKey, cert: serverCert } },
      key: "rejectUnauthorized",
    },
    {
      label: "cert and key at the top level next to tls: {ca, requestCert}",
      options: { key: serverKey, cert: serverCert, tls: { ca: clientCa, requestCert: true, rejectUnauthorized: true } },
      key: "cert",
    },
    {
      label: "top-level keys next to a tls object that only holds defaults",
      options: { key: serverKey, cert: serverCert, requestCert: true, tls: { requestCert: false } },
      key: "requestCert",
    },
    {
      label: "top-level keys next to an empty tls object",
      options: { key: serverKey, cert: serverCert, tls: {} },
      key: "cert",
    },
    {
      label: "top-level keys next to a tls array",
      options: { ca: clientCa, tls: [{ key: serverKey, cert: serverCert }] },
      key: "ca",
    },
    {
      label: "the servername alias at the top level",
      options: { servername: "localhost", tls: { key: serverKey, cert: serverCert } },
      key: "servername",
    },
  ];
  for (const { label, options, key } of mixed) {
    test(label, () => {
      expect(() => Bun.serve({ port: 0, fetch, ...(options as any) })).toThrow(
        `Bun.serve() received both "tls" and the top-level TLS option "${key}". Move "${key}" into the "tls" object.`,
      );
    });
  }

  test("top-level TLS keys set to undefined or null are not a mix", async () => {
    using server = Bun.serve({
      port: 0,
      fetch,
      ca: undefined,
      requestCert: undefined,
      cert: null,
      rejectUnauthorized: null,
      tls: { key: serverKey, cert: serverCert },
    } as any);
    const res = await globalThis.fetch(server.url, { tls: { rejectUnauthorized: false } });
    expect(await res.text()).toBe("Hello, world!");
  });

  test("tls: false next to top-level keys is not a mix", async () => {
    using server = Bun.serve({
      port: 0,
      fetch,
      key: serverKey,
      cert: serverCert,
      tls: false,
    } as any);
    const res = await globalThis.fetch(server.url, { tls: { rejectUnauthorized: false } });
    expect(await res.text()).toBe("Hello, world!");
  });

  test("the legacy top-level form alone still enforces mTLS", async () => {
    using server = Bun.serve({
      port: 0,
      fetch,
      key: serverKey,
      cert: serverCert,
      ca: clientCa,
      requestCert: true,
      rejectUnauthorized: true,
    } as any);
    const { promise, resolve } = Promise.withResolvers<string>();
    const socket = tls.connect({ host: "127.0.0.1", port: server.port, rejectUnauthorized: false });
    let received = "";
    socket.on("secureConnect", () => socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"));
    socket.on("data", chunk => (received += chunk.toString()));
    socket.on("error", () => {});
    socket.on("close", () => resolve(received.split("\r\n")[0] || "connection closed without a response"));
    expect(await promise).toBe("connection closed without a response");
  });
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

  type ClientOptions = {
    key?: string;
    cert?: string;
    session?: Buffer;
    minVersion?: tls.SecureVersion;
    maxVersion?: tls.SecureVersion;
  };
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
    const { status: gatedNoCert } = await request(server.port!, "admin.example.com");
    const { status: gatedTrustedCert } = await request(server.port!, "admin.example.com", trustedClient);
    const { status: gatedUntrustedCert } = await request(server.port!, "admin.example.com", untrustedClient);
    const { status: lenientNoCert } = await request(server.port!, "lenient.example.com");
    const { status: defaultNoCert } = await request(server.port!, "localhost");
    expect({ gatedNoCert, gatedTrustedCert, gatedUntrustedCert, lenientNoCert, defaultNoCert }).toEqual({
      gatedNoCert: "connection closed without a response",
      gatedTrustedCert: "HTTP/1.1 200 OK",
      gatedUntrustedCert: "connection closed without a response",
      lenientNoCert: "HTTP/1.1 200 OK",
      defaultNoCert: "HTTP/1.1 200 OK",
    });
  });

  test("a serverName of more than 10 labels is selected at the handshake", async () => {
    // The native SNI tree used to stop matching at 10 labels, so the entry
    // was registered but the default certificate was served for it.
    const longName = "a.b.c.d.e.f.g.h.i.j.k.example";
    using server = Bun.serve({
      port: 0,
      tls: [
        { key: serverKey, cert: serverCert },
        {
          serverName: longName,
          key: serverKey,
          cert: serverCert,
          ca: clientCa,
          requestCert: true,
          rejectUnauthorized: true,
        },
      ],
      fetch: req => new Response(`served ${req.headers.get("host")}`),
    });
    const { status: noCert } = await request(server.port!, longName);
    const { status: trustedCert } = await request(server.port!, longName, trustedClient);
    expect({ noCert, trustedCert }).toEqual({
      noCert: "connection closed without a response",
      trustedCert: "HTTP/1.1 200 OK",
    });
  });

  // The client picks the SNI, so a spelling that misses the entry would skip its policy.
  test.each(["TLSv1.2", "TLSv1.3"] as const)(
    "a strict entry is enforced for every spelling of its name (%s)",
    async version => {
      const strict = { key: serverKey, cert: serverCert, ca: clientCa, requestCert: true, rejectUnauthorized: true };
      using server = Bun.serve({
        port: 0,
        tls: [
          { key: serverKey, cert: serverCert },
          { serverName: "Admin.Example.com", ...strict },
          { serverName: "*.gated.example", ...strict },
          { serverName: "\u00e9.example", ...strict },
        ],
        fetch: () => new Response("served"),
      });
      const spellings = [
        "admin.example.com",
        "ADMIN.EXAMPLE.COM",
        "aDmIn.eXaMpLe.CoM",
        "admin.example.com.",
        "ADMIN.EXAMPLE.COM.",
        "a.gated.example",
        "A.GATED.EXAMPLE",
        "a.Gated.Example.",
      ];
      const pinned = { minVersion: version, maxVersion: version };
      const outcomes = await Promise.all(
        spellings.map(async name => [
          name,
          (await request(server.port!, name, pinned)).status,
          (await request(server.port!, name, { ...pinned, ...untrustedClient })).status,
          (await request(server.port!, name, { ...pinned, ...trustedClient })).status,
        ]),
      );
      const closed = "connection closed without a response";
      expect(outcomes).toEqual(spellings.map(name => [name, closed, closed, "HTTP/1.1 200 OK"]));
      // Only A-Z folds: U+00E9 and U+00C9 differ by 0x20 in their last UTF-8 byte and stay two names.
      expect({
        registered: (await request(server.port!, "\u00e9.example", pinned)).status,
        other: (await request(server.port!, "\u00c9.example", pinned)).status,
      }).toEqual({ registered: closed, other: "HTTP/1.1 200 OK" });
    },
  );

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
    const { status: defaultFresh, session } = await request(server.port!, "localhost");
    expect(session).toBeInstanceOf(Buffer);
    const { status: defaultResumed } = await request(server.port!, "localhost", { session });
    const { status: gatedResumed } = await request(server.port!, "admin.example.com", { session });
    expect({ defaultFresh, defaultResumed, gatedResumed }).toEqual({
      defaultFresh: "HTTP/1.1 200 OK",
      defaultResumed: "HTTP/1.1 200 OK",
      gatedResumed: "connection closed without a response",
    });
  });

  // agent3 (CN agent3) is a second certificate so a test can tell which
  // entry served the handshake.
  const otherKey = readFileSync(join(tlsFixtures, "agent3-key.pem"), "utf8");
  const otherCert = readFileSync(join(tlsFixtures, "agent3-cert.pem"), "utf8");
  const openEntry = { key: serverKey, cert: serverCert };
  const gatedEntry = {
    key: otherKey,
    cert: otherCert,
    ca: clientCa,
    requestCert: true,
    rejectUnauthorized: true,
  };

  function peerCN(port: number, servername: string) {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const socket = tls.connect({ host: "127.0.0.1", port, servername, rejectUnauthorized: false });
    socket.on("secureConnect", () => {
      resolve((socket.getPeerCertificate()?.subject?.CN ?? "-") as string);
      socket.destroy();
    });
    socket.on("error", reject);
    socket.on("close", () => reject(new Error("closed before the handshake completed")));
    return promise;
  }

  // Each case lists two entries for admin.example.com. The later one sets a
  // client certificate policy. Like tls.Server#addContext(), the later entry
  // wins: the name serves agent3 and rejects a handshake with no client cert.
  const duplicateCases: [string, Parameters<typeof Bun.serve>[0]["tls"]][] = [
    [
      "a later entry with the same serverName replaces the earlier one",
      [
        { ...openEntry },
        { serverName: "admin.example.com", ...openEntry },
        { serverName: "admin.example.com", ...gatedEntry },
      ],
    ],
    [
      "a serverName with a trailing root dot names the same host",
      [
        { ...openEntry },
        { serverName: "admin.example.com", ...openEntry },
        { serverName: "admin.example.com.", ...gatedEntry },
      ],
    ],
    [
      "a serverName in another case names the same host",
      [
        { ...openEntry },
        { serverName: "admin.example.com", ...openEntry },
        { serverName: "ADMIN.Example.com", ...gatedEntry },
      ],
    ],
    [
      "a later entry replaces the default entry's own serverName",
      [
        { ...openEntry, serverName: "admin.example.com" },
        { serverName: "admin.example.com", ...gatedEntry },
      ],
    ],
  ];
  for (const [label, tlsConfig] of duplicateCases) {
    test(label, async () => {
      using server = Bun.serve({
        port: 0,
        tls: tlsConfig,
        fetch: req => new Response(`served ${req.headers.get("host")}`),
      });
      const servedCN = await peerCN(server.port!, "admin.example.com");
      const { status: gatedNoCert } = await request(server.port!, "admin.example.com");
      const { status: gatedTrustedCert } = await request(server.port!, "admin.example.com", trustedClient);
      const { status: defaultNoCert } = await request(server.port!, "localhost");
      expect({ servedCN, gatedNoCert, gatedTrustedCert, defaultNoCert }).toEqual({
        servedCN: "agent3",
        gatedNoCert: "connection closed without a response",
        gatedTrustedCert: "HTTP/1.1 200 OK",
        defaultNoCert: "HTTP/1.1 200 OK",
      });
    });
  }

  test("the last of three entries for one serverName wins", async () => {
    using server = Bun.serve({
      port: 0,
      tls: [
        { ...openEntry },
        { serverName: "admin.example.com", ...gatedEntry },
        { serverName: "admin.example.com", ...openEntry },
        { serverName: "admin.example.com.", key: otherKey, cert: otherCert },
      ],
      fetch: () => new Response("served"),
    });
    const servedCN = await peerCN(server.port!, "admin.example.com");
    const { status: noCert } = await request(server.port!, "admin.example.com");
    expect({ servedCN, noCert }).toEqual({ servedCN: "agent3", noCert: "HTTP/1.1 200 OK" });
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
      for (let i = 0; i < 32; i++) raws.push(net.connect({ host: "127.0.0.1", port: server.port! }));
      for (const raw of raws) raw.on("error", () => {});
      await Promise.all(raws.map(raw => once(raw, "connect")));

      const firstHandshake = Promise.withResolvers<void>();
      // No client presents a certificate.
      const outcomes = raws.map(raw => {
        const { promise, resolve } = Promise.withResolvers<{ certificate: string; status: string }>();
        let certificate = "no handshake";
        let received = "";
        const socket = tls.connect({ socket: raw, servername: "admin.example.com", rejectUnauthorized: false }, () => {
          certificate = socket.getPeerCertificate().subject.CN as string;
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

test.each(["Bun.serve", "Bun.listen"] as const)("%s serves every identity of key/cert arrays", async api => {
  const read = (name: string) => readFileSync(join(import.meta.dir, "../../node/tls/fixtures", name), "utf8");
  const identities = {
    key: [read("agent1-key.pem"), read("ec10-key.pem")],
    cert: [read("agent1-cert.pem"), read("ec10-cert.pem")],
  };
  using server =
    api === "Bun.serve"
      ? Bun.serve({ port: 0, hostname: "127.0.0.1", tls: identities, fetch: () => new Response("ok") })
      : Bun.listen({ port: 0, hostname: "127.0.0.1", tls: identities, socket: { data() {} } });

  function served(options: tls.ConnectionOptions) {
    const { promise, resolve } = Promise.withResolvers<string>();
    const socket = tls.connect({ port: server.port, host: "127.0.0.1", rejectUnauthorized: false, ...options }, () => {
      resolve(socket.getPeerCertificate().subject.CN as string);
      socket.destroy();
    });
    socket.on("error", e => resolve((e as NodeJS.ErrnoException).code!));
    return promise;
  }
  expect({
    "TLS 1.2, ECDSA only": await served({ maxVersion: "TLSv1.2", ciphers: "ECDHE-ECDSA-AES128-GCM-SHA256" }),
    "TLS 1.2, RSA only": await served({ maxVersion: "TLSv1.2", ciphers: "ECDHE-RSA-AES128-GCM-SHA256" }),
    "TLS 1.3": await served({}),
    "TLS 1.3, RSA only": await served({ sigalgs: "rsa_pss_rsae_sha256" }),
  }).toEqual({
    "TLS 1.2, ECDSA only": "agent10.example.com",
    "TLS 1.2, RSA only": "agent1",
    "TLS 1.3": "agent10.example.com",
    "TLS 1.3, RSA only": "agent1",
  });
});

test.each(["Bun.serve", "Bun.listen"] as const)(
  "%s serves the last of two key/cert pairs of one key type",
  async api => {
    const read = (name: string) => readFileSync(join(import.meta.dir, "../../node/tls/fixtures", name), "utf8");
    for (const key of [
      [read("agent1-key.pem"), read("agent2-key.pem")],
      [read("agent2-key.pem"), read("agent1-key.pem")],
    ]) {
      const identities = { key, cert: [read("agent1-cert.pem"), read("agent2-cert.pem")] };
      using server =
        api === "Bun.serve"
          ? Bun.serve({ port: 0, hostname: "127.0.0.1", tls: identities, fetch: () => new Response("ok") })
          : Bun.listen({ port: 0, hostname: "127.0.0.1", tls: identities, socket: { data() {} } });
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      const socket = tls.connect({ port: server.port, host: "127.0.0.1", rejectUnauthorized: false }, () =>
        resolve(socket.getPeerCertificate().subject.CN as string),
      );
      socket.on("error", reject);
      try {
        expect(await promise).toBe("agent2");
      } finally {
        socket.destroy();
      }
    }
  },
);

test("keyFile/certFile/caFile/dhParamsFile reject a path with a NUL byte instead of loading its prefix", () => {
  using dir = tempDir("bun-serve-ssl-nul", { "key.pem": tlsCert.key, "cert.pem": tlsCert.cert });
  const keyFile = join(String(dir), "key.pem");
  const certFile = join(String(dir), "cert.pem");
  const nul = "\0-does-not-exist";
  const thrown = (field: string) =>
    expect.objectContaining({
      code: "ERR_INVALID_ARG_VALUE",
      message: `TLSOptions.${field} must be a path without null bytes`,
    });
  for (const [field, options] of [
    ["keyFile", { keyFile: keyFile + nul, certFile }],
    ["certFile", { keyFile, certFile: certFile + nul }],
    ["caFile", { keyFile, certFile, caFile: certFile + nul }],
    ["dhParamsFile", { keyFile, certFile, dhParamsFile: certFile + nul }],
  ] as const) {
    expect(() => Bun.serve({ port: 0, tls: options, fetch: () => new Response("unreachable") })).toThrow(thrown(field));
    expect(() => Bun.listen({ hostname: "127.0.0.1", port: 0, tls: options, socket: { data() {} } })).toThrow(
      thrown(field),
    );
    expect(() => tls.createSecureContext(options as Bun.TLSOptions as tls.SecureContextOptions)).toThrow(thrown(field));
  }
  expect(() => Bun.serve({ port: 0, tls: { keyFile: "", certFile }, fetch: () => new Response() })).toThrow(
    "Unable to access keyFile path",
  );
});

// `linkdir/..` is `other`, where the key of the certificate is. Resolved as text it is the directory of another key.
test.skipIf(isWindows).each(["relative", "absolute"])(
  "keyFile reaches `..` through a symlink (%s path)",
  async kind => {
    using dir = tempDir("bun-serve-ssl-symlink", {
      "cert.pem": tlsCert.cert,
      "key.pem": expiredTls.key,
      "other/key.pem": tlsCert.key,
      "other/sub/.keep": "",
    });
    symlinkSync(join(String(dir), "other", "sub"), join(String(dir), "linkdir"));
    const script = `
    using server = Bun.serve({
      port: 0,
      tls: { keyFile: process.argv[1] + "linkdir/../key.pem", certFile: "./cert.pem" },
      fetch: () => new Response("served"),
    });
    console.log(await fetch(server.url, { tls: { caFile: "cert.pem" } }).then(res => res.text()));
  `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script, kind === "absolute" ? String(dir) + "/" : ""],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "served\n", stderr: "", exitCode: 0 });
  },
);

test.skipIf(isWindows)("a keyFile with a trailing slash is not the file without it", () => {
  using dir = tempDir("bun-serve-ssl-slash", { "key.pem": tlsCert.key, "cert.pem": tlsCert.cert });
  const certFile = join(String(dir), "cert.pem");
  expect(() =>
    Bun.serve({ port: 0, tls: { keyFile: join(String(dir), "key.pem") + "/", certFile }, fetch: () => new Response() }),
  ).toThrow("Unable to access keyFile path");
});

describe.concurrent("client certificate policy", () => {
  async function run(NODE_TLS_REJECT_UNAUTHORIZED: string | undefined, policies: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "tls-client-cert-policy-fixture.mjs"), ...policies],
      env: { ...bunEnv, NODE_TLS_REJECT_UNAUTHORIZED },
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    return { table: JSON.parse(stdout), exitCode };
  }
  // A client with no certificate | with one the server's `ca` did not issue | with one it issued.
  const rows = {
    "ca": ["anonymous", "anonymous", "anonymous"],
    "caFile": ["anonymous", "anonymous", "anonymous"],
    "ca, requestCert": [null, null, "agent10.example.com"],
    "ca, requestCert, rejectUnauthorized: false": ["anonymous", "agent2", "agent10.example.com"],
  };
  function everyServer(policies: (keyof typeof rows)[]) {
    const table = (namesItsPeer: boolean) =>
      Object.fromEntries(
        policies.flatMap(policy => {
          const row = rows[policy].map(peer => (peer ? `served ${namesItsPeer ? peer : "someone"}` : "refused"));
          return ["TLSv1.2", "TLSv1.3"].map(version => [`${policy} (${version})`, row.join(" | ")]);
        }),
      );
    return {
      "tls.createServer": table(true),
      "tls.createServer over a Duplex": table(true),
      "https.createServer": table(false),
      "Bun.serve": table(false),
      "Bun.serve serverName entry": table(false),
      "Bun.listen": table(true),
      "upgradeTLS({ isServer: true, tls })": table(true),
      "upgradeTLS({ isServer: true, secureContext })": table(true),
    };
  }

  test("no server asks for a certificate without requestCert", async () => {
    expect(await run(undefined, ["ca", "caFile"])).toEqual({ table: everyServer(["ca", "caFile"]), exitCode: 0 });
  }, 30_000);

  describe.each([undefined, "0"])("with NODE_TLS_REJECT_UNAUTHORIZED=%p", NODE_TLS_REJECT_UNAUTHORIZED => {
    test("every server enforces requestCert", async () => {
      const policies = ["ca, requestCert", "ca, requestCert, rejectUnauthorized: false"] as const;
      expect(await run(NODE_TLS_REJECT_UNAUTHORIZED, [...policies])).toEqual({
        table: everyServer([...policies]),
        exitCode: 0,
      });
    }, 30_000);

    test("a client that leaves rejectUnauthorized unset follows the variable", async () => {
      const off = NODE_TLS_REJECT_UNAUTHORIZED === "0";
      expect(await run(NODE_TLS_REJECT_UNAUTHORIZED, [])).toEqual({
        table: {
          "tls.connect": off ? "connected" : "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
          fetch: off ? "connected" : "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
          "Bun.connect": off ? "connected" : "closed",
        },
        exitCode: 0,
      });
    });
  });
});
