import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, expiredTls, isWindows, tempDir, tls as tlsCert } from "harness";
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
});

describe("keyFile / certFile / caFile / dhParamsFile", () => {
  const keysFixtures = join(import.meta.dir, "..", "..", "node", "test", "fixtures", "keys");

  test("relative paths resolve against the cwd and non-ASCII paths load", async () => {
    // The directory name is not ASCII: the files are opened from Rust with a
    // wide open on Windows, not by BoringSSL's narrow fopen.
    using dir = tempDir("bun-serve-ssl-ünïcødé", {
      "key.pem": tlsCert.key,
      "cert.pem": tlsCert.cert,
      "dh.pem": readFileSync(join(keysFixtures, "dh2048.pem"), "utf8"),
      "server.ts": `
        import { join } from "node:path";
        const server = Bun.serve({
          port: 0,
          hostname: "127.0.0.1",
          tls: { keyFile: "key.pem", certFile: join(process.cwd(), "cert.pem"), dhParamsFile: "dh.pem" },
          fetch: () => new Response("TLS-OK"),
        });
        const res = await fetch(server.url, { tls: { caFile: "cert.pem" } });
        console.log(await res.text());
        server.stop(true);
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "server.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("TLS-OK\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("a missing file is rejected when the options are parsed", () => {
    using dir = tempDir("bun-serve-ssl-missing", { "cert.pem": tlsCert.cert });
    expect(() => {
      Bun.serve({
        port: 0,
        tls: { keyFile: join(String(dir), "missing.pem"), certFile: join(String(dir), "cert.pem") },
        fetch: () => new Response("unreachable"),
      });
    }).toThrow("Unable to access keyFile path");
  });

  test("a malformed dhParamsFile is rejected by the PEM parser", () => {
    using dir = tempDir("bun-serve-ssl-dh-malformed", { "key.pem": tlsCert.key, "cert.pem": tlsCert.cert });
    expect(() => {
      Bun.serve({
        port: 0,
        tls: {
          keyFile: join(String(dir), "key.pem"),
          certFile: join(String(dir), "cert.pem"),
          dhParamsFile: join(keysFixtures, "dherror.pem"),
        },
        fetch: () => new Response("unreachable"),
      });
    }).toThrow(expect.objectContaining({ code: "ERR_OSSL_PEM_BAD_BASE64_DECODE" }));
  });

  // A directory passes the parse-time access() probe and fails when the file
  // is read for the SSL_CTX.
  test("a file that cannot be read reports which option failed", () => {
    using dir = tempDir("bun-serve-ssl-unreadable", {
      "key.pem": tlsCert.key,
      "cert.pem": tlsCert.cert,
      "a-directory/.keep": "",
    });
    const keyFile = join(String(dir), "key.pem");
    const certFile = join(String(dir), "cert.pem");
    const directory = join(String(dir), "a-directory");

    expect(() => {
      Bun.serve({ port: 0, tls: { keyFile: directory, certFile }, fetch: () => new Response("unreachable") });
    }).toThrow(expect.objectContaining({ code: "EISDIR", message: expect.stringContaining(directory) }));

    const listenWith = (tls: Record<string, string>) => () => {
      Bun.listen({ hostname: "127.0.0.1", port: 0, tls, socket: { data() {} } });
    };
    expect(listenWith({ keyFile: directory, certFile })).toThrow("Failed to load key file");
    expect(listenWith({ keyFile, certFile: directory })).toThrow("Failed to load certificate file");
    expect(listenWith({ keyFile, certFile, caFile: directory })).toThrow("Failed to load CA file");
    expect(listenWith({ keyFile, certFile, dhParamsFile: directory })).toThrow("Failed to load DH params file");
  });

  test("caFile loads the file the way ca loads its bytes", async () => {
    using server = Bun.serve({ port: 0, hostname: "127.0.0.1", tls: tlsCert, fetch: () => new Response("OK") });
    const crl = readFileSync(join(keysFixtures, "ca2-crl.pem"), "utf8");
    using dir = tempDir("bun-serve-ssl-cafile-pem", {
      "trusts-server.pem": tlsCert.cert,
      "other-ca.pem": expiredTls.cert,
      "with-crl.pem": `${tlsCert.cert}\n${crl}`,
      "corrupt-second.pem": `${tlsCert.cert}\n-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n`,
      "no-certificate.pem": tlsCert.key,
    });
    const attempt = async (tls: Record<string, string>) => {
      try {
        const res = await fetch(server.url, { keepalive: false, tls });
        return await res.text();
      } catch (error) {
        return (error as { code: string }).code;
      }
    };
    const outcomes: Record<string, { caFile: string; ca: string }> = {};
    for (const name of [
      "trusts-server.pem",
      "other-ca.pem",
      "with-crl.pem",
      "corrupt-second.pem",
      "no-certificate.pem",
    ]) {
      const path = join(String(dir), name);
      outcomes[name] = {
        caFile: await attempt({ caFile: path }),
        ca: await attempt({ ca: readFileSync(path, "utf8") }),
      };
    }
    expect(outcomes).toEqual({
      "trusts-server.pem": { caFile: "OK", ca: "OK" },
      "other-ca.pem": { caFile: "DEPTH_ZERO_SELF_SIGNED_CERT", ca: "DEPTH_ZERO_SELF_SIGNED_CERT" },
      "with-crl.pem": { caFile: "OK", ca: "OK" },
      "corrupt-second.pem": { caFile: "OK", ca: "OK" },
      "no-certificate.pem": { caFile: "DEPTH_ZERO_SELF_SIGNED_CERT", ca: "DEPTH_ZERO_SELF_SIGNED_CERT" },
    });
  });

  test("serverName entries load their file options too", async () => {
    using dir = tempDir("bun-serve-ssl-sni-files", {
      "key.pem": tlsCert.key,
      "cert.pem": tlsCert.cert,
      "a-directory/.keep": "",
    });
    const keyFile = join(String(dir), "key.pem");
    const certFile = join(String(dir), "cert.pem");
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls: [
        { keyFile, certFile },
        { serverName: "localhost", keyFile, certFile },
      ],
      fetch: () => new Response("SNI-OK"),
    });
    const res = await fetch(`https://localhost:${server.port}/`, { keepalive: false, tls: { caFile: certFile } });
    expect(await res.text()).toBe("SNI-OK");

    const directory = join(String(dir), "a-directory");
    expect(() => {
      Bun.serve({
        port: 0,
        tls: [
          { keyFile, certFile },
          { serverName: "localhost", keyFile: directory, certFile },
        ],
        fetch: () => new Response("unreachable"),
      });
    }).toThrow(expect.objectContaining({ code: "EISDIR", message: expect.stringContaining(directory) }));
  });

  test.skipIf(isWindows)("a FIFO works as a file option", async () => {
    // The file is read with a cursor read(2) loop, as BoringSSL's fopen did, so
    // a non-seekable file works.
    using dir = tempDir("bun-serve-ssl-fifo", { "key.pem": tlsCert.key, "cert.pem": tlsCert.cert });
    expect(Bun.spawnSync({ cmd: ["mkfifo", "key.fifo"], cwd: String(dir) }).exitCode).toBe(0);
    // The writer blocks in open(2) until the server opens the FIFO for reading.
    await using writer = Bun.spawn({ cmd: ["sh", "-c", "cat key.pem > key.fifo"], cwd: String(dir) });
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const server = Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            tls: { keyFile: "key.fifo", certFile: "cert.pem" },
            fetch: () => new Response("FIFO-OK"),
          });
          const res = await fetch(server.url, { tls: { caFile: "cert.pem" } });
          console.log(await res.text());
          server.stop(true);
        `,
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("FIFO-OK\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(await writer.exited).toBe(0);
  });
});
