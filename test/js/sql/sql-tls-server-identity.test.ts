import { SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { describeWithContainer, tls as localhostTls } from "harness";
import { X509Certificate } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import type net from "node:net";
import path from "node:path";
import tls from "node:tls";
import { Worker } from "node:worker_threads";
import {
  MYSQL_CLIENT_SSL,
  MYSQL_DEFAULT_CAPABILITIES,
  listeningServer,
  mysqlAckSessionSetup,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlReadPackets,
  pgAuthenticationOk,
  pgReadyForQuery,
  pgSSLResponse,
} from "./wire-frames";

// CN=agent1 (no SAN), signed by ca1: trusted through `ca1`, valid for no host the tests dial.
const fixtures = path.join(import.meta.dirname, "..", "node", "tls", "fixtures");
const agent1 = {
  key: fs.readFileSync(path.join(fixtures, "agent1-key.pem"), "utf8"),
  cert: fs.readFileSync(path.join(fixtures, "agent1-cert.pem"), "utf8"),
  ca: fs.readFileSync(path.join(fixtures, "ca1-cert.pem"), "utf8"),
};
// The harness certificate: CN=server-bun, SAN localhost / 127.0.0.1 / ::1, self-signed.
const localhost = { key: localhostTls.key, cert: localhostTls.cert, ca: localhostTls.cert };

type ServerCert = { key: string; cert: string };
type MockServer = {
  url: string;
  /** Resolves when the first TLS connection closes, with the number of bytes the client sent inside TLS. */
  bytesInsideTls: Promise<number>;
  close(): void;
};

/** Bytes already buffered past the plaintext prelude are TLS records: they go to the TLS engine. */
function upgrade(rawSocket: net.Socket, cert: ServerCert, leftover: Buffer, closed: (bytes: number) => void) {
  rawSocket.pause();
  if (leftover.length) rawSocket.unshift(leftover);
  const socket = new tls.TLSSocket(rawSocket, { isServer: true, ...cert });
  let bytes = 0;
  socket.on("data", (chunk: Buffer) => (bytes += chunk.length));
  socket.on("close", () => closed(bytes));
  socket.on("error", () => {});
  return socket;
}

/** Answers SSLRequest with 'S', upgrades, then accepts any StartupMessage. */
async function postgresServer(cert: ServerCert): Promise<MockServer> {
  const closed = Promise.withResolvers<number>();
  const { server, port } = await listeningServer(rawSocket => {
    rawSocket.on("error", () => {});
    let buffered = Buffer.alloc(0);
    const onPlainData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length < 8) return;
      rawSocket.removeListener("data", onPlainData);
      rawSocket.write(pgSSLResponse("S"));
      const socket = upgrade(rawSocket, cert, buffered.subarray(8), closed.resolve);
      socket.once("data", () => socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()])));
    };
    rawSocket.on("data", onPlainData);
  });
  return { url: `postgres://u@127.0.0.1:${port}/db`, bytesInsideTls: closed.promise, close: () => server.close() };
}

/** Advertises CLIENT_SSL, upgrades after the SSLRequest packet, then accepts the login. */
async function mysqlServer(cert: ServerCert): Promise<MockServer> {
  const closed = Promise.withResolvers<number>();
  const { server, port } = await listeningServer(rawSocket => {
    rawSocket.on("error", () => {});
    rawSocket.write(mysqlHandshakeV10({ capabilities: MYSQL_DEFAULT_CAPABILITIES | MYSQL_CLIENT_SSL }));
    let buffered = Buffer.alloc(0);
    const onPlainData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length < 4) return;
      const length = buffered[0] | (buffered[1] << 8) | (buffered[2] << 16);
      if (buffered.length < 4 + length) return;
      const leftover = buffered.subarray(4 + length);
      buffered = Buffer.alloc(0);
      rawSocket.removeListener("data", onPlainData);
      const socket = upgrade(rawSocket, cert, leftover, closed.resolve);
      let authed = false;
      socket.on("data", (chunk: Buffer) => {
        buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (seq, payload) => {
          if (!authed) {
            authed = true;
            socket.write(mysqlOkPacket(seq + 1));
            return;
          }
          if (!mysqlAckSessionSetup(socket, payload)) socket.end();
        });
      });
    };
    rawSocket.on("data", onPlainData);
  });
  return { url: `mysql://u@127.0.0.1:${port}/db`, bytesInsideTls: closed.promise, close: () => server.close() };
}

