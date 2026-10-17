// This test ensures that when a TLS connection is established, the server
// selects the most recently added SecureContext that matches the servername.

import { describe, expect, it } from "bun:test";

import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import crypto, { X509Certificate } from "node:crypto";
import { once } from "node:events";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import http2 from "node:http2";
import net, { AddressInfo } from "node:net";
import { join } from "node:path";
import { Duplex } from "node:stream";
import tls from "node:tls";

function loadPEM(filename: string) {
  return readFileSync(join(import.meta.dir, "fixtures", filename)).toString();
}

const agent1Cert = loadPEM("agent1-cert.pem");
const agent1Key = loadPEM("agent1-key.pem");

const agent2Cert = loadPEM("agent2-cert.pem");
const agent2Key = loadPEM("agent2-key.pem");

const agent3Cert = loadPEM("agent3-cert.pem");
const agent3Key = loadPEM("agent3-key.pem");

const agent6Cert = loadPEM("agent6-cert.pem");
const agent6Key = loadPEM("agent6-key.pem");

const ca1 = loadPEM("ca1-cert.pem");
const ca2 = loadPEM("ca2-cert.pem");

const SNIContexts = {
  "a.example.com": {
    key: agent1Key,
    cert: agent1Cert,
  },
  "asterisk.test.com": {
    key: agent3Key,
    cert: agent3Cert,
  },
  "chain.example.com": {
    key: agent6Key,
    // NOTE: Contains ca3 chain cert
    cert: agent6Cert,
  },
};

const serverOptions = {
  key: agent2Key,
  cert: agent2Cert,
  requestCert: true,
  rejectUnauthorized: false,
};

const badSecureContext = {
  key: agent1Key,
  cert: agent1Cert,
  ca: [ca2],
};

const goodSecureContext = {
  key: agent1Key,
  cert: agent1Cert,
  ca: [ca1],
};

describe("tls.Server", () => {
  it("addContext", async () => {
    const serverOptions = {
      key: agent2Key,
      cert: agent2Cert,
      ca: [ca2],
      requestCert: true,
      rejectUnauthorized: false,
    };

    let connections = 0;
    const { promise, resolve, reject } = Promise.withResolvers();
    let listening_server: tls.Server | null = null;
    try {
      listening_server = tls.createServer(serverOptions, async c => {
        try {
          if (++connections === 3) {
            resolve();
          }
          //@ts-ignore
          if (c.servername === "unknowncontext") {
            expect(c.authorized).toBe(false);
            return;
          }
          expect(c.authorized).toBe(true);
        } catch (e) {
          reject(e);
        }
      });
      const server = listening_server as tls.Server;

      const secureContext = {
        key: agent1Key,
        cert: agent1Cert,
        ca: [ca1],
      };
      server.addContext("context1", secureContext);
      //@ts-ignore
      server.addContext("context2", tls.createSecureContext(secureContext));

      const clientOptionsBase = {
        key: agent1Key,
        cert: agent1Cert,
        ca: [ca1],
        rejectUnauthorized: false,
      };

      function connect(servername: string) {
        return new Promise<void>((resolve, reject) => {
          const client = tls.connect(
            {
              ...clientOptionsBase,
              port: (server.address() as AddressInfo).port,
              host: "127.0.0.1",
              servername,
            },
            () => {
              client.end();
              resolve();
            },
          );
          client.on("error", reject);
        });
      }

      server.listen(0, async () => {
        await connect("context1");
        await connect("context2");
        await connect("unknowncontext");
      });
      await promise;
    } finally {
      listening_server?.close();
    }
  });

  it("should select the most recently added SecureContext", async () => {
    let listening_server: tls.Server | null = null;
    const { promise, resolve, reject } = Promise.withResolvers();
    try {
      const timeout = setTimeout(() => {
        reject("timeout");
      }, 3000);
      listening_server = tls.createServer(serverOptions, c => {
        try {
          // The 'a' and 'b' subdomains are used to distinguish between client
          // connections.
          // Connection to subdomain 'a' is made when the 'bad' secure context is
          // the only one in use.
          //@ts-ignore
          if ("a.example.com" === c.servername) {
            expect(c.authorized).toBe(false);
          }
          // Connection to subdomain 'b' is made after the 'good' context has been
          // added.
          //@ts-ignore
          if ("b.example.com" === c.servername) {
            expect(c.authorized).toBe(true);
            clearTimeout(timeout);
            resolve();
          }
        } catch (e) {
          clearTimeout(timeout);
          reject(e);
        }
      });
      const server = listening_server as tls.Server;
      // 1. Add the 'bad' secure context. A connection using this context will not be
      // authorized.
      server.addContext("*.example.com", badSecureContext);

      server.listen(0, () => {
        const options = {
          port: (server?.address() as AddressInfo).port,
          host: "127.0.0.1",
          key: agent1Key,
          cert: agent1Cert,
          ca: [ca1],
          servername: "a.example.com",
          rejectUnauthorized: false,
        };

        // 2. Make a connection using servername 'a.example.com'. Since a 'bad'
        // secure context is used, this connection should not be authorized.
        const client = tls.connect(options, () => {
          client.end();
        });

        client.on("close", () => {
          // 3. Add a 'good' secure context.
          server.addContext("*.example.com", goodSecureContext);

          options.servername = "b.example.com";
          // 4. Make a connection using servername 'b.example.com'. This connection
          // should be authorized because the 'good' secure context is the most
          // recently added matching context.

          const other = tls.connect(options, () => {
            other.end();
          });

          other.on("close", () => {
            // 5. Make another connection using servername 'b.example.com' to ensure
            // that the array of secure contexts is not reversed in place with each
            // SNICallback call, as someone might be tempted to refactor this piece of
            // code by using Array.prototype.reverse() method.
            const onemore = tls.connect(options, () => {
              onemore.end();
            });

            onemore.on("close", () => {
              server.close();
            });
            onemore.on("error", reject);
          });

          other.on("error", reject);
        });
        client.on("error", reject);
      });
      server.on("error", reject);
      server.on("clientError", reject);

      await promise;
    } finally {
      listening_server?.close();
    }
  });

  function testCA(ca: Array<string>) {
    const { promise, resolve, reject } = Promise.withResolvers();
    const server = tls.createServer({ ca, cert: agent3Cert, key: agent3Key });

    server.addContext("agent3", { ca, cert: agent3Cert, key: agent3Key });
    server.listen(0, "127.0.0.1", () => {
      const options = {
        servername: "agent3",
        host: "127.0.0.1",
        port: (server.address() as AddressInfo).port,
        ca,
      };
      var authorized = false;
      const socket = tls.connect(options, () => {
        authorized = socket.authorized;
        socket.end();
      });

      socket.on("error", reject);
      socket.on("close", () => {
        server.close(() => {
          resolve(authorized);
        });
      });
    });
    return promise;
  }
  it("should allow multiple CA", async () => {
    // Verify that multiple CA certificates can be provided, and that for
    // convenience that can also be in newline-separated strings.
    expect(await testCA([ca1, ca2])).toBeTrue();
  });

  it("should allow multiple CA in newline-separated strings", async () => {
    expect(await testCA([ca2 + "\n" + ca1])).toBeTrue();
  });

  function testClient(options: any, clientResult: boolean, serverResult: string) {
    const { promise, resolve, reject } = Promise.withResolvers();
    const server = tls.createServer(serverOptions, c => {
      try {
        //@ts-ignore
        expect(c.servername).toBe(serverResult);
        expect(c.authorized).toBe(false);
      } catch (e) {
        reject(e);
      }
    });

    server.addContext("a.example.com", SNIContexts["a.example.com"]);
    server.addContext("*.test.com", SNIContexts["asterisk.test.com"]);
    server.addContext("chain.example.com", SNIContexts["chain.example.com"]);

    server.on("tlsClientError", reject);

    server.listen(0, () => {
      const client = tls.connect(
        {
          ...options,
          port: (server.address() as AddressInfo).port,
          host: "127.0.0.1",
          rejectUnauthorized: false,
        },
        () => {
          const result =
            //@ts-ignore
            client.authorizationError && client.authorizationError.indexOf("ERR_TLS_CERT_ALTNAME_INVALID") !== -1;
          if (result !== clientResult) {
            reject(new Error(`Expected ${clientResult}, got ${result} in ${options.servername}`));
          } else {
            resolve();
          }
          client.end();
        },
      );
      client.on("error", reject);
      client.on("close", () => {
        server.close();
      });
    });
    return promise;
  }
  it("SNI tls.Server + tls.connect", async () => {
    await testClient(
      {
        ca: [ca1],
        servername: "a.example.com",
      },
      true,
      "a.example.com",
    );
    await testClient(
      {
        ca: [ca2],
        servername: "b.test.com",
      },
      true,
      "b.test.com",
    );
    await testClient(
      {
        ca: [ca2],
        servername: "a.b.test.com",
      },
      false,
      "a.b.test.com",
    );
    await testClient(
      {
        ca: [ca1],
        servername: "c.wrong.com",
      },
      false,
      "c.wrong.com",
    );
    await testClient(
      {
        ca: [ca1],
        servername: "chain.example.com",
      },
      true,
      "chain.example.com",
    );
  });

  // server.close() keeps the connections it already accepted. One that starts
  // its handshake afterwards still selects its context by server name.
  describe.each(["addContext", "SNICallback"] as const)("a handshake that starts after close() resolves %s", mode => {
    it("like one that starts before it", async () => {
      // agent1 chains to ca1, the client's agent3 to ca2: the default context
      // authorizes the client, the a.example.com context does not.
      const tenant = { key: agent1Key, cert: agent1Cert, ca: [ca1] };
      const names: string[] = [];
      const server = tls.createServer(
        {
          key: agent2Key,
          cert: agent2Cert,
          ca: [ca2],
          requestCert: true,
          rejectUnauthorized: false,
          SNICallback:
            mode === "SNICallback"
              ? (name, cb) => {
                  names.push(name);
                  if (name === "a.example.com") cb(null, tls.createSecureContext(tenant));
                  else cb(new Error("unknown tenant"));
                }
              : undefined,
        },
        socket => {
          socket.on("error", () => {});
          //@ts-ignore
          socket.end(`${socket.servername} authorized=${socket.authorized}`);
        },
      );
      server.on("tlsClientError", () => {});
      if (mode === "addContext") server.addContext("a.example.com", tenant);

      const servernames = ["a.example.com", "a.example.com", "a.example.com", "unknown.example.com"];
      let accepted = 0;
      const allAccepted = Promise.withResolvers<void>();
      server.on("connection", () => {
        if (++accepted === servernames.length) allAccepted.resolve();
      });
      server.on("error", allAccepted.reject);
      const raws: net.Socket[] = [];
      try {
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const port = (server.address() as AddressInfo).port;
        for (const _ of servernames) raws.push(net.connect({ host: "127.0.0.1", port }));
        for (const raw of raws) raw.on("error", () => {});
        await Promise.all(raws.map(raw => once(raw, "connect")));
        await allAccepted.promise;

        // No TLS byte has been sent yet.
        server.close();

        const outcomes = await Promise.all(
          raws.map((raw, i) => {
            const { promise, resolve } = Promise.withResolvers<{ certificate: string; received: string }>();
            let certificate = "no handshake";
            let received = "";
            const socket = tls.connect(
              { socket: raw, servername: servernames[i], rejectUnauthorized: false, key: agent3Key, cert: agent3Cert },
              () => (certificate = socket.getPeerCertificate().subject.CN as string),
            );
            socket.on("data", chunk => (received += chunk));
            socket.on("error", () => {});
            socket.on("close", () => resolve({ certificate, received }));
            return promise;
          }),
        );

        const tenantOutcome = { certificate: "agent1", received: "a.example.com authorized=false" };
        expect(outcomes.slice(0, 3)).toEqual([tenantOutcome, tenantOutcome, tenantOutcome]);
        if (mode === "SNICallback") {
          // The callback is the allow-list: a name it rejects gets no session.
          expect(outcomes[3]).toEqual({ certificate: "no handshake", received: "" });
          expect(names.toSorted()).toEqual(servernames.toSorted());
        } else {
          expect(outcomes[3].certificate).toBe("agent2");
        }
      } finally {
        if (server.listening) server.close();
        for (const raw of raws) raw.destroy();
      }
    });
  });
});

