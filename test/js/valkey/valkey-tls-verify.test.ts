import { RedisClient } from "bun";
import { describe, expect, mock, test } from "bun:test";
import { bunEnv, bunExe, isIPv6, isWindows, tls as localhostTls, nodeExe, tempDir } from "harness";
import { once } from "node:events";
import fs from "node:fs";
import net, { type AddressInfo } from "node:net";
import path from "node:path";
import tls from "node:tls";
import { loopbackFence, runEventLoopUntil } from "../sql/wire-frames";

// Server presents a cert for CN=agent1 (no SAN), signed by ca1.
// A client connecting to host "localhost" with ca1 trusted will pass chain
// verification but MUST fail hostname verification (localhost != agent1).
const fixturesDir = path.join(import.meta.dirname, "..", "node", "tls", "fixtures");
const serverKey = fs.readFileSync(path.join(fixturesDir, "agent1-key.pem"));
const serverCert = fs.readFileSync(path.join(fixturesDir, "agent1-cert.pem"));
const ca = fs.readFileSync(path.join(fixturesDir, "ca1-cert.pem"));

// Consume one complete RESP array (*N\r\n followed by N bulk strings) from the
// front of `buf`. Returns the number of bytes consumed, or 0 if incomplete.
function consumeRespArray(buf: Buffer): number {
  if (buf.length < 4 || buf[0] !== 0x2a /* '*' */) return 0;
  let eol = buf.indexOf("\r\n");
  if (eol < 0) return 0;
  const count = parseInt(buf.subarray(1, eol).toString("latin1"), 10);
  let off = eol + 2;
  for (let i = 0; i < count; i++) {
    if (off >= buf.length || buf[off] !== 0x24 /* '$' */) return 0;
    eol = buf.indexOf("\r\n", off);
    if (eol < 0) return 0;
    const len = parseInt(buf.subarray(off + 1, eol).toString("latin1"), 10);
    off = eol + 2 + len + 2;
    if (off > buf.length) return 0;
  }
  return off;
}

// Minimal Redis-ish server. It replies +OK to the first command (HELLO) so the
// client's authentication handshake succeeds, then +PONG to everything else.
// Buffers and frames RESP arrays so commands split across packets (or batched
// into one) are each answered exactly once.
function fakeServer(serverOpts: tls.TlsOptions): tls.Server {
  const server = tls.createServer(serverOpts, socket => {
    let buf = Buffer.alloc(0);
    let seen = 0;
    socket.on("data", chunk => {
      buf = Buffer.concat([buf, chunk as Buffer]);
      let consumed: number;
      while ((consumed = consumeRespArray(buf)) > 0) {
        buf = buf.subarray(consumed);
        socket.write(seen++ === 0 ? "+OK\r\n" : "+PONG\r\n");
      }
    });
    socket.on("error", () => {});
  });
  server.on("tlsClientError", () => {});
  return server;
}

async function withServer<T>(
  serverOpts: tls.TlsOptions,
  fn: (port: number, server: tls.Server) => Promise<T>,
  host?: string,
): Promise<T> {
  const server = fakeServer(serverOpts);
  server.listen(0, host);
  await once(server, "listening");
  try {
    return await fn((server.address() as AddressInfo).port, server);
  } finally {
    server.close();
  }
}

/** The SNI of every handshake the server completes; `false` when the client sent none. */
function recordServernames(server: tls.Server): (string | false)[] {
  const names: (string | false)[] = [];
  server.on("secureConnection", socket => names.push(socket.servername || false));
  return names;
}

async function ping(url: string, tlsOptions: Bun.RedisOptions["tls"]): Promise<unknown> {
  const client = new RedisClient(url, { autoReconnect: false, connectionTimeout: 5000, tls: tlsOptions });
  try {
    return await client.send("PING", []);
  } catch (e: any) {
    return e.code;
  } finally {
    client.close();
  }
}

async function withUnixServer<T>(
  serverOpts: tls.TlsOptions,
  fn: (socketPath: string, server: tls.Server) => Promise<T>,
): Promise<T> {
  using dir = tempDir("valkey-tls-unix", {});
  const socketPath = path.join(String(dir), "r.sock");
  const server = fakeServer(serverOpts);
  server.listen(socketPath);
  await once(server, "listening");
  try {
    return await fn(socketPath, server);
  } finally {
    server.close();
  }
}