async function connect(url: string, tlsOptions: Bun.SQL.Options["tls"], sslmode = "verify-full"): Promise<unknown> {
  await using sql = new SQL({ url: `${url}?sslmode=${sslmode}`, tls: tlsOptions, max: 1, idleTimeout: 1 });
  return await sql.connect().then(
    () => "CONNECTED",
    e => e,
  );
}

describe.concurrent.each([
  ["PostgreSQL", "postgres", postgresServer],
  ["MySQL", "mysql", mysqlServer],
] as const)("%s", (_, scheme, startServer) => {
  async function withServer<T>(cert: ServerCert, fn: (server: MockServer) => Promise<T>): Promise<T> {
    const server = await startServer(cert);
    try {
      return await fn(server);
    } finally {
      server.close();
    }
  }

  test("is called once with the hostname and the leaf certificate; the Error it returns fails the connection before anything is sent", async () => {
    await withServer(localhost, async server => {
      const calls: unknown[][] = [];
      const pin = new Error("PIN_MISMATCH");
      const err = await connect(server.url, {
        ca: localhost.ca,
        checkServerIdentity: (hostname: string, cert: tls.PeerCertificate) => {
          calls.push([hostname, cert.subject.CN, cert.fingerprint256, cert.raw]);
          return pin;
        },
      });
      expect(err).toBe(pin);
      const expected = new X509Certificate(localhost.cert);
      expect(calls).toEqual([["127.0.0.1", "server-bun", expected.fingerprint256, expected.raw]]);
      expect(await server.bytesInsideTls).toBe(0);
    });
  });

  test("what it throws fails the connection before anything is sent", async () => {
    await withServer(localhost, async server => {
      const thrown = new TypeError("from checkServerIdentity");
      const err = await connect(server.url, {
        ca: localhost.ca,
        checkServerIdentity: () => {
          throw thrown;
        },
      });
      expect(err).toBe(thrown);
      expect(await server.bytesInsideTls).toBe(0);
    });
  });

  test("replaces the built-in hostname check, and gets tls.serverName as the hostname", async () => {
    await withServer(agent1, async server => {
      expect(await connect(server.url, { ca: agent1.ca })).toMatchObject({ code: "ERR_TLS_CERT_ALTNAME_INVALID" });
    });
    await withServer(agent1, async server => {
      const calls: string[][] = [];
      const checkServerIdentity = (hostname: string, cert: tls.PeerCertificate) =>
        void calls.push([hostname, cert.subject.CN]);
      expect(await connect(server.url, { ca: agent1.ca, checkServerIdentity })).toBe("CONNECTED");
      expect(await connect(server.url, { ca: agent1.ca, serverName: "other", checkServerIdentity })).toBe("CONNECTED");
      expect(calls).toEqual([
        ["127.0.0.1", "agent1"],
        ["other", "agent1"],
      ]);
    });
  });

  test("also runs under sslmode=verify-ca", async () => {
    await withServer(agent1, async server => {
      const pin = new Error("PIN_MISMATCH");
      expect(await connect(server.url, { ca: agent1.ca, checkServerIdentity: () => pin }, "verify-ca")).toBe(pin);
    });
  });

  test("asks for certificate verification like tls.ca, and is not called when the chain does not verify", async () => {
    await withServer(localhost, async server => {
      let calls = 0;
      const err = await connect(server.url, { checkServerIdentity: () => void calls++ }, "prefer");
      expect(err).toMatchObject({ code: "DEPTH_ZERO_SELF_SIGNED_CERT" });
      expect(calls).toBe(0);
    });
  });

  test("is not called next to rejectUnauthorized: false", async () => {
    await withServer(agent1, async server => {
      let calls = 0;
      const checkServerIdentity = () => (calls++, new Error("unreachable"));
      const options = { ca: agent1.ca, rejectUnauthorized: false, checkServerIdentity };
      expect(await connect(server.url, options, "require")).toBe("CONNECTED");
      expect(calls).toBe(0);
    });
  });

  // Node refuses the server for every truthy return value, so an `async` callback cannot accept it by accident.
  test.each([
    ["a Promise (async callback)", async () => undefined, "an instance of Promise"],
    ["a string", () => "PIN_MISMATCH", "type string ('PIN_MISMATCH')"],
    ["true", () => true, "type boolean (true)"],
  ] as const)("%s fails the connection", async (_, callback, received) => {
    await withServer(localhost, async server => {
      const err: any = await connect(server.url, { ca: localhost.ca, checkServerIdentity: callback as any });
      expect({ name: err?.name, code: err?.code, message: err?.message }).toEqual({
        name: "TypeError",
        code: "ERR_INVALID_RETURN_VALUE",
        message: `Expected undefined or an Error to be returned from the "tls.checkServerIdentity" function but got ${received}.`,
      });
      expect(await server.bytesInsideTls).toBe(0);
    });
  });

  test("an object that is not an Error fails the connection with that object", async () => {
    await withServer(localhost, async server => {
      const reason = { code: "PIN_MISMATCH" };
      expect(await connect(server.url, { ca: localhost.ca, checkServerIdentity: (() => reason) as any })).toBe(reason);
    });
  });

  test.each([null, false, 0, ""])("%p accepts the server", async value => {
    await withServer(localhost, async server => {
      const checkServerIdentity = (() => value) as any;
      expect(await connect(server.url, { ca: localhost.ca, checkServerIdentity })).toBe("CONNECTED");
    });
  });

  test.each([
    // Lets the connect() in flight finish first: the callback approved the server, so the login may go out.
    ["close()", undefined, false],
    // Tears the connection down inside the callback.
    ["close({ timeout: 0 })", { timeout: 0 }, true],
  ] as const)("a callback that calls %s leaves the client closed", async (_, closeOptions, nothingIsSent) => {
    await withServer(localhost, async server => {
      let calls = 0;
      const sql = new SQL({
        url: `${server.url}?sslmode=verify-full`,
        max: 1,
        idleTimeout: 1,
        tls: {
          ca: localhost.ca,
          checkServerIdentity: () => {
            calls++;
            void sql.close(closeOptions);
            return undefined;
          },
        },
      });
      // The pool decides how a connect in flight settles; the client must end up closed.
      await sql.connect().catch(() => {});
      const err: any = await sql`select 1`.then(
        () => null,
        e => e,
      );
      expect({ calls, code: err?.code }).toEqual({ calls: 1, code: `ERR_${scheme.toUpperCase()}_CONNECTION_CLOSED` });
      if (nothingIsSent) expect(await server.bytesInsideTls).toBe(0);
    });
  });

  test("a worker terminated inside the callback sends nothing to the server", async () => {
    await withServer(localhost, async server => {
      const counters = new SharedArrayBuffer(12);
      const count = new Int32Array(counters);
      const worker = new Worker(new URL("./sql-tls-server-identity-worker-fixture.ts", import.meta.url), {
        workerData: { url: `${server.url}?sslmode=verify-full`, ca: localhost.ca, counters },
      });
      const exited = once(worker, "exit");
      await Promise.race([
        Atomics.waitAsync(count, 0, 0).value,
        once(worker, "error").then(([error]) => Promise.reject(error)),
        exited.then(([code]) => Promise.reject(new Error(`the worker exited with code ${code} before the callback`))),
      ]);
      await worker.terminate();
      const [bytesInsideTls] = await Promise.all([server.bytesInsideTls, exited]);
      expect({ callbackEntered: count[0], oncloseRan: count[1], connectSettled: count[2], bytesInsideTls }).toEqual({
        callbackEntered: 1,
        oncloseRan: 0,
        connectSettled: 0,
        bytesInsideTls: 0,
      });
    });
  });
});