// Node builds the context in the constructor and in setSecureContext(), and listen() reads no option again:
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1520
describe("a server reads its TLS options when they are given, and never again", () => {
  const fixture = (name: string) => readFileSync(join(import.meta.dir, "..", "test", "fixtures", "keys", name), "utf8");
  const agent1 = { key: fixture("agent1-key.pem"), cert: fixture("agent1-cert.pem") }; // issued by ca1
  const agent3 = { key: fixture("agent3-key.pem"), cert: fixture("agent3-cert.pem") }; // issued by ca2
  const ca1 = fixture("ca1-cert.pem");

  // The common name of the certificate that `server`, listening from here on, presents.
  async function presented(server: tls.Server) {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    const client = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
    try {
      await once(client, "secureConnect");
      return client.getPeerCertificate().subject.CN;
    } finally {
      client.destroy();
    }
  }

  // Each changes, after the server exists, what its options named.
  type Change = { options: object; change(server: tls.Server): void };
  const changes: [string, (dir: string) => Change][] = [
    [
      "the Buffer of an encrypted `{ pem, passphrase }` key is zeroed",
      () => {
        const encrypted = crypto
          .createPrivateKey(agent1.key)
          .export({ type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase: "secret" });
        const pem = Buffer.from(encrypted);
        return { options: { ...agent1, key: [{ pem, passphrase: "secret" }] }, change: () => void pem.fill(0) };
      },
    ],
    [
      "a number is pushed into the `ca` array",
      () => {
        const ca: unknown[] = [ca1];
        return { options: { ...agent1, ca }, change: () => void ca.push(123) };
      },
    ],
    [
      "a number is assigned to server.key",
      () => ({ options: agent1, change: server => void ((server as any).key = 12345) }),
    ],
    [
      "the file of a `key` BunFile is deleted",
      dir => {
        const path = join(dir, "key.pem");
        writeFileSync(path, agent1.key);
        return { options: { ...agent1, key: Bun.file(path) }, change: () => rmSync(path) };
      },
    ],
  ];

  describe.each([
    ["tls.createServer()", tls.createServer],
    ["http2.createSecureServer()", http2.createSecureServer as unknown as typeof tls.createServer],
  ])("%s", (_name, create) => {
    it.concurrent.each(changes)("listens after %s", async (_label, build) => {
      using dir = tempDir("tls-options-when-given", {});
      const { options, change } = build(String(dir));
      const server: tls.Server = create(options);
      try {
        change(server);
        expect(await presented(server)).toBe("agent1");
      } finally {
        server.close();
      }
    });
  });

  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1424
  it("setSecureContext() throws without an options object", () => {
    const server = tls.createServer({ ...agent1 });
    for (const options of [undefined, null, "agent3", 1, [agent3]]) {
      expect(() => server.setSecureContext(options as any)).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
      );
    }
  });

  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1360-L1384: a server with no options builds its context like any other.
  it.each<[string, () => tls.Server]>([
    ["tls.createServer()", () => tls.createServer()],
    ["tls.createServer(null)", () => tls.createServer(null as any)],
    ["tls.createServer(undefined, listener)", () => tls.createServer(undefined as any, () => {})],
    ["new tls.Server()", () => new tls.Server()],
  ])("%s prefers its own cipher order", async (_label, create) => {
    const [aes128, aes256] = ["ECDHE-RSA-AES128-GCM-SHA256", "ECDHE-RSA-AES256-GCM-SHA384"];
    const server = create();
    try {
      server.addContext("agent1", agent1);
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const { port } = server.address() as AddressInfo;
      // tls.DEFAULT_CIPHERS lists aes128 before aes256. The client asks for the reverse.
      const client = tls.connect({
        port,
        host: "127.0.0.1",
        servername: "agent1",
        rejectUnauthorized: false,
        maxVersion: "TLSv1.2",
        ciphers: `${aes256}:${aes128}`,
      });
      try {
        await once(client, "secureConnect");
        expect(client.getCipher().name).toBe(aes128);
      } finally {
        client.destroy();
      }
    } finally {
      server.close();
    }
  });

  // In a process of its own: the list is process-wide.
  it("tls.setDefaultCACertificates() is trusted by a server with no `ca`, next to the CAs of a pfx, and is not server.ca", async () => {
    const script = `
      const tls = require("node:tls"), { once } = require("node:events");
      const { readFileSync } = require("node:fs"), { join } = require("node:path");
      const keys = name => readFileSync(join(process.env.TEST_KEYS, name));
      // ca1 signs agent1, and agent1.pfx carries it. ca2 signs agent4.
      tls.setDefaultCACertificates([keys("ca2-cert.pem").toString()]);

      // Whether the server authorizes each client.
      async function judged(server) {
        server.on("secureConnection", socket => socket.end(String(socket.authorized)));
        await once(server.listen(0, "127.0.0.1"), "listening");
        const result = {};
        for (const agent of ["agent1", "agent4"]) {
          const client = tls.connect({
            port: server.address().port,
            host: "127.0.0.1",
            rejectUnauthorized: false,
            key: keys(agent + "-key.pem"),
            cert: keys(agent + "-cert.pem"),
          });
          let authorized = "";
          client.on("data", chunk => (authorized += chunk));
          await once(client, "close");
          result[agent] = authorized;
        }
        server.close();
        return result;
      }

      const policy = { requestCert: true, rejectUnauthorized: false };
      const plain = tls.createServer({ key: keys("agent1-key.pem"), cert: keys("agent1-cert.pem"), ...policy });
      const pfx = tls.createServer({ pfx: keys("agent1.pfx"), passphrase: "sample", ...policy });
      console.log(JSON.stringify({ ca: typeof plain.ca, plain: await judged(plain), pfx: await judged(pfx) }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: { ...bunEnv, TEST_KEYS: join(import.meta.dir, "..", "test", "fixtures", "keys") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, judged: JSON.parse(stdout || "null") }).toEqual({
      stderr: "",
      judged: {
        ca: "undefined",
        plain: { agent1: "false", agent4: "true" },
        pfx: { agent1: "true", agent4: "true" },
      },
    });
    expect(exitCode).toBe(0);
  });
});

// A closed server keeps its context until the server is collected, so the collector has to know what a context holds.
// In a process of its own: the number is read off the whole heap.
it("a SecureContext reports its native memory to the collector, and gives it back", async () => {
  const script = `
    const tls = require("node:tls"), { heapStats } = require("bun:jsc");
    const { readFileSync } = require("node:fs"), { join } = require("node:path");
    const keys = name => readFileSync(join(process.env.TEST_KEYS, name), "utf8");
    const identity = { key: keys("agent1-key.pem"), cert: keys("agent1-cert.pem") };
    const count = 100;
    const reported = () => heapStats().extraMemorySize / count;

    tls.createSecureContext(identity);
    Bun.gc(true);
    const before = reported();
    let held = [];
    for (let i = 0; i < count; i++) held.push(tls.createSecureContext(identity));
    Bun.gc(true);
    const holding = reported() - before;
    held = null;
    Bun.gc(true);
    const released = reported() - before;
    console.log(JSON.stringify({ pemBytes: identity.key.length + identity.cert.length, holding, released }));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, TEST_KEYS: join(import.meta.dir, "..", "test", "fixtures", "keys") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const { pemBytes, holding, released } = JSON.parse(stdout || "{}");
  expect({ stderr, pemBytes }).toEqual({ stderr: "", pemBytes: expect.any(Number) });
  // Per context: at least the key and the certificate it parsed.
  expect(holding - released).toBeGreaterThan(pemBytes);
  expect(exitCode).toBe(0);
});

// A listener on a Windows named pipe is handed the context too. It holds the context itself, so it reads the
// client certificate policy from it when it starts to listen.
describe.skipIf(!isWindows)("a TLS listener on a named pipe", () => {
  const fixture = (name: string) => readFileSync(join(import.meta.dir, "..", "test", "fixtures", "keys", name), "utf8");
  const agent1 = { key: fixture("agent1-key.pem"), cert: fixture("agent1-cert.pem") }; // issued by ca1
  const agent3 = { key: fixture("agent3-key.pem"), cert: fixture("agent3-cert.pem") }; // issued by ca2
  const newPipe = () => `\\\\.\\pipe\\bun-test-${crypto.randomUUID()}`;

  // What the server wrote to one fresh client that presents `identity`, or "refused".
  async function answer(path: string, identity: object) {
    const client = tls.connect({ path, rejectUnauthorized: false, ...identity });
    let received = "";
    const closed = Promise.withResolvers<void>();
    client.on("data", chunk => (received += chunk)).on("error", () => {});
    client.on("close", () => closed.resolve());
    await closed.promise;
    return received || "refused";
  }

  it("of a tls.Server trusts the `ca` array as it was when the server was created", async () => {
    const pipe = newPipe();
    const ca = [fixture("ca1-cert.pem")];
    const server = tls.createServer({ ...agent1, ca, requestCert: true, rejectUnauthorized: false }, socket =>
      socket.end(`authorized=${socket.authorized}`),
    );
    ca.push(fixture("ca2-cert.pem"));
    try {
      server.listen(pipe);
      await once(server, "listening");
      expect({ agent3: await answer(pipe, agent3), agent1: await answer(pipe, agent1) }).toEqual({
        agent3: "authorized=false",
        agent1: "authorized=true",
      });
    } finally {
      server.close();
    }
  });

  it.each([
    [
      "rejects",
      { requestCert: true, rejectUnauthorized: true },
      { none: "refused", agent3: "refused", agent1: "agent1" },
    ],
    [
      "only asks",
      { requestCert: true, rejectUnauthorized: false },
      { none: "nobody", agent3: "agent3", agent1: "agent1" },
    ],
  ])("of Bun.listen() keeps the policy of a tls.secureContext that %s", async (_, policy, expected) => {
    const pipe = newPipe();
    const secureContext = (tls.createSecureContext({ ...agent1, ca: fixture("ca1-cert.pem"), ...policy }) as any)
      .context;
    using listener = Bun.listen({
      unix: pipe,
      tls: { secureContext },
      socket: {
        handshake: (socket: Bun.Socket) =>
          void socket.end((socket.getPeerCertificate()?.subject?.CN ?? "nobody") as string),
        data() {},
        error() {},
      },
    } as any);
    expect({
      none: await answer(pipe, {}),
      agent3: await answer(pipe, agent3),
      agent1: await answer(pipe, agent1),
    }).toEqual(expected);
  });
});

// A resumed handshake skips client authentication, so the server may only
// resume a session under a context configured like the one that verified the
// client certificate. The refusal below is deliberate and must not be relaxed
// for parity with another runtime: RFC 6066 section 3 lets a server resume only
// a session established for the requested name, and BoringSSL tells servers to
// partition sessions between SNI hosts this way
// (vendor/boringssl/include/openssl/ssl.h:2199-2207).
describe.each(["TLSv1.3", "TLSv1.2"] as const)("session resumption across SNI contexts (%s)", maxVersion => {
  type Seen = {
    servername: string;
    authorized: boolean;
    error: string | null;
    peer: string | null;
    resumed: boolean;
  };

  // The default context trusts ca1 for client certificates.
  async function listen(options: tls.TlsOptions = {}) {
    const server = tls.createServer(
      {
        key: agent2Key,
        cert: agent2Cert,
        ca: [ca1],
        requestCert: true,
        rejectUnauthorized: false,
        maxVersion,
        ...options,
      },
      socket => {
        socket.on("error", () => {});
        const seen: Seen = {
          //@ts-ignore
          servername: socket.servername,
          authorized: socket.authorized,
          //@ts-ignore
          error: socket.authorizationError ?? null,
          peer: (socket.getPeerCertificate()?.subject?.CN as string) ?? null,
          resumed: socket.isSessionReused(),
        };
        socket.end(JSON.stringify(seen));
      },
    );
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
    await promise;
    return server;
  }

  // Connects with the client certificate ca1 issued. Resolves to what the
  // server saw, and the session the client got for a later connection.
  function connect(
    server: tls.Server,
    servername: string,
    options: tls.ConnectionOptions = {},
    onSocket?: (socket: tls.TLSSocket) => void,
  ) {
    const { promise, resolve, reject } = Promise.withResolvers<{ seen: Seen; session: Buffer }>();
    let body = "";
    let session: Buffer | undefined;
    const socket = tls.connect({
      host: "127.0.0.1",
      port: (server.address() as AddressInfo).port,
      servername,
      key: agent1Key,
      cert: agent1Cert,
      rejectUnauthorized: false,
      ...options,
    });
    onSocket?.(socket);
    socket.on("session", s => (session = s));
    socket.on("data", chunk => (body += chunk));
    socket.on("error", reject);
    socket.on("close", () => {
      try {
        resolve({ seen: JSON.parse(body), session: session! });
      } catch (e) {
        reject(e);
      }
    });
    return promise;
  }

  const accepted = (servername: string): Seen => ({
    servername,
    authorized: true,
    error: null,
    peer: "agent1",
    resumed: false,
  });
  const refused = (servername: string): Seen => ({
    servername,
    authorized: false,
    error: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    peer: "agent1",
    resumed: false,
  });

  it("runs a full handshake under a context that trusts another CA", async () => {
    const server = await listen();
    try {
      server.addContext("a.test", { key: agent1Key, cert: agent1Cert, ca: [ca1] });
      server.addContext("b.test", { key: agent3Key, cert: agent3Cert, ca: [ca2] });

      const atDefault = await connect(server, "default.test");
      const atA = await connect(server, "a.test");
      const atB = await connect(server, "b.test");
      expect([atDefault.seen, atA.seen, atB.seen]).toEqual([
        accepted("default.test"),
        accepted("a.test"),
        refused("b.test"),
      ]);

      // b.test verifies the certificate again, against ca2, whichever
      // context's session the client offers.
      const fromDefault = await connect(server, "b.test", { session: atDefault.session });
      const fromA = await connect(server, "b.test", { session: atA.session });
      expect([fromDefault.seen, fromA.seen]).toEqual([refused("b.test"), refused("b.test")]);

      // Every context still resumes its own sessions.
      const again = [
        await connect(server, "default.test", { session: atDefault.session }),
        await connect(server, "a.test", { session: atA.session }),
        await connect(server, "b.test", { session: atB.session }),
      ];
      expect(again.map(c => c.seen)).toEqual([
        { ...accepted("default.test"), resumed: true },
        { ...accepted("a.test"), resumed: true },
        { ...refused("b.test"), resumed: true },
      ]);
    } finally {
      server.close();
    }
  });

  // The same door with the default `rejectUnauthorized`, which is how an mTLS
  // server is configured: the refused client must not reach the handler at all.
  it("keeps a refused client out of the handler with the default rejectUnauthorized", async () => {
    const handled: string[] = [];
    const server = tls.createServer(
      { key: agent2Key, cert: agent2Cert, ca: [ca1], requestCert: true, maxVersion },
      socket => {
        socket.on("error", () => {});
        //@ts-ignore
        handled.push(`${socket.servername}:${socket.authorized}:${socket.isSessionReused()}`);
        socket.end("{}");
      },
    );
    server.on("tlsClientError", () => {});
    const listening = Promise.withResolvers<void>();
    server.once("error", listening.reject);
    server.listen(0, "127.0.0.1", listening.resolve);
    await listening.promise;
    try {
      server.addContext("a.test", { key: agent1Key, cert: agent1Cert, ca: [ca1] });
      server.addContext("b.test", { key: agent3Key, cert: agent3Cert, ca: [ca2] });

      const atA = await connect(server, "a.test").catch(() => ({ session: undefined }));
      await connect(server, "b.test").catch(() => {});
      await connect(server, "b.test", { session: atA.session }).catch(() => {});

      // a.test only. b.test refuses the client before the handler, with or
      // without a.test's session.
      expect(handled).toEqual(["a.test:true:false"]);
    } finally {
      server.close();
    }
  });

  it("covers the contexts an SNICallback builds for each handshake", async () => {
    const contexts = {
      "a.test": { key: agent1Key, cert: agent1Cert, ca: [ca1] },
      "b.test": { key: agent3Key, cert: agent3Cert, ca: [ca2] },
    };
    const server = await listen({
      SNICallback: (servername, callback) => callback(null, tls.createSecureContext(contexts[servername])),
    });
    try {
      const atA = await connect(server, "a.test");
      expect(atA.seen).toEqual(accepted("a.test"));

      const fromA = await connect(server, "b.test", { session: atA.session });
      expect(fromA.seen).toEqual(refused("b.test"));

      // The context for this handshake is a new object built from the same
      // options as the one that issued the session, so the session resumes.
      const again = await connect(server, "a.test", { session: atA.session });
      expect(again.seen).toEqual({ ...accepted("a.test"), resumed: true });
    } finally {
      server.close();
    }
  });

  it("covers contexts that differ only by addCACert", async () => {
    const trusting = (ca: string) => {
      const context = tls.createSecureContext({ key: agent1Key, cert: agent1Cert });
      //@ts-ignore
      context.context.addCACert(ca);
      return context;
    };
    const server = await listen();
    try {
      server.addContext("a.test", trusting(ca1));
      server.addContext("b.test", trusting(ca2));

      const atA = await connect(server, "a.test");
      expect(atA.seen).toEqual(accepted("a.test"));

      const fromA = await connect(server, "b.test", { session: atA.session });
      expect(fromA.seen).toEqual(refused("b.test"));

      const again = await connect(server, "a.test", { session: atA.session });
      expect(again.seen).toEqual({ ...accepted("a.test"), resumed: true });
    } finally {
      server.close();
    }
  });

  // The session id context that separates a server's contexts must not reach
  // client sockets: a client aborts a resumed handshake when the session's id
  // differs from its own.
  it("lets a client offer a session under other client options", async () => {
    const server = await listen();
    try {
      const first = await connect(server, "default.test");
      expect(first.seen).toEqual(accepted("default.test"));

      // `ca` puts these connections on another client context than `first`.
      const overTcp = await connect(server, "default.test", { session: first.session, ca: [ca2] });
      expect(overTcp.seen).toEqual({ ...accepted("default.test"), resumed: true });

      const raw = net.connect((server.address() as AddressInfo).port, "127.0.0.1");
      const duplex = new Duplex({
        read() {},
        write(chunk, encoding, callback) {
          raw.write(chunk, encoding, callback);
        },
        final(callback) {
          raw.end();
          callback();
        },
      });
      raw.on("data", chunk => duplex.push(chunk));
      raw.on("end", () => duplex.push(null));
      raw.on("close", () => duplex.destroy());
      const overDuplex = await connect(server, "default.test", {
        session: first.session,
        ca: [ca2],
        socket: duplex,
      });
      expect(overDuplex.seen).toEqual({ ...accepted("default.test"), resumed: true });
    } finally {
      server.close();
    }
  });

  // `setKeyCert()` moves the connection to another context. On a client that
  // must not take the context's session id context either.
  it("lets a client that calls setKeyCert() still resume", async () => {
    const other = tls.createSecureContext({ key: agent3Key, cert: agent3Cert });
    const server = await listen();
    try {
      const first = await connect(server, "default.test");
      expect(first.seen).toEqual(accepted("default.test"));

      const again = await connect(server, "default.test", { session: first.session }, socket =>
        socket.on("connect", () => socket.setKeyCert(other)),
      );
      // A resumed handshake sends no certificate, so the server still reports
      // the one from the full handshake.
      expect(again.seen).toEqual({ ...accepted("default.test"), resumed: true });
    } finally {
      server.close();
    }
  });
});

// Node negotiates ALPN per connection, whichever SecureContext SNI selected.
// https://github.com/oven-sh/bun/issues/17932
describe.each(["TLSv1.2", "TLSv1.3"] as const)("ALPN after SNI selected a SecureContext (%s)", version => {
  const defaults = { key: agent2Key, cert: agent2Cert };
  const selected = { key: agent1Key, cert: agent1Cert };
  type SNICb = (err: Error | null, ctx?: any) => void;
  const sync = (_: string, cb: SNICb) => cb(null, tls.createSecureContext(selected));
  const deferred = (_: string, cb: SNICb) => void setImmediate(cb, null, tls.createSecureContext(selected));

  // How the connection comes by its context. Each returns the port to dial.
  type Start = (alpn: object, onSecure: (socket: tls.TLSSocket) => void, stack: DisposableStack) => Promise<number>;
  const listening = async (server: net.Server, stack: DisposableStack) => {
    stack.defer(() => void server.close());
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return (server.address() as AddressInfo).port;
  };
  const accepted =
    (options: object, setup?: (server: tls.Server) => void): Start =>
    (alpn, onSecure, stack) => {
      const server = tls.createServer({ ...defaults, ...options, ...alpn }, onSecure);
      server.on("tlsClientError", () => {});
      setup?.(server);
      return listening(server, stack);
    };
  const addContext = (server: tls.Server) => server.addContext("alpn.sni.test", selected);
  const paths: [string, Start][] = [
    ["a synchronous SNICallback", accepted({ SNICallback: sync })],
    ["an asynchronous SNICallback", accepted({ SNICallback: deferred })],
    ["addContext()", accepted({}, addContext)],
    // Bun only: in Node a user SNICallback replaces the addContext() entries.
    [
      "addContext() behind an SNICallback that selects nothing",
      accepted({ SNICallback: (_: string, cb: SNICb) => void setImmediate(cb, null, null) }, addContext),
    ],
    [
      "addContext() on an injected socket",
      (alpn, onSecure, stack) => {
        const server = tls.createServer({ ...defaults, ...alpn }, onSecure);
        server.on("tlsClientError", () => {});
        addContext(server);
        return listening(
          net.createServer(raw => server.emit("connection", raw)),
          stack,
        );
      },
    ],
    [
      "the SNICallback of a server-side TLSSocket",
      (alpn, onSecure, stack) =>
        listening(
          net.createServer(raw => {
            const socket = new tls.TLSSocket(raw, {
              isServer: true,
              secureContext: tls.createSecureContext(defaults),
              SNICallback: sync,
              ...alpn,
            });
            socket.on("error", () => {});
            socket.on("secure", () => onSecure(socket));
          }),
          stack,
        ),
    ],
  ];

  function dial(port: number, ALPNProtocols: string[]) {
    return tls.connect({
      port,
      host: "127.0.0.1",
      servername: "alpn.sni.test",
      ALPNProtocols,
      rejectUnauthorized: false,
      minVersion: version,
      maxVersion: version,
    });
  }

  describe.each(paths)("by %s", (_, start) => {
    it("negotiates from ALPNProtocols", async () => {
      using stack = new DisposableStack();
      const serverSide = Promise.withResolvers<unknown>();
      const port = await start({ ALPNProtocols: ["h2", "http/1.1"] }, s => serverSide.resolve(s.alpnProtocol), stack);
      const client = dial(port, ["http/1.1", "h2"]);
      stack.defer(() => void client.destroy());
      await once(client, "secureConnect");
      expect({
        cn: client.getPeerCertificate().subject.CN,
        client: client.alpnProtocol,
        server: await serverSide.promise,
      }).toEqual({ cn: "agent1", client: "h2", server: "h2" });
    });

    it("runs ALPNCallback", async () => {
      using stack = new DisposableStack();
      const seen: unknown[] = [];
      const ALPNCallback = (offer: unknown) => (seen.push(offer), "h2");
      const client = dial(await start({ ALPNCallback }, s => s.end(), stack), ["http/1.1", "h2"]);
      stack.defer(() => void client.destroy());
      await once(client, "secureConnect");
      expect({ cn: client.getPeerCertificate().subject.CN, client: client.alpnProtocol, seen }).toEqual({
        cn: "agent1",
        client: "h2",
        seen: [{ servername: "alpn.sni.test", protocols: ["http/1.1", "h2"] }],
      });
    });

    // RFC 7301 section 3.2
    it("refuses a client that offers none of ALPNProtocols", async () => {
      using stack = new DisposableStack();
      const client = dial(await start({ ALPNProtocols: ["h2"] }, s => s.end(), stack), ["spdy/3"]);
      stack.defer(() => void client.destroy());
      const outcome = Promise.withResolvers<unknown>();
      client.on("error", err => outcome.resolve((err as NodeJS.ErrnoException).code));
      client.on("secureConnect", () => outcome.resolve(`connected, alpnProtocol=${client.alpnProtocol}`));
      expect(await outcome.promise).toBe("ERR_SSL_TLSV1_ALERT_NO_APPLICATION_PROTOCOL");
    });
  });

  it("http2.createSecureServer() with an SNICallback speaks h2", async () => {
    using stack = new DisposableStack();
    const server = http2.createSecureServer({ ...defaults, SNICallback: sync }, (_, res) => res.end("over h2"));
    const port = await listening(server, stack);
    const session = http2.connect(`https://127.0.0.1:${port}`, {
      servername: "alpn.sni.test",
      rejectUnauthorized: false,
      minVersion: version,
      maxVersion: version,
    });
    stack.defer(() => session.destroy());
    const failed = once(session, "error").then(([err]) => Promise.reject(err));
    const request = session.request({ ":path": "/" }).setEncoding("utf8");
    let body = "";
    request.on("data", chunk => (body += chunk));
    await Promise.race([once(request, "end"), failed]);
    expect(body).toBe("over h2");
  });
});

describe("Bun.serve SNI", () => {
  function doClientRequest(options: any) {
    return new Promise((resolve, reject) => {
      const client = tls.connect(
        {
          ...options,
          rejectUnauthorized: false,
        },
        () => {
          resolve(
            //@ts-ignore
            client.authorizationError && client.authorizationError.indexOf("ERR_TLS_CERT_ALTNAME_INVALID") !== -1,
          );
        },
      );
      client.on("close", resolve);
      client.on("error", reject);
    });
  }
  it("single SNI", async () => {
    {
      using server = Bun.serve({
        port: 0,
        tls: {
          ...SNIContexts["asterisk.test.com"],
          serverName: "*.test.com",
        },
        fetch(req, res) {
          return new Response(new URL(req.url).hostname);
        },
      });
      for (const servername of ["a.test.com", "b.test.com", "c.test.com"]) {
        const client = await doClientRequest({
          ...SNIContexts["asterisk.test.com"],
          port: server.port,
          ca: [ca2],
          servername,
        });
        expect(client).toBe(true);
      }
      {
        const client = await doClientRequest({
          ...goodSecureContext,
          port: server.port,
          servername: "a.example.com",
        });
        expect(client).toBe(false);
      }
    }
    {
      using server = Bun.serve({
        port: 0,
        tls: {
          ...goodSecureContext,
          serverName: "*.example.com",
        },
        fetch(req, res) {
          return new Response(new URL(req.url).hostname);
        },
      });
      {
        const client = await doClientRequest({
          ...goodSecureContext,
          port: server.port,
          servername: "a.example.com",
        });
        expect(client).toBe(true);
      }

      {
        const client = await doClientRequest({
          ...goodSecureContext,
          port: server.port,
          servername: "b.example.com",
        });
        expect(client).toBe(true);
      }
    }
  });
  it("multiple SNI", async () => {
    {
      using server = Bun.serve({
        port: 0,
        tls: [
          serverOptions,
          {
            serverName: "a.example.com",
            ...SNIContexts["a.example.com"],
          },
          {
            serverName: "*.test.com",
            ...SNIContexts["asterisk.test.com"],
          },
          {
            serverName: "chain.example.com",
            ...SNIContexts["chain.example.com"],
          },
        ],
        fetch(req, res) {
          return new Response("OK");
        },
      });
      expect(
        await doClientRequest({
          ca: [ca1],
          servername: "a.example.com",
          port: server.port,
        }),
      ).toBe(true);
      expect(
        await doClientRequest({
          ca: [ca2],
          servername: "b.test.com",
          port: server.port,
        }),
      ).toBe(true);

      expect(
        await doClientRequest({
          ca: [ca2],
          servername: "a.b.test.com",
          port: server.port,
        }),
      ).toBe(false);

      expect(
        await doClientRequest({
          ca: [ca1],
          servername: "c.wrong.com",
          port: server.port,
        }),
      ).toBe(false);
      expect(
        await doClientRequest({
          ca: [ca1],
          servername: "chain.example.com",
          port: server.port,
        }),
      ).toBe(true);
    }
  });
});

// Node v26.3.0 compares addContext() names case-sensitively; v26.4.0 and later compile them into /.../i.
describe("SNI matching is case-insensitive", () => {
  function servedCN(port: number, servername: string) {
    const { promise, resolve, reject } = Promise.withResolvers<string | undefined>();
    const socket = tls.connect({ host: "127.0.0.1", port, servername, rejectUnauthorized: false }, () => {
      resolve(socket.getPeerCertificate()?.subject?.CN as string | undefined);
      socket.end();
    });
    socket.on("error", reject);
    return promise;
  }

  it("tls.Server addContext", async () => {
    const server = tls.createServer({ key: agent2Key, cert: agent2Cert }, s => s.end());
    server.addContext("a.example.com", SNIContexts["a.example.com"]); // agent1
    server.addContext("UPPER.EXAMPLE.COM", SNIContexts["asterisk.test.com"]); // agent3
    server.addContext("*.test.com", SNIContexts["asterisk.test.com"]); // agent3
    server.addContext("Twice.example.com", SNIContexts["a.example.com"]); // agent1
    server.addContext("twice.example.com", SNIContexts["asterisk.test.com"]); // agent3
    try {
      const listening = Promise.withResolvers<void>();
      server.once("error", listening.reject);
      server.listen(0, listening.resolve);
      await listening.promise;
      const port = (server.address() as AddressInfo).port;
      expect({
        exact: await servedCN(port, "a.example.com"),
        upper: await servedCN(port, "A.EXAMPLE.COM"),
        mixed: await servedCN(port, "A.Example.Com"),
        registeredUpper: await servedCN(port, "upper.example.com"),
        wildcardUpper: await servedCN(port, "B.TEST.COM"),
        lastOfTwoSpellings: await servedCN(port, "Twice.example.com"),
        noMatch: await servedCN(port, "other.example.org"),
      }).toEqual({
        exact: "agent1",
        upper: "agent1",
        mixed: "agent1",
        registeredUpper: "agent3",
        wildcardUpper: "agent3",
        lastOfTwoSpellings: "agent3",
        noMatch: "agent2",
      });
    } finally {
      server.close();
    }
  });

  // The context an SNI selects also decides which CA client certificates must chain to.
  describe.each(["TLSv1.2", "TLSv1.3"] as const)("%s", version => {
    const inAnyCase = ["strict.example.com", "STRICT.EXAMPLE.COM", "sTrIcT.eXaMpLe.CoM"];
    const selectsNothing = (_: string, cb: Function) => cb(null, null);
    it.each([
      ["in any case", inAnyCase, undefined],
      // Bun only: Node serves the default context for a name with the root dot.
      ["with the root dot", ["strict.example.com.", "STRICT.EXAMPLE.COM."], undefined],
      // Bun only: in Node a user SNICallback replaces the addContext() entries.
      ["behind an SNICallback that selects nothing", inAnyCase, selectsNothing],
    ])("a context's client CA applies to its name %s", async (_, spellings, SNICallback) => {
      const server = tls.createServer({
        key: agent2Key,
        cert: agent2Cert,
        ca: [ca1],
        requestCert: true,
        rejectUnauthorized: true,
        SNICallback,
      } as any);
      server.addContext("Strict.Example.com", { key: agent1Key, cert: agent1Cert, ca: [loadPEM("ca5-cert.pem")] });
      // agent1 chains to ca1, which only the default context trusts; ec10 chains to ca5.
      const ec10 = [loadPEM("ec10-key.pem"), loadPEM("ec10-cert.pem")] as const;
      async function verdict(servername: string, key: string, cert: string) {
        const judged = Promise.race([
          once(server, "secureConnection").then(() => "accepted"),
          once(server, "tlsClientError").then(() => "refused"),
        ]);
        const socket = tls.connect({
          host: "127.0.0.1",
          port: (server.address() as AddressInfo).port,
          servername,
          key,
          cert,
          rejectUnauthorized: false,
          minVersion: version,
          maxVersion: version,
        });
        socket.on("error", () => {});
        try {
          return await judged;
        } finally {
          socket.destroy();
        }
      }
      try {
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const verdicts: string[][] = [];
        for (const name of spellings) {
          verdicts.push([name, await verdict(name, agent1Key, agent1Cert), await verdict(name, ...ec10)]);
        }
        expect(verdicts).toEqual(spellings.map(name => [name, "refused", "accepted"]));
        expect(await verdict("other.example.com", agent1Key, agent1Cert)).toBe("accepted");
      } finally {
        server.close();
      }
    });
  });

  it("Bun.serve tls array", async () => {
    using server = Bun.serve({
      port: 0,
      tls: [
        { key: agent2Key, cert: agent2Cert },
        { serverName: "a.example.com", ...SNIContexts["a.example.com"] },
        { serverName: "*.test.com", ...SNIContexts["asterisk.test.com"] },
      ],
      fetch: () => new Response("OK"),
    });
    expect({
      upper: await servedCN(server.port!, "A.EXAMPLE.COM"),
      mixed: await servedCN(server.port!, "a.Example.com"),
      wildcardUpper: await servedCN(server.port!, "B.TEST.COM"),
      noMatch: await servedCN(server.port!, "other.example.org"),
    }).toEqual({
      upper: "agent1",
      mixed: "agent1",
      wildcardUpper: "agent3",
      noMatch: "agent2",
    });
  });
});

describe("server certificate chain built from `ca`", () => {
  it("presents an intermediate known only to the default store (NODE_EXTRA_CA_CERTS)", async () => {
    // With no `ca`, Node seeds the context's store with the default roots
    // (which include NODE_EXTRA_CA_CERTS) and the handshake-time auto-chain
    // completes a leaf-only `cert` from it. The client trusts ONLY the root
    // (an explicit `ca` replaces its default store), so it can verify iff the
    // server actually sent the intermediate.
    const [agent6Leaf, ca3Cert] = agent6Cert.split(/(?=-----BEGIN CERTIFICATE-----)/);
    const ca3Serial = new X509Certificate(ca3Cert).serialNumber.toUpperCase();
    using dir = tempDir("extra-ca-auto-chain", {
      "intermediate.pem": ca3Cert,
      "leaf.pem": agent6Leaf,
      "key.pem": agent6Key,
      "root.pem": ca1,
      "main.ts": `
        import tls from "node:tls";
        import { readFileSync } from "node:fs";
        const server = tls.createServer(
          { key: readFileSync("key.pem"), cert: readFileSync("leaf.pem") },
          s => s.end(),
        );
        server.on("tlsClientError", e => { console.error("tlsClientError: " + e); process.exit(1); });
        server.listen(0, () => {
          const socket = tls.connect(
            {
              port: server.address().port,
              ca: [readFileSync("root.pem")],
              rejectUnauthorized: false,
              checkServerIdentity: () => undefined,
            },
            () => {
              const serials = [];
              let cur = socket.getPeerCertificate(true);
              while (cur) {
                serials.push(String(cur.serialNumber).toUpperCase());
                const issuer = cur.issuerCertificate;
                if (!issuer || issuer === cur) break;
                cur = issuer;
              }
              console.log(JSON.stringify({ authorized: socket.authorized, serials }));
              socket.end();
              server.close();
            },
          );
          socket.on("error", e => { console.error("client error: " + e); process.exit(1); });
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.ts"],
      env: { ...bunEnv, NODE_EXTRA_CA_CERTS: join(String(dir), "intermediate.pem") },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const got = exitCode === 0 ? JSON.parse(stdout.trim()) : { authorized: false, serials: [] };
    expect({
      authorized: got.authorized,
      presentedIntermediate: got.serials.includes(ca3Serial),
      exitCode,
      failureDetail: exitCode === 0 ? "" : stderr,
    }).toEqual({ authorized: true, presentedIntermediate: true, exitCode: 0, failureDetail: "" });
  });

  // Node never presents the whole `ca` set: OpenSSL auto-chain walks the
  // trust store from the leaf and sends only the resulting issuer path.
  it("does not present `ca` entries unrelated to the leaf's issuer chain", async () => {
    // agent6-cert.pem is the agent6 leaf followed by the ca3 intermediate
    // that signed it; ca2 is a trust anchor unrelated to that chain.
    const [agent6Leaf, ca3Cert] = agent6Cert.split(/(?=-----BEGIN CERTIFICATE-----)/);
    const ca2Serial = new X509Certificate(ca2).serialNumber.toUpperCase();
    const ca3Serial = new X509Certificate(ca3Cert).serialNumber.toUpperCase();
    const server = tls.createServer({ key: agent6Key, cert: agent6Leaf, ca: [ca3Cert, ca2] }, s => s.end());
    // Any server-side failure must reject the awaited steps below instead of
    // letting the test hang to the suite timeout.
    const failure = Promise.withResolvers<never>();
    server.on("error", failure.reject);
    server.on("tlsClientError", failure.reject);
    let socket: tls.TLSSocket | undefined;
    try {
      const listening = Promise.withResolvers<void>();
      server.listen(0, listening.resolve);
      await Promise.race([listening.promise, failure.promise]);
      const secured = Promise.withResolvers<void>();
      socket = tls.connect(
        {
          port: (server.address() as AddressInfo).port,
          rejectUnauthorized: false,
          checkServerIdentity: () => undefined,
        },
        secured.resolve,
      );
      socket.on("error", secured.reject);
      await Promise.race([secured.promise, failure.promise]);
      const presentedSerials: string[] = [];
      let current: any = socket.getPeerCertificate(true);
      while (current) {
        presentedSerials.push(String(current.serialNumber).toUpperCase());
        const issuer = current.issuerCertificate;
        if (!issuer || issuer === current) break;
        current = issuer;
      }
      expect(presentedSerials).toContain(ca3Serial);
      expect(presentedSerials).not.toContain(ca2Serial);
    } finally {
      socket?.destroy();
      server.close();
    }
  });

  it("presents the issuer path when the leaf and intermediate are loaded from files", async () => {
    // Same auto-chain rule for the `certFile`/`caFile` loading path.
    const [agent6Leaf, ca3Cert] = agent6Cert.split(/(?=-----BEGIN CERTIFICATE-----)/);
    const ca3Serial = new X509Certificate(ca3Cert).serialNumber.toUpperCase();
    using dir = tempDir("tls-cafile-chain", {
      "leaf.pem": agent6Leaf,
      "ca3.pem": ca3Cert,
      "key.pem": agent6Key,
    });
    using server = Bun.serve({
      port: 0,
      tls: {
        keyFile: join(String(dir), "key.pem"),
        certFile: join(String(dir), "leaf.pem"),
        caFile: join(String(dir), "ca3.pem"),
      },
      fetch: () => new Response("ok"),
    });
    const secured = Promise.withResolvers<void>();
    const socket = tls.connect(
      { port: server.port, rejectUnauthorized: false, checkServerIdentity: () => undefined },
      secured.resolve,
    );
    socket.on("error", secured.reject);
    try {
      await secured.promise;
      const presentedSerials: string[] = [];
      let current: any = socket.getPeerCertificate(true);
      while (current) {
        presentedSerials.push(String(current.serialNumber).toUpperCase());
        const issuer = current.issuerCertificate;
        if (!issuer || issuer === current) break;
        current = issuer;
      }
      expect(presentedSerials).toContain(ca3Serial);
    } finally {
      socket.destroy();
    }
  });
});

it("accepts every BoringSSL named group (and alias) as ecdhCurve", () => {
  // Mirrors vendor/boringssl/ssl/ssl_key_share.cc kNamedGroups at the pinned
  // commit. This pins the set the public API accepts; it cannot detect a NEW
  // upstream group by itself - the boringssl upgrade doc re-derives the list.
  const groups = [
    "P-256",
    "prime256v1",
    "P-384",
    "secp384r1",
    "P-521",
    "secp521r1",
    "X25519",
    "x25519",
    "X25519MLKEM768",
    "MLKEM1024",
  ];
  const rejected = groups.filter(g => {
    try {
      tls.createSecureContext({ ecdhCurve: g });
      return false;
    } catch {
      return true;
    }
  });
  expect(rejected).toEqual([]);
  // "auto" and a colon-separated list are accepted like Node.
  expect(() => tls.createSecureContext({ ecdhCurve: "auto" })).not.toThrow();
  expect(() => tls.createSecureContext({ ecdhCurve: "P-256:X25519" })).not.toThrow();
});

it("rejects an unsupported ecdhCurve with Node's error shape", () => {
  // Node: THROW_ERR_CRYPTO_OPERATION_FAILED sets `code` without renaming the
  // error, so String(err) still matches the upstream tests' /Error: .../ regex:
  // https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_context.cc#L1973-L1975
  let err: any;
  try {
    tls.createSecureContext({ ecdhCurve: "not-a-real-curve" });
  } catch (e) {
    err = e;
  }
  expect({ name: err?.name, code: err?.code, message: err?.message, text: String(err) }).toEqual({
    name: "Error",
    code: "ERR_CRYPTO_OPERATION_FAILED",
    message: "Failed to set ECDH curve",
    text: "Error: Failed to set ECDH curve",
  });
});

it("rejects a non-string ecdhCurve like Node's validateString", () => {
  // Node: configSecureContext destructures ecdhCurve with a default and passes
  // it through validateString - only the type is checked in JS, an unsupported
  // name is left to the native SSL_CTX_set1_groups_list call.
  for (const bad of [null, 42, {}]) {
    let err: any;
    try {
      tls.createSecureContext({ ecdhCurve: bad as any });
    } catch (e) {
      err = e;
    }
    expect({ code: err?.code, input: bad }).toEqual({ code: "ERR_INVALID_ARG_TYPE", input: bad });
  }
});

it("rejects an unparseable crl with Node's error shape", () => {
  // Node's SetCRL wraps the parse in ClearErrorOnReturn and throws
  // ERR_CRYPTO_OPERATION_FAILED("Failed to parse CRL"), no OpenSSL decoration:
  // https://github.com/nodejs/node/blob/v26.3.0/src/crypto/crypto_context.cc#L1893-L1903
  // https://github.com/nodejs/node/blob/v26.3.0/test/parallel/test-crypto.js#L291-L298
  let err: any;
  try {
    tls.createSecureContext({ crl: "not a CRL" });
  } catch (e) {
    err = e;
  }
  expect({
    name: err?.name,
    code: err?.code,
    message: err?.message,
    hasOpensslErrorStack: "opensslErrorStack" in (err ?? {}),
  }).toEqual({
    name: "Error",
    code: "ERR_CRYPTO_OPERATION_FAILED",
    message: "Failed to parse CRL",
    hasOpensslErrorStack: false,
  });
});

it("validates crl the same way on both createSecureContext and Server.setSecureContext", () => {
  // Node validates crl via validateKeyOrCertOption in configSecureContext,
  // which both createSecureContext and tls.Server use:
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/secure-context.js#L261-L269
  for (const build of [
    () => tls.createSecureContext({ crl: 123 as never }),
    () => tls.createServer({ crl: 123 as never }),
  ]) {
    let err: any;
    try {
      build();
    } catch (e) {
      err = e;
    }
    expect(err?.code).toBe("ERR_INVALID_ARG_TYPE");
  }
});

it("only tls.Server counts a falsy crl as absent", () => {
  // tls.Server#setSecureContext() stores undefined for a falsy crl. configSecureContext(),
  // behind every other entry point, only skips null and undefined:
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1471-L1474
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/secure-context.js#L261-L271
  const server = tls.createServer({ key: agent1Key, cert: agent1Cert });
  for (const [crl, code] of [
    ["", "ERR_CRYPTO_OPERATION_FAILED"],
    [false, "ERR_INVALID_ARG_TYPE"],
    [0, "ERR_INVALID_ARG_TYPE"],
  ] as [never, string][]) {
    const rejected = expect.objectContaining({ code });
    expect(() => tls.createSecureContext({ crl })).toThrow(rejected);
    expect(() => server.addContext("example.com", { crl })).toThrow(rejected);
    expect(() => tls.connect({ socket: new Duplex({ read() {} }), crl })).toThrow(rejected);
    expect((tls.createServer({ crl }) as any).crl).toBeUndefined();
  }
  // An empty array is truthy. tls.Server keeps it, and it names no CRL.
  expect((tls.createServer({ crl: [] }) as any).crl).toEqual([]);
});

it("accepts BoringSSL kCipherAliases selectors that are not literal suite names", () => {
  // vendor/boringssl/ssl/ssl_cipher.cc kCipherAliases: AES128, AES256, kPSK,
  // aPSK, FIPS all match a non-empty cipher list. Node built against BoringSSL
  // accepts them; a JS-side pre-check must not reject what the parser accepts.
  for (const ciphers of ["AES128", "AES256", "FIPS", "kPSK", "aPSK"]) {
    expect(() => tls.createSecureContext({ ciphers })).not.toThrow();
  }
});

it("validates sigalgs on every secure context like Node's configSecureContext", () => {
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/secure-context.js#L213-L217
  expect(() => tls.createSecureContext({ sigalgs: "" })).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
  );
  expect(() => tls.createSecureContext({ sigalgs: 42 as never })).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
  );
});

describe("sessionTimeout", () => {
  // SSLSession ::= SEQUENCE { ..., timeout [2] INTEGER, ..., ticketLifetimeHint [9] INTEGER OPTIONAL, ... }
  // BoringSSL folds a TLS 1.3 server's ticket lifetime into `timeout`; OpenSSL keeps it in the hint.
  function sessionLifetime(der: Uint8Array) {
    let pos = 0;
    function readHeader() {
      const tag = der[pos++];
      let length = der[pos++];
      if (length & 0x80) {
        const lengthBytes = length & 0x7f;
        length = 0;
        for (let i = 0; i < lengthBytes; i++) length = length * 256 + der[pos++];
      }
      return { tag, end: pos + length };
    }
    function readInteger(end: number) {
      const integer = readHeader();
      expect(integer.tag).toBe(0x02);
      expect(integer.end).toBe(end);
      let value = 0;
      for (; pos < integer.end; pos++) value = value * 256 + der[pos];
      return value;
    }
    const sequence = readHeader();
    expect(sequence.tag).toBe(0x30);
    let timeout: number | undefined;
    let ticketLifetimeHint: number | undefined;
    while (pos < sequence.end) {
      const element = readHeader();
      if (element.tag === 0xa2) timeout = readInteger(element.end);
      else if (element.tag === 0xa9) ticketLifetimeHint = readInteger(element.end);
      pos = element.end;
    }
    return Math.min(timeout!, ticketLifetimeHint ?? Infinity);
  }

  // BoringSSL holds TLS 1.3 tickets back until the server's first write; `request` provokes it.
  async function firstSessionFrom(port: number, clientOptions: tls.ConnectionOptions = {}, request?: string) {
    const startedAt = Date.now();
    const socket = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false, ...clientOptions });
    try {
      socket.resume();
      if (request !== undefined) {
        await once(socket, "secureConnect");
        socket.write(request);
      }
      const session = await new Promise<Buffer>((resolve, reject) => {
        socket.once("session", resolve);
        socket.once("error", reject);
        socket.once("close", () => reject(new Error("connection closed before the server issued a session")));
      });
      // A lifetime counts from ticket issuance: each second boundary crossed since then takes one off.
      const skew = Math.ceil((Date.now() - startedAt) / 1000) + 1;
      return { protocol: socket.getProtocol(), lifetime: sessionLifetime(session), skew };
    } finally {
      socket.destroy();
    }
  }

  async function withTlsServer(options: tls.TlsOptions, clientOptions?: tls.ConnectionOptions) {
    const server = tls.createServer({ key: agent1Key, cert: agent1Cert, ...options }, socket => socket.end("x"));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      return await firstSessionFrom((server.address() as AddressInfo).port, clientOptions);
    } finally {
      server.close();
    }
  }

  it("tls.createServer({ sessionTimeout }) is the lifetime of the tickets it issues", async () => {
    for (const maxVersion of ["TLSv1.3", "TLSv1.2"] as const) {
      const { protocol, lifetime, skew } = await withTlsServer({ sessionTimeout: 7, maxVersion });
      expect(protocol).toBe(maxVersion);
      expect(lifetime).toBeWithin(7 - skew, 8);
    }
  });

  it("tls.connect({ sessionTimeout }) caps the lifetime of the TLS 1.3 sessions the client keeps", async () => {
    const { protocol, lifetime, skew } = await withTlsServer({}, { sessionTimeout: 9 } as tls.ConnectionOptions);
    expect(protocol).toBe("TLSv1.3");
    expect(lifetime).toBeWithin(9 - skew, 10);
  });

  it("Bun.serve({ tls: { sessionTimeout } }) is the lifetime of the TLS 1.3 tickets it issues", async () => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls: { key: agent1Key, cert: agent1Cert, sessionTimeout: 7 } as Bun.TLSOptions,
      fetch: () => new Response("ok"),
    });
    const request = "GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
    const { protocol, lifetime, skew } = await firstSessionFrom(server.port!, {}, request);
    expect(protocol).toBe("TLSv1.3");
    expect(lifetime).toBeWithin(7 - skew, 8);
  });
});

it("getCiphers() lists the supported cipher names, lower-cased and sorted", () => {
  const ciphers = tls.getCiphers();
  expect(ciphers).toEqual([...new Set(ciphers)].sort());
  expect(ciphers).toEqual(ciphers.map(name => name.toLowerCase()));
  expect(ciphers).toEqual(
    expect.arrayContaining([
      "aes256-sha",
      "ecdhe-rsa-aes128-gcm-sha256",
      "tls_aes_128_gcm_sha256",
      "tls_aes_256_gcm_sha384",
      "tls_chacha20_poly1305_sha256",
    ]),
  );
  for (const name of ciphers) expect(() => tls.createSecureContext({ ciphers: name.toUpperCase() })).not.toThrow();

  tls.getCiphers().length = 0;
  expect(tls.getCiphers()).toEqual(ciphers);
});

it("tls.SecureContext is the class of what createSecureContext() returns", () => {
  const context = tls.createSecureContext({});
  expect(context).toBeInstanceOf((tls as any).SecureContext);
  expect(context.constructor).toBe((tls as any).SecureContext);
  expect(Object.keys((tls as any).SecureContext.prototype)).toEqual([]);
  expect({}).not.toBeInstanceOf((tls as any).SecureContext);
  expect(new (tls as any).SecureContext()).toBeInstanceOf((tls as any).SecureContext);
  expect((tls as any).SecureContext()).toBeInstanceOf((tls as any).SecureContext);
});