describe("RedisClient TLS hostname verification", () => {
  test("rejects a CA-trusted cert whose hostname does not match the URL host", async () => {
    await withServer({ key: serverKey, cert: serverCert }, async port => {
      const client = new RedisClient(`rediss://localhost:${port}`, {
        autoReconnect: false,
        connectionTimeout: 5000,
        tls: {
          ca,
          rejectUnauthorized: true,
        },
      });
      let err: any;
      try {
        await client.send("PING", []);
      } catch (e) {
        err = e;
      } finally {
        client.close();
      }
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
      expect(err.message).toContain("localhost");
    });
  });

  test("rejects a CA-trusted cert whose altnames do not match an IP host", async () => {
    // The "harness" cert is valid for localhost/127.0.0.1. Connect via 127.0.0.1
    // to a server presenting the agent1 cert (CN=agent1, signed by ca1).
    await withServer({ key: serverKey, cert: serverCert }, async port => {
      const client = new RedisClient(`rediss://127.0.0.1:${port}`, {
        autoReconnect: false,
        connectionTimeout: 5000,
        tls: {
          ca,
          rejectUnauthorized: true,
        },
      });
      let err: any;
      try {
        await client.send("PING", []);
      } catch (e) {
        err = e;
      } finally {
        client.close();
      }
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
    });
  });

  test("still rejects invalid certificate chains when rejectUnauthorized is true", async () => {
    // Self-signed cert that the client does NOT trust.
    await withServer({ key: localhostTls.key, cert: localhostTls.cert }, async port => {
      const client = new RedisClient(`rediss://localhost:${port}`, {
        autoReconnect: false,
        connectionTimeout: 5000,
        tls: {
          rejectUnauthorized: true,
        },
      });
      let err: any;
      try {
        await client.send("PING", []);
      } catch (e) {
        err = e;
      } finally {
        client.close();
      }
      expect(err).toBeInstanceOf(Error);
      // Should be the BoringSSL verify error, not the hostname error.
      expect(err.code).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
      expect(err.message).toContain("self signed certificate");
    });
  });

  test("allows mismatched hostname when rejectUnauthorized is false", async () => {
    await withServer({ key: serverKey, cert: serverCert }, async port => {
      const client = new RedisClient(`rediss://localhost:${port}`, {
        autoReconnect: false,
        connectionTimeout: 5000,
        tls: {
          ca,
          rejectUnauthorized: false,
        },
      });
      try {
        const result = await client.send("PING", []);
        expect(result).toBe("PONG");
      } finally {
        client.close();
      }
    });
  });

  test.skipIf(!isIPv6())("accepts a cert whose IP altnames match a bracketed IPv6 URL host", async () => {
    // The "harness" cert has SAN IP:::1. URL.host() serialises IPv6 literals
    // with brackets ("[::1]"), which must be stripped before IP SAN matching.
    await withServer(
      { key: localhostTls.key, cert: localhostTls.cert },
      async port => {
        const client = new RedisClient(`rediss://[::1]:${port}`, {
          autoReconnect: false,
          connectionTimeout: 5000,
          tls: {
            ca: localhostTls.cert,
            rejectUnauthorized: true,
          },
        });
        try {
          const result = await client.send("PING", []);
          expect(result).toBe("PONG");
        } finally {
          client.close();
        }
      },
      "::1",
    );
  });

  test("accepts a cert whose altnames match the URL host", async () => {
    // The "harness" cert has SAN: DNS:localhost, IP:127.0.0.1, IP:::1
    await withServer({ key: localhostTls.key, cert: localhostTls.cert }, async port => {
      const client = new RedisClient(`rediss://localhost:${port}`, {
        autoReconnect: false,
        connectionTimeout: 5000,
        tls: {
          ca: localhostTls.cert,
          rejectUnauthorized: true,
        },
      });
      try {
        const result = await client.send("PING", []);
        expect(result).toBe("PONG");
      } finally {
        client.close();
      }
    });
  });

  test.skipIf(isWindows)("skips hostname verification for redis+tls+unix:// sockets", async () => {
    // Unix-domain sockets have no hostname; a CA-trusted cert for the wrong
    // CN must still be accepted as long as the chain validates.
    await withUnixServer({ key: serverKey, cert: serverCert }, async socketPath => {
      const client = new RedisClient(`redis+tls+unix://${socketPath}`, {
        autoReconnect: false,
        connectionTimeout: 5000,
        tls: {
          ca,
          rejectUnauthorized: true,
        },
      });
      try {
        const result = await client.send("PING", []);
        expect(result).toBe("PONG");
      } finally {
        client.close();
      }
    });
  });
});

