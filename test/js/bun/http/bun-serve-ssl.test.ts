import type { Server } from "bun";
import { describe, expect, test } from "bun:test";
import { readFileSync, symlinkSync } from "fs";
import {
  bunEnv,
  bunExe,
  bunRun,
  expectRssDeltaBelow,
  expiredTls,
  isASAN,
  isDebug,
  isWindows,
  tempDir,
  tls as tlsCert,
} from "harness";
import { createHash } from "node:crypto";
import { once } from "node:events";
import net, { type AddressInfo } from "node:net";
import tls from "node:tls";
import { join } from "path";
import privateKey from "../../third_party/jsonwebtoken/priv.pem" with { type: "text" };
import publicKey from "../../third_party/jsonwebtoken/pub.pem" with { type: "text" };
import { connectH2, request } from "./serve-http2-helpers";

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

test("server.reload() updates the routes for connections whose SNI matches a serverName", async () => {
  const hosts = ["localhost", "sni.example.com", "unmatched.example.com"];
  const bodies = async (path: string) =>
    Object.fromEntries(
      await Promise.all(
        hosts.map(async serverName => {
          const response = await fetch(`https://127.0.0.1:${server.port}${path}`, {
            tls: { rejectUnauthorized: false, serverName },
            keepalive: false,
          });
          return [serverName, await response.text()];
        }),
      ),
    );
  const all = (body: string) => Object.fromEntries(hosts.map(host => [host, body]));

  using server = Bun.serve({
    port: 0,
    tls: [
      { key: privateKey, cert: publicKey, serverName: "localhost" },
      { key: privateKey, cert: publicKey, serverName: "sni.example.com" },
    ],
    routes: {
      "/static-old": new Response("static-old"),
      "/fn-old": () => new Response("fn-old"),
    },
    fetch: () => new Response("fetch-old"),
  });
  expect(await bodies("/static-old")).toEqual(all("static-old"));
  expect(await bodies("/fn-old")).toEqual(all("fn-old"));

  server.reload({
    routes: {
      "/static-new": new Response("static-new"),
      "/fn-new": () => new Response("fn-new"),
    },
    fetch: () => new Response("fetch-new"),
  });
  expect(await bodies("/static-new")).toEqual(all("static-new"));
  expect(await bodies("/fn-new")).toEqual(all("fn-new"));
  expect(await bodies("/static-old")).toEqual(all("fetch-new"));
  expect(await bodies("/fn-old")).toEqual(all("fetch-new"));
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

test.skipIf(isWindows)("a backslash is part of a name in keyFile, certFile and the cwd", async () => {
  using dir = tempDir("bun-serve-ssl-backslash", {
    "a\\b": {
      "key.pem": tlsCert.key,
      "c\\cert.pem": tlsCert.cert,
      "serve.js": String.raw`
        const tls = { keyFile: import.meta.dir + "/key.pem", certFile: "c\\cert.pem" };
        using server = Bun.serve({ port: 0, tls, fetch: () => new Response("served") });
        console.log(await (await fetch(server.url, { tls: { rejectUnauthorized: false } })).text());
      `,
    },
  });
  expect(await bunRun(join(String(dir), "a\\b", "serve.js"))).toSpawn("served");
});

test.skipIf(isWindows).each(["/", "\\"])("keyFile with a trailing %s is rejected", sep => {
  using dir = tempDir("bun-serve-ssl-slash", { "key.pem": tlsCert.key, "cert.pem": tlsCert.cert });
  const certFile = join(String(dir), "cert.pem");
  expect(() =>
    Bun.serve({ port: 0, tls: { keyFile: join(String(dir), "key.pem") + sep, certFile }, fetch: () => new Response() }),
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

// Sanitizer and debug builds do not hand freed memory back as it was, so only a release build can fail these.
test.concurrent.each([
  ["key", "{ key: latin1 }", "ERR_OSSL_PEM_NO_START_LINE"],
  ["key in a 16-bit string", "{ key: utf16 }", "ERR_OSSL_PEM_NO_START_LINE"],
  ["key in a Buffer", "{ key: bytes }", "ERR_OSSL_PEM_NO_START_LINE"],
  ["key after a NUL", "{ key: afterNul }", "ERR_OSSL_PEM_NO_START_LINE"],
  ["key in a file", `{ key: Bun.file("small") }`, "ERR_OSSL_PEM_NO_START_LINE"],
  ["key in a file larger than the first read", `{ key: Bun.file("large") }`, "ERR_OSSL_PEM_NO_START_LINE"],
  ["passphrase", `{ ...${JSON.stringify(tlsCert)}, passphrase: latin1 }`, undefined],
])("a TLS %s leaves no copy in freed memory", async (_, options, error) => {
  using dir = tempDir("tls-secret", { small: Buffer.alloc(3000, "K"), large: Buffer.alloc(300_000, "K") });
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const bytes = Buffer.alloc(3000, "K");
        // Globals, so that they are never freed themselves.
        globalThis.latin1 = bytes.toString("latin1");
        globalThis.afterNul = Buffer.alloc(3000, "K").fill(0, 1, 2);
        const utf16 = Buffer.alloc(6000, "K\\0").fill("\\u2603", 5998, 6000, "utf16le").toString("utf16le");
        function isInFreedMemory() {
          const blocks = [3000, 3001, 6000, 256 * 1024, 300_000].flatMap(size =>
            Array.from({ length: 16 }, () => Buffer.allocUnsafeSlow(size)),
          );
          return blocks.some(block => block.includes(bytes.subarray(0, 100)));
        }
        const before = isInFreedMemory();
        Bun.gc(true);
        let error;
        try {
          Bun.serve({ port: 0, fetch() {}, tls: ${options} }).stop(true);
        } catch (e) {
          error = String(e.code);
        }
        console.log(JSON.stringify({ before, error, after: isInFreedMemory() }));
      `,
    ],
    cwd: String(dir),
    env: bunEnv,
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(JSON.parse(stdout)).toEqual({ before: false, error, after: false });
  expect(exitCode).toBe(0);
});

const SERVER_NAME = 0;
const ALPN = 16;
const QUIC_TRANSPORT_PARAMETERS = 0x39;

// parseClientHello and ja4 are the two functions of docs/runtime/http/tls.mdx, as written there.
function parseClientHello(raw: Uint8Array) {
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  let offset = 2 + 32; // legacy_version, random
  offset += 1 + view.getUint8(offset); // legacy_session_id

  const cipherSuites: number[] = [];
  const cipherSuitesEnd = offset + 2 + view.getUint16(offset);
  for (offset += 2; offset < cipherSuitesEnd; offset += 2) cipherSuites.push(view.getUint16(offset));

  offset += 1 + view.getUint8(offset); // legacy_compression_methods

  const extensions: { type: number; data: Uint8Array }[] = [];
  if (offset < raw.length) {
    const extensionsEnd = offset + 2 + view.getUint16(offset);
    for (offset += 2; offset < extensionsEnd;) {
      const length = view.getUint16(offset + 2);
      extensions.push({ type: view.getUint16(offset), data: raw.subarray(offset + 4, offset + 4 + length) });
      offset += 4 + length;
    }
  }
  return { legacyVersion: view.getUint16(0), cipherSuites, extensions };
}

const isGrease = (value: number) => (value & 0x0f0f) === 0x0a0a && value >> 8 === (value & 0xff);
const hex4 = (value: number) => value.toString(16).padStart(4, "0");
const count = (values: number[]) => String(Math.min(values.length, 99)).padStart(2, "0");
const hash = (list: string) => (list ? createHash("sha256").update(list).digest("hex").slice(0, 12) : "000000000000");
const isAlphanumeric = (byte: number) => /[0-9A-Za-z]/.test(String.fromCharCode(byte));
const versions: Record<number, string> = { 0x0304: "13", 0x0303: "12", 0x0302: "11", 0x0301: "10", 0x0300: "s3" };

function u16List(data: Uint8Array | undefined, start: number) {
  const values: number[] = [];
  for (let i = start; data && i + 1 < data.length; i += 2) values.push((data[i] << 8) | data[i + 1]);
  return values.filter(value => !isGrease(value));
}

// `transport` is "t" for TLS over TCP (HTTP/1.1, HTTP/2) and "q" for QUIC (HTTP/3).
function ja4(raw: Uint8Array, transport: "t" | "q") {
  const { legacyVersion, cipherSuites, extensions } = parseClientHello(raw);
  const extension = (type: number) => extensions.find(e => e.type === type)?.data;

  const ciphers = cipherSuites.filter(cipher => !isGrease(cipher));
  const types = extensions.map(e => e.type).filter(type => !isGrease(type));
  const version = Math.max(...u16List(extension(0x002b), 1), 0) || legacyVersion; // supported_versions
  const signatureAlgorithms = u16List(extension(0x000d), 2);

  // application_layer_protocol_negotiation: the first and the last character of the first protocol.
  const alpn = extension(0x0010);
  const protocol = alpn && alpn.length > 3 ? alpn.subarray(3, 3 + alpn[2]) : new Uint8Array();
  const first = protocol[0];
  const last = protocol[protocol.length - 1];
  const alpnCharacters = !protocol.length
    ? "00"
    : isAlphanumeric(first) && isAlphanumeric(last)
      ? String.fromCharCode(first, last)
      : (first >> 4).toString(16) + (last & 0x0f).toString(16);

  const a =
    transport +
    (versions[version] ?? "00") +
    (extension(0x0000) ? "d" : "i") + // server_name
    count(ciphers) +
    count(types) +
    alpnCharacters;
  const b = hash(ciphers.map(hex4).sort().join(","));
  const sorted = types
    .filter(type => type !== 0x0000 && type !== 0x0010)
    .map(hex4)
    .sort()
    .join(",");
  const c = hash(
    sorted && signatureAlgorithms.length ? `${sorted}_${signatureAlgorithms.map(hex4).join(",")}` : sorted,
  );
  return `${a}_${b}_${c}`;
}

/** A ClientHello body with these cipher suites and extensions, in this order. */
function buildClientHello(cipherSuites: number[], extensions: [type: number, data: number[]][]) {
  const u16 = (value: number) => [value >> 8, value & 0xff];
  const extensionBytes = extensions.flatMap(([type, data]) => [...u16(type), ...u16(data.length), ...data]);
  return Uint8Array.from([
    ...[0x03, 0x03], // legacy_version
    ...new Array(32).fill(0x11), // random
    ...[4, 1, 2, 3, 4], // legacy_session_id
    ...u16(cipherSuites.length * 2),
    ...cipherSuites.flatMap(u16),
    ...[1, 0], // legacy_compression_methods
    ...u16(extensionBytes.length),
    ...extensionBytes,
  ]);
}

/** What the handlers answer with: the ClientHello in hex, or null. */
const hex = (hello: { raw: Uint8Array } | null) => hello && Buffer.from(hello.raw).toString("hex");
const describeHello = (hexHello: string) => {
  const { legacyVersion, cipherSuites, extensions } = parseClientHello(Buffer.from(hexHello, "hex"));
  const extension = (type: number) => {
    const found = extensions.find(e => e.type === type);
    return found ? Buffer.from(found.data).toString("latin1") : undefined;
  };
  return { legacyVersion, cipherSuites, types: extensions.map(e => e.type), extension };
};

function handler(req: Request, server: Server<undefined>) {
  if (new URL(req.url).pathname !== "/async") return Response.json(hex(server.clientHello(req)));
  return new Promise<void>(resolve => setImmediate(resolve)).then(() => Response.json(hex(server.clientHello(req))));
}

/** A TCP proxy in front of `port` that keeps every byte its client sent. */
async function recordingProxy(port: number) {
  const sent: Buffer[] = [];
  const sockets: net.Socket[] = [];
  const proxy = net.createServer(client => {
    const upstream = net.connect(port, "127.0.0.1");
    sockets.push(client, upstream);
    client.on("data", chunk => {
      sent.push(chunk);
      upstream.write(chunk);
    });
    upstream.on("data", chunk => client.write(chunk));
    client.on("error", () => {}).on("close", () => upstream.destroy());
    upstream.on("error", () => {}).on("close", () => client.destroy());
  });
  await once(proxy.listen(0, "127.0.0.1"), "listening");
  return {
    port: (proxy.address() as AddressInfo).port,
    /** The body of the ClientHello in the client's byte stream: no record headers, no handshake header. */
    clientHello() {
      const stream = Buffer.concat(sent);
      let handshake = Buffer.alloc(0);
      for (let offset = 0; offset + 5 <= stream.length && stream[offset] === 22;) {
        const length = stream.readUInt16BE(offset + 3);
        handshake = Buffer.concat([handshake, stream.subarray(offset + 5, offset + 5 + length)]);
        offset += 5 + length;
        if (handshake.length >= 4 && handshake.length >= 4 + handshake.readUIntBE(1, 3)) break;
      }
      expect(handshake[0]).toBe(1);
      return handshake.subarray(4, 4 + handshake.readUIntBE(1, 3)).toString("hex");
    },
    [Symbol.dispose]() {
      for (const socket of sockets) socket.destroy();
      proxy.close();
    },
  };
}

/** One GET on an open connection. Resolves with the JSON body once `content-length` bytes of it arrived. */
function get(socket: tls.TLSSocket, path: string): Promise<any> {
  const { promise, resolve, reject } = Promise.withResolvers<any>();
  let text = "";
  const onData = (chunk: Buffer) => {
    text += chunk.toString("latin1");
    const end = text.indexOf("\r\n\r\n");
    if (end === -1) return;
    const length = Number(/\r\ncontent-length: (\d+)/i.exec(text.slice(0, end))?.[1]);
    if (text.length < end + 4 + length) return;
    socket.off("data", onData);
    resolve(JSON.parse(text.slice(end + 4, end + 4 + length)));
  };
  socket.on("data", onData);
  socket.once("error", reject);
  socket.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\n\r\n`);
  return promise;
}

async function connectTLS(options: tls.ConnectionOptions) {
  const socket = tls.connect({ rejectUnauthorized: false, ALPNProtocols: ["http/1.1"], ...options });
  await once(socket, "secureConnect");
  return socket;
}

describe("server.clientHello", () => {
  test("HTTP/1.1: raw is the ClientHello the client sent, for every request on the connection", async () => {
    await using server = Bun.serve({ port: 0, tls: { ...tlsCert, clientHello: true }, fetch: handler });
    using proxy = await recordingProxy(server.port!);

    const socket = await connectTLS({ host: "127.0.0.1", port: proxy.port, servername: "localhost" });
    const first = await get(socket, "/");
    const afterAwait = await get(socket, "/async");
    socket.destroy();

    expect(first).toBe(proxy.clientHello());
    expect(afterAwait).toBe(first);

    const hello = describeHello(first);
    expect(hello.legacyVersion).toBe(0x0303);
    expect(hello.cipherSuites.length).toBeGreaterThan(0);
    expect(hello.extension(SERVER_NAME)).toEndWith("localhost");
    expect(hello.extension(ALPN)).toEndWith("http/1.1");

    // The bytes belong to the connection: the next one has its own `random`.
    const second = await connectTLS({ host: "127.0.0.1", port: server.port!, servername: "localhost" });
    const other = await get(second, "/");
    second.destroy();
    expect(other).not.toBe(first);
    expect(describeHello(other).types).toEqual(hello.types);
  });

  test("HTTP/2: every stream of a connection gets the ClientHello the client sent", async () => {
    await using server = Bun.serve({ port: 0, http2: true, tls: { ...tlsCert, clientHello: true }, fetch: handler });
    using proxy = await recordingProxy(server.port!);

    const session = await connectH2(proxy.port, true);
    const [first, second] = await Promise.all([
      request(session, { ":path": "/" }),
      request(session, { ":path": "/async" }),
    ]);
    await new Promise<void>(resolve => session.close(() => resolve()));

    const hello = JSON.parse(first.body.toString());
    expect(hello).toBe(proxy.clientHello());
    expect(JSON.parse(second.body.toString())).toBe(hello);
    expect(describeHello(hello).extension(ALPN)).toContain("h2");
  });

  test("HTTP/3: requests after the handshake get the ClientHello of the QUIC connection", async () => {
    await using server = Bun.serve({ port: 0, http3: true, tls: { ...tlsCert, clientHello: true }, fetch: handler });
    const h3 = (path: string) =>
      fetch(`https://127.0.0.1:${server.port}${path}`, {
        protocol: "http3",
        tls: { rejectUnauthorized: false },
      } as RequestInit).then(res => res.json());

    // lsquic frees its SSL once the handshake is done, so the second request
    // reads the copy that the connection kept.
    const first = await h3("/");
    const second = await h3("/async");
    expect(first).toBeString();
    expect(second).toBe(first);

    const hello = describeHello(first);
    expect(hello.legacyVersion).toBe(0x0303);
    expect(hello.types).toContain(QUIC_TRANSPORT_PARAMETERS);
    expect(hello.extension(ALPN)).toContain("h3");

    // The TCP listener of the same server keeps its own connections' ClientHello.
    const overTCP = await fetch(server.url, { tls: { rejectUnauthorized: false } }).then(res => res.json());
    expect(describeHello(overTCP).types).not.toContain(QUIC_TRANSPORT_PARAMETERS);
  });

  test("null without the option, without TLS, for a Request of no connection, and after the response", async () => {
    let seen: Request | undefined;
    const fetchHandler = (req: Request, server: Server<undefined>) => {
      seen = req;
      return Response.json(hex(server.clientHello(req)));
    };

    await using off = Bun.serve({ port: 0, tls: tlsCert, fetch: fetchHandler });
    expect(await fetch(off.url, { tls: { rejectUnauthorized: false } }).then(res => res.json())).toBeNull();

    await using plain = Bun.serve({ port: 0, fetch: fetchHandler });
    expect(await fetch(plain.url).then(res => res.json())).toBeNull();

    // `clientHello` is an option of the `tls` object. Beside a top-level certificate it is not an option.
    // @ts-expect-error
    await using topLevel = Bun.serve({ port: 0, ...tlsCert, clientHello: true, fetch: fetchHandler });
    expect(topLevel.url.protocol).toBe("https:");
    expect(await fetch(topLevel.url, { tls: { rejectUnauthorized: false } }).then(res => res.json())).toBeNull();

    await using on = Bun.serve({ port: 0, tls: { ...tlsCert, clientHello: true }, fetch: fetchHandler });
    expect(await fetch(on.url, { tls: { rejectUnauthorized: false } }).then(res => res.json())).toBeString();
    expect(on.clientHello(seen!)).toBeNull();
    expect(on.clientHello(new Request(on.url))).toBeNull();
    // @ts-expect-error
    expect(() => on.clientHello({})).toThrow("Expected Request object");
    // @ts-expect-error
    expect(() => on.clientHello()).toThrow("Expected Request object");
  });

  test("the result is a new { raw: Uint8Array } for each call", async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    await using server = Bun.serve({
      port: 0,
      tls: { ...tlsCert, clientHello: true },
      fetch(req, server) {
        const first = server.clientHello(req)!;
        const second = server.clientHello(req)!;
        expect(Object.keys(first)).toEqual(["raw"]);
        expect(first.raw).toBeInstanceOf(Uint8Array);
        expect(first.raw).not.toBeInstanceOf(Buffer);
        expect(second.raw).not.toBe(first.raw);
        first.raw.fill(0);
        expect(second.raw).toEqual(server.clientHello(req)!.raw);
        expect(second.raw[0]).toBe(3);
        resolve();
        return new Response("ok");
      },
    });
    expect(await fetch(server.url, { tls: { rejectUnauthorized: false } }).then(res => res.text())).toBe("ok");
    await promise;
  });

  test("tls array: the option of the first entry covers every serverName, over TCP and QUIC", async () => {
    await using server = Bun.serve({
      port: 0,
      http3: true,
      tls: [
        { ...tlsCert, clientHello: true },
        { ...tlsCert, serverName: "other.example" },
        { ...tlsCert, serverName: "localhost" },
      ],
      fetch: handler,
    });
    const socket = await connectTLS({ host: "127.0.0.1", port: server.port!, servername: "other.example" });
    const overTCP = await get(socket, "/");
    socket.destroy();
    expect(describeHello(overTCP).extension(SERVER_NAME)).toEndWith("other.example");

    const overQUIC = await fetch(`https://localhost:${server.port}/`, {
      protocol: "http3",
      tls: { rejectUnauthorized: false },
    } as RequestInit).then(res => res.json());
    expect(describeHello(overQUIC).types).toContain(QUIC_TRANSPORT_PARAMETERS);
    expect(describeHello(overQUIC).extension(SERVER_NAME)).toEndWith("localhost");
  });

  test("the option is a boolean of the tls object that has the default certificate", () => {
    const serve = (tls: unknown) => {
      // @ts-expect-error
      using server = Bun.serve({ port: 0, tls, fetch: () => new Response() });
      return server.url.protocol;
    };
    for (const clientHello of ["yes", "false", 1, 0, null, {}]) {
      expect(() => serve({ ...tlsCert, clientHello })).toThrow('The "clientHello" property must be of type boolean');
    }
    expect(serve({ ...tlsCert, clientHello: false })).toBe("https:");
    expect(serve({ ...tlsCert, clientHello: undefined })).toBe("https:");

    // The listener reads the ClientHello before it knows the serverName, so a later entry cannot set the option.
    for (const clientHello of [true, false]) {
      expect(() => serve([tlsCert, { ...tlsCert, serverName: "other.example", clientHello }])).toThrow(
        "tls.clientHello applies to every serverName. Set it on the first tls object",
      );
    }

    // A `tls` object with no certificate makes a plain HTTP server, which has no ClientHello.
    const needsTLS = 'tls.clientHello needs a TLS server. Set "cert" and "key" in the same tls object';
    expect(() => serve({ clientHello: true })).toThrow(needsTLS);
    expect(() => serve([{ clientHello: true }, tlsCert])).toThrow(needsTLS);
    expect(serve({ clientHello: false })).toBe("http:");
  });

  test("a server without the option keeps nothing when it shares its certificate with a server that has it", async () => {
    // Servers with the same TLS options share one SSL_CTX, and with it the callback that reads the ClientHello.
    await using off = Bun.serve({ port: 0, tls: tlsCert, fetch: handler });
    await using on = Bun.serve({ port: 0, tls: { ...tlsCert, clientHello: true }, fetch: handler });
    const ask = async (server: Server<undefined>) => {
      const socket = await connectTLS({ host: "127.0.0.1", port: server.port!, servername: "localhost" });
      const hello = await get(socket, "/");
      socket.destroy();
      return typeof hello;
    };
    expect([await ask(off), await ask(on), await ask(off), await ask(on)]).toEqual([
      "object", // null
      "string",
      "object",
      "string",
    ]);
  });

  test("a reload keeps the option, and another server object reads the same connection", async () => {
    await using other = Bun.serve({ port: 0, fetch: () => new Response() });
    await using server = Bun.serve({ port: 0, tls: { ...tlsCert, clientHello: true }, fetch: handler });
    server.reload({
      fetch: (req, server) => Response.json([hex(server.clientHello(req)), hex(other.clientHello(req))]),
    });

    const [own, fromOther] = await fetch(server.url, { tls: { rejectUnauthorized: false } }).then(res => res.json());
    expect(own).toBeString();
    expect(fromOther).toBe(own);
  });

  test("TLS over a unix socket", async () => {
    using dir = tempDir("serve-client-hello", {});
    const unix = join(String(dir), "tls.sock");
    await using server = Bun.serve({ unix, tls: { ...tlsCert, clientHello: true }, fetch: handler });

    const { promise, resolve, reject } = Promise.withResolvers<string>();
    let text = "";
    await using socket = await Bun.connect({
      unix,
      tls: { rejectUnauthorized: false, serverName: "localhost" },
      socket: {
        open: socket => void socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"),
        data: (_, chunk) => void (text += chunk.toString("latin1")),
        close: () => resolve(text),
        error: (_, error) => reject(error),
      },
    });
    const hello = JSON.parse((await promise).split("\r\n\r\n")[1]);
    expect(describeHello(hello).extension(SERVER_NAME)).toEndWith("localhost");
  });

  test("the JA4 function of the documentation", async () => {
    // The example of the JA4 specification, with a GREASE value added to each list.
    const u16 = (value: number) => [value >> 8, value & 0xff];
    const signatureAlgorithms = [0x0403, 0x0804, 0x0401, 0x0503, 0x0805, 0x0501, 0x0806, 0x0601];
    const data: Record<number, number[]> = {
      [SERVER_NAME]: [0, 14, 0, 0, 11, ...Buffer.from("example.com")],
      [ALPN]: [0, 12, 2, ...Buffer.from("h2"), 8, ...Buffer.from("http/1.1")],
      0x002b: [6, ...u16(0x2a2a), ...u16(0x0304), ...u16(0x0303)],
      0x000d: [...u16(2 + signatureAlgorithms.length * 2), ...u16(0x3a3a), ...signatureAlgorithms.flatMap(u16)],
    };
    const example = buildClientHello(
      [
        0x0a0a, 0x1301, 0x1302, 0x1303, 0xc02b, 0xc02f, 0xc02c, 0xc030, 0xcca9, 0xcca8, 0xc013, 0xc014, 0x009c, 0x009d,
        0x002f, 0x0035,
      ],
      [
        0x1a1a, 0x001b, 0x0000, 0x0033, 0x0010, 0x4469, 0x0017, 0x002d, 0x000d, 0x0005, 0x0023, 0x0012, 0x002b, 0xff01,
        0x000b, 0x000a, 0x0015,
      ].map(type => [type, data[type] ?? []]),
    );
    expect(ja4(example, "t")).toBe("t13d1516h2_8daaf6152771_e5627efa2ab1");
    // No extensions, and a first ALPN name that is not alphanumeric.
    expect(ja4(buildClientHello([0x1301], []), "q")).toBe("q12i010000_0f2cb44170f4_000000000000");
    expect(ja4(buildClientHello([0x1301], [[ALPN, [0, 3, 2, 0xab, 0xcd]]]), "t")).toStartWith("t12i0101ad_");

    await using server = Bun.serve({
      port: 0,
      http3: true,
      tls: { ...tlsCert, clientHello: true },
      fetch: (req, server) => {
        const { raw } = server.clientHello(req)!;
        const overQuic = parseClientHello(raw).extensions.some(e => e.type === QUIC_TRANSPORT_PARAMETERS);
        return new Response(ja4(raw, overQuic ? "q" : "t"));
      },
    });
    const socket = await connectTLS({ host: "127.0.0.1", port: server.port!, servername: "localhost" });
    const overTCP = await new Promise<string>((resolve, reject) => {
      let text = "";
      socket.on("data", chunk => (text += chunk)).on("close", () => resolve(text.split("\r\n\r\n")[1]));
      socket.on("error", reject);
      socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    });
    expect(overTCP).toMatch(/^t13d\d{4}h1_[0-9a-f]{12}_[0-9a-f]{12}$/);

    const overQUIC = await fetch(`https://127.0.0.1:${server.port}/`, {
      protocol: "http3",
      tls: { rejectUnauthorized: false },
    } as RequestInit).then(res => res.text());
    expect(overQUIC).toMatch(/^q13[di]\d{4}h3_[0-9a-f]{12}_[0-9a-f]{12}$/);
  });

  // The copy lives as long as the connection. HTTP/1.1 and HTTP/2 share its owner, the TLS state of
  // the socket. RSS cannot show the 1.5 KB of a QUIC connection, so HTTP/3 is not part of this test.
  test(
    "the ClientHello is freed with its connection",
    async () => {
      // The fixture's server measures itself over 2000 connections with a ClientHello of 13 KB each.
      // Copies that are not freed add 25 MiB. Without a leak the debug build measured 1.7 to 5.1 MiB.
      const fixture = join(import.meta.dir, "serve-client-hello-leak-fixture.ts");
      await expectRssDeltaBelow([fixture, "2000"], { release: 12, debug: 12 });
    },
    isASAN || isDebug ? 120_000 : 30_000,
  );
});