for (const { image, adapter, username, password, ca, certificate } of [
  {
    image: "postgres_tls",
    adapter: "postgres",
    username: "postgres",
    password: "",
    ca: path.join(import.meta.dir, "docker-tls", "server.crt"),
    certificate: path.join(import.meta.dir, "docker-tls", "server.crt"),
  },
  {
    image: "mysql_tls",
    adapter: "mysql",
    username: "root",
    password: "bun",
    ca: path.join(import.meta.dir, "mysql-tls", "ssl", "ca.pem"),
    certificate: path.join(import.meta.dir, "mysql-tls", "ssl", "server-cert.pem"),
  },
] as const) {
  describeWithContainer(image, { image, concurrent: true }, container => {
    const pinnedTo = (fingerprint256: string) =>
      new SQL({
        adapter,
        hostname: container.host,
        port: container.port,
        username,
        password,
        database: "bun_sql_test",
        max: 1,
        tls: {
          ca: Bun.file(ca),
          checkServerIdentity: (_: string, cert: tls.PeerCertificate) =>
            cert.fingerprint256 === fingerprint256 ? undefined : new Error(`pinned to ${fingerprint256}`),
        },
      });

    test("the server's own fingerprint connects", async () => {
      await container.ready;
      await using sql = pinnedTo(new X509Certificate(fs.readFileSync(certificate)).fingerprint256);
      expect(await sql`select 1 as x`).toEqual([{ x: 1 }]);
    });

    test("another fingerprint is refused", async () => {
      await container.ready;
      await using sql = pinnedTo("00:00");
      await expect(sql`select 1 as x`).rejects.toThrow("pinned to 00:00");
    });
  });
}