describe("RedisClient tls.serverName", () => {
  const localhost = { key: localhostTls.key, cert: localhostTls.cert };

  test("the URL host is the SNI, unless it is an IP literal", async () => {
    await withServer(localhost, async (port, server) => {
      const servernames = recordServernames(server);
      expect(await ping(`rediss://localhost:${port}`, { ca: localhostTls.cert })).toBe("PONG");
      expect(await ping(`rediss://127.0.0.1:${port}`, { ca: localhostTls.cert })).toBe("PONG");
      expect(await ping(`rediss://localhost:${port}`, { ca: localhostTls.cert, serverName: "127.0.0.1" })).toBe("PONG");
      expect(servernames).toEqual(["localhost", false, false]);
    });
  });

  // The zone id names an interface of the client, so the certificate has the address alone.
  test("an IPv6 address with a zone id is verified against the IP SAN of the address and is not sent as SNI", async () => {
    await withServer(localhost, async (port, server) => {
      const servernames = recordServernames(server);
      expect(await ping(`rediss://localhost:${port}`, { ca: localhostTls.cert, serverName: "::1%lo" })).toBe("PONG");
      expect(servernames).toEqual([false]);
    });
  });

  test("tls: true sends the URL host as SNI", async () => {
    const servernames: string[] = [];
    const SNICallback: tls.TlsOptions["SNICallback"] = (servername, callback) => {
      servernames.push(servername);
      callback(null);
    };
    await withServer({ ...localhost, SNICallback }, async port => {
      expect(await ping(`rediss://localhost:${port}`, true)).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
      expect(servernames).toEqual(["localhost"]);
    });
  });

  test("every dial sends the SNI", async () => {
    await withServer(localhost, async (port, server) => {
      const servernames = recordServernames(server);
      const client = new RedisClient(`rediss://localhost:${port}`, { tls: { ca: localhostTls.cert } });
      try {
        await client.connect();
        client.close();
        await client.connect();
      } finally {
        client.close();
      }
      expect(servernames).toEqual(["localhost", "localhost"]);
    });
  });

  // `servername` is the node:tls spelling. The server's certificate is for agent1 only.
  test.each(["serverName", "servername"] as const)(
    "%s is the SNI and the name the certificate is verified against",
    async key => {
      await withServer({ key: serverKey, cert: serverCert }, async (port, server) => {
        const servernames = recordServernames(server);
        expect(await ping(`rediss://127.0.0.1:${port}`, { ca, [key]: "agent1" })).toBe("PONG");
        expect(servernames).toEqual(["agent1"]);
      });
    },
  );

  test("a serverName the certificate is not for is refused, whatever the URL host", async () => {
    await withServer(localhost, async port => {
      expect(await ping(`rediss://localhost:${port}`, { ca: localhostTls.cert, serverName: "agent1" })).toBe(
        "ERR_TLS_CERT_ALTNAME_INVALID",
      );
    });
  });

  test.skipIf(isWindows)("a unix socket has the name serverName gives it", async () => {
    await withUnixServer({ key: serverKey, cert: serverCert }, async (socketPath, server) => {
      const servernames = recordServernames(server);
      expect(await ping(`redis+tls+unix://${socketPath}`, { ca, serverName: "agent1" })).toBe("PONG");
      expect(await ping(`redis+tls+unix://${socketPath}`, { ca, serverName: "agent2" })).toBe(
        "ERR_TLS_CERT_ALTNAME_INVALID",
      );
      expect(servernames).toEqual(["agent1"]);
    });
  });
});

describe("RedisClient tls.checkServerIdentity", () => {
  const agent1 = { key: serverKey, cert: serverCert };
  const localhost = { key: localhostTls.key, cert: localhostTls.cert };
  const refusal = () => Object.assign(new Error("refused"), { code: "PIN" });

  // `localhost` is dialed on both families. Only one may answer, or the first connection can be the one that is dropped.
  const withIPv4Server = <T>(fn: (port: number, server: tls.Server) => Promise<T>) =>
    withServer(agent1, fn, "127.0.0.1");

  /** Resolves with the bytes the server read from its first connection, once that has closed. */
  function bytesOfFirstConnection(server: tls.Server): Promise<number> {
    let bytes = 0;
    server.once("secureConnection", socket => socket.on("data", chunk => (bytes += chunk.length)));
    return once(server, "connection").then(
      ([socket]) => new Promise(resolve => socket.once("close", () => resolve(bytes))),
    );
  }

  test.each<[string, () => any, string]>([
    ["returns undefined", () => undefined, "PONG"],
    ["returns an Error", refusal, "PIN"],
    ["is async", async () => undefined, "ERR_INVALID_RETURN_VALUE"],
  ])("replaces the name check when it %s", async (_, verdict, expected) => {
    await withIPv4Server(async (port, server) => {
      const bytes = bytesOfFirstConnection(server);
      const calls: string[][] = [];
      const checkServerIdentity = (hostname: string, cert: tls.PeerCertificate) => {
        calls.push([hostname, cert.subject.CN as string]);
        return verdict();
      };
      expect(await ping(`rediss://localhost:${port}`, { ca, checkServerIdentity })).toBe(expected);
      expect({ calls, sent: (await bytes) > 0 }).toEqual({
        calls: [["localhost", "agent1"]],
        sent: expected === "PONG",
      });
    });
  });

  test.each<[unknown]>([[new Error("thrown")], ["text"], [undefined]])(
    "throws %p: connect(), the command and onclose get it",
    async thrown => {
      await withServer(agent1, async port => {
        const checkServerIdentity = () => {
          throw thrown;
        };
        const client = new RedisClient(`rediss://localhost:${port}`, { tls: { ca, checkServerIdentity } });
        const onclose = mock((_: unknown) => {});
        client.onclose = onclose;
        const settled = await Promise.allSettled([client.connect(), client.ping()]);
        const rejected = { status: "rejected", reason: thrown };
        expect({ settled, closes: onclose.mock.calls }).toStrictEqual({
          settled: [rejected, rejected],
          closes: [[thrown]],
        });
      });
    },
  );

  test.skipIf(isWindows)("gets localhost as the name of a unix socket", async () => {
    await withUnixServer(agent1, async socketPath => {
      const checkServerIdentity = mock((_: string) => undefined);
      expect(await ping(`redis+tls+unix://${socketPath}`, { ca, checkServerIdentity })).toBe("PONG");
      expect(checkServerIdentity.mock.calls.map(([hostname]) => hostname)).toEqual(["localhost"]);
    });
  });

  test.each<[string, Bun.TLSOptions, string]>([
    ["it is the only option and the chain does not verify", {}, "UNABLE_TO_VERIFY_LEAF_SIGNATURE"],
    ["rejectUnauthorized is false", { ca, rejectUnauthorized: false }, "PONG"],
  ])("is not called when %s", async (_, options, expected) => {
    await withServer(agent1, async port => {
      const checkServerIdentity = mock(refusal);
      expect(await ping(`rediss://localhost:${port}`, { ...options, checkServerIdentity })).toBe(expected);
      expect(checkServerIdentity).not.toHaveBeenCalled();
    });
  });

  test.each<[any]>([[{}], ["text"], [false]])("is %p: the constructor throws", checkServerIdentity => {
    expect(() => new RedisClient("rediss://localhost", { tls: { ca, checkServerIdentity } })).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        message: expect.stringContaining("tls.checkServerIdentity"),
      }),
    );
  });

  test.each<[any]>([[undefined], [null]])("is %p: the name check stays", async checkServerIdentity => {
    await withServer(agent1, async port => {
      expect(await ping(`rediss://localhost:${port}`, { ca, checkServerIdentity })).toBe(
        "ERR_TLS_CERT_ALTNAME_INVALID",
      );
    });
  });

  test("is called for every connection, also of a duplicate", async () => {
    await withServer(agent1, async port => {
      const checkServerIdentity = mock(() => undefined);
      const client = new RedisClient(`rediss://localhost:${port}`, { tls: { ca, checkServerIdentity } });
      await client.connect();
      client.close();
      await client.connect();
      Bun.gc(true);
      (await client.duplicate()).close();
      client.close();
      expect(checkServerIdentity).toHaveBeenCalledTimes(3);
    });
  });

  test.each<[string, () => any]>([
    ["accepts", () => undefined],
    ["refuses", refusal],
  ])(
    "closes the client, connects again and %s: the verdict is not applied to the next connection",
    async (_, first) => {
      await withIPv4Server(async (port, server) => {
        const bytes = bytesOfFirstConnection(server);
        let second: Promise<unknown> | undefined;
        const checkServerIdentity = mock(() => {
          if (second) return;
          client.close();
          second = client.connect();
          return first();
        });
        const client = new RedisClient(`rediss://localhost:${port}`, { tls: { ca, checkServerIdentity } });
        try {
          await expect(client.connect()).rejects.toMatchObject({ code: "ERR_REDIS_CONNECTION_CLOSED" });
          expect(await second).toBe("OK");
          expect(checkServerIdentity).toHaveBeenCalledTimes(2);
          expect(await bytes).toBe(0);
        } finally {
          client.close();
        }
      });
    },
  );

  test("gets the URL host, or serverName", async () => {
    await withServer(agent1, async port => {
      const calls: [string, string][] = [];
      const checkServerIdentity = (hostname: string, cert: tls.PeerCertificate) =>
        void calls.push([hostname, cert.subject.CN as string]);
      expect(await ping(`rediss://127.0.0.1:${port}`, { ca, checkServerIdentity })).toBe("PONG");
      expect(await ping(`rediss://127.0.0.1:${port}`, { ca, checkServerIdentity, serverName: "other" })).toBe("PONG");
      expect(calls).toEqual([
        ["127.0.0.1", "agent1"],
        ["other", "agent1"],
      ]);
    });
  });

  test("is asked by duplicate() too", async () => {
    await withServer(localhost, async port => {
      let calls = 0;
      const client = new RedisClient(`rediss://127.0.0.1:${port}`, {
        autoReconnect: false,
        tls: { ca: localhostTls.cert, checkServerIdentity: () => (calls++ === 0 ? undefined : refusal()) },
      });
      try {
        await client.connect();
        expect(await client.duplicate().then(String, e => e.code)).toBe("PIN");
        expect(calls).toBe(2);
      } finally {
        client.close();
      }
    });
  });

  test.each([
    ["returns an error", () => refusal()],
    ["closes the client", (client: RedisClient) => client.close()],
    [
      "returns an error and closes the client in a microtask",
      (client: RedisClient) => (queueMicrotask(() => client.close()), refusal()),
    ],
  ])("keeps the client certificate from a TLS 1.3 server when it %s", async (_, check) => {
    await withServer({ ...localhost, requestCert: true, rejectUnauthorized: false }, async (port, server) => {
      let handshakes = 0;
      const closed = Promise.withResolvers();
      server.on("connection", socket => socket.on("close", closed.resolve));
      server.on("secureConnection", () => handshakes++);
      const client = new RedisClient(`rediss://127.0.0.1:${port}`, {
        autoReconnect: false,
        tls: { ...agent1, ca: localhostTls.cert, checkServerIdentity: () => check(client) as any },
      });
      await Promise.all([client.connect().then(client.close.bind(client), () => {}), closed.promise]);
      expect(handshakes).toBe(0);
    });
  });

  test.skipIf(!nodeExe())("is asked once, also when the server renegotiates while it runs the event loop", async () => {
    // Bun's server can't renegotiate.
    await using node = Bun.spawn({
      cmd: [
        nodeExe()!,
        "-e",
        `const { promise, resolve } = Promise.withResolvers();
        const secure = require("tls").createServer({ ...JSON.parse(process.env.CERT), maxVersion: "TLSv1.2" }, resolve);
        const control = require("net").createServer(test => test.once("data", async () => {
          const socket = await promise;
          let received = 0;
          socket.on("data", chunk => (received += chunk.length)).on("error", () => {});
          socket.on("close", () => test.end(" received " + received));
          socket.renegotiate({}, () => socket.write("+OK\\r\\n", () => test.write("renegotiated")));
        }));
        secure.listen(0, "127.0.0.1", () => control.listen(0, "127.0.0.1", () => {
          console.log(secure.address().port + " " + control.address().port);
        }));`,
      ],
      env: { ...bunEnv, CERT: JSON.stringify(localhost) },
    });
    let ports = "";
    for await (const chunk of node.stdout) if ((ports += Buffer.from(chunk)).includes("\n")) break;
    const [port, controlPort] = ports.trim().split(" ");
    const control = net.connect(+controlPort, "127.0.0.1");
    let heard = "";
    control.on("data", chunk => (heard += chunk));
    const ended = once(control, "end");
    await once(control, "connect");

    let calls = 0;
    const checkServerIdentity = () => {
      if (calls++ > 0) return;
      runEventLoopUntil(async () => {
        control.write("renegotiate");
        await once(control, "data");
        await loopbackFence();
      });
      return refusal();
    };
    expect(await ping(`rediss://127.0.0.1:${port}`, { ca: localhostTls.cert, checkServerIdentity })).toBe("PIN");
    await ended;
    expect({ calls, heard }).toEqual({ calls: 1, heard: "renegotiated received 0" });
  });

  test.concurrent("a duplicate refuses every server once the graph of the function is disposed", async () => {
    using dir = tempDir("valkey-tls-graph", {
      "tenant.mjs": `export const make = (url, ca) => new Bun.RedisClient(url, { tls: { ca, checkServerIdentity() {} } });`,
      "main.mjs": `
        const graph = new Bun.ModuleGraph();
        const { make } = await graph.import(import.meta.dir + "/tenant.mjs");
        const duplicate = await graph.run(() => make(process.env.URL, process.env.CA)).duplicate();
        const connect = () => duplicate.connect().then(() => "connected", e => e.code).finally(() => duplicate.close());
        console.log(await connect());
        graph.dispose();
        console.log(await connect());
      `,
    });
    await withServer(agent1, async port => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "main.mjs"],
        cwd: String(dir),
        env: { ...bunEnv, URL: `rediss://127.0.0.1:${port}`, CA: String(ca) },
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(stdout).toBe("connected\nERR_TLS_CERT_ALTNAME_INVALID\n");
      expect(exitCode).toBe(0);
    });
  });
});

describe.concurrent("RedisClient and the TLS defaults of the process", () => {
  async function run(program: string, files = {}) {
    using dir = tempDir("valkey-tls-defaults", files);
    return await withServer({ key: serverKey, cert: serverCert }, async port => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const url = "rediss://127.0.0.1:${port}";
          const settle = (client, promise) => promise.then(() => "connected", e => e.code).finally(() => client.close());
          ${program}`,
        ],
        cwd: String(dir),
        env: { ...bunEnv, CA: String(ca) },
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      return { stdout, exitCode };
    });
  }

  test.each([
    ["{ ca: process.env.CA }", "ERR_TLS_CERT_ALTNAME_INVALID"],
    [`{ ca: process.env.CA, checkServerIdentity: () => ({ code: "REFUSED" }) }`, "REFUSED"],
    ["{ checkServerIdentity() {} }", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"],
  ])("tls: %s reads NODE_TLS_REJECT_UNAUTHORIZED in the constructor", async (options, code) => {
    const result = await run(`
      for (const [first, later] of [["1", "0"], ["0", "1"]]) {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = first;
        const client = new Bun.RedisClient(url, { tls: ${options} });
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = later;
        console.log(await settle(client, client.connect()));
      }
    `);
    expect(result).toEqual({ stdout: `${code}\nconnected\n`, exitCode: 0 });
  });

  test("a default that its options override does not make it read its files again", async () => {
    const result = await run(
      `const client = new Bun.RedisClient(url, { tls: { caFile: "ca.pem", serverName: "agent1" } });
      console.log(await settle(client, client.connect()));
      require("fs").unlinkSync("ca.pem");
      require("tls").setDefaultCACertificates([]);
      console.log(await settle(client, client.connect()));`,
      { "ca.pem": ca },
    );
    expect(result).toEqual({ stdout: "connected\nconnected\n", exitCode: 0 });
  });

  test("a default that it uses counts from the next dial", async () => {
    const result = await run(
      `const client = new Bun.RedisClient(url, { tls: { serverName: "agent1" } });
      for (const certs of [[process.env.CA], []]) {
        require("tls").setDefaultCACertificates(certs);
        console.log(await settle(client, client.connect()));
      }`,
    );
    expect(result).toEqual({ stdout: "connected\nUNABLE_TO_VERIFY_LEAF_SIGNATURE\n", exitCode: 0 });
  });
});
