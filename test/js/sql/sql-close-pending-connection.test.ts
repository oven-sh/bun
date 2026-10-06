// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.

// https://github.com/oven-sh/bun/issues/32095
//
// A forced pool close (`close({ timeout: "0" })`) must resolve even when a
// pool connection has been accepted at the TCP level but the database
// handshake has not completed yet (a database that is still starting up).
// Previously the pending queries were rejected but the promise returned by
// close() stayed pending forever: the native close path emitted no socket
// event for in-flight connects, so the JS onclose callback never fired.
//
// connectionTimeout: 0 disables the connect timer, so close() is the only
// thing that can tear the connection down — without the fix these tests hang.

import { SQL, type Socket } from "bun";
import { expect, mock, test } from "bun:test";
import { blackholePortSource, bunEnv, bunExe, isMusl, isWindows, tls as tlsCert } from "harness";
import net from "node:net";
import tls from "node:tls";
import {
  listeningServer,
  MYSQL_CLIENT_SSL,
  MYSQL_DEFAULT_CAPABILITIES,
  mysqlAckSessionSetup,
  mysqlErrPacket,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlRawPacket,
  mysqlReadPackets,
  neverAnsweringServer,
  pgAuthenticationOk,
  pgCommandComplete,
  pgDataRow,
  pgErrorResponse,
  pgReadFrontendMessages,
  pgReadyForQuery,
  pgRowDescription,
  pgSSLResponse,
} from "./wire-frames";

const drivers = [
  ["postgres", "postgres://postgres@", "ERR_POSTGRES_CONNECTION_CLOSED", "ERR_POSTGRES_CONNECTION_TIMEOUT"],
  ["mysql", "mysql://root@", "ERR_MYSQL_CONNECTION_CLOSED", "ERR_MYSQL_CONNECTION_TIMEOUT"],
] as const;

// How each protocol gets to TLS: what the server says first, how long the client's plaintext
// request for TLS is, and what the server answers it with. `refusal` turns the client's first
// message over TLS down.
const startTls = {
  postgres: {
    greeting: undefined,
    requestLength: 8,
    answer: pgSSLResponse("S"),
    refusal: pgErrorResponse({ S: "FATAL", C: "53300", M: "too many connections" }),
    refusalCode: "ERR_POSTGRES_SERVER_ERROR",
  },
  mysql: {
    greeting: mysqlHandshakeV10({ capabilities: MYSQL_DEFAULT_CAPABILITIES | MYSQL_CLIENT_SSL }),
    requestLength: 36,
    answer: undefined,
    refusal: mysqlErrPacket(3, 1040, "08004", "Too many connections"),
    refusalCode: "ERR_MYSQL_SERVER_ERROR",
  },
} as const;

/**
 * A server that completes the TLS handshake, takes the client's first message and from then on
 * reads nothing: a close_notify gets no answer. `silent` resolves once it has stopped reading,
 * to a function that sends the client `refusal`.
 */
async function silentAfterFirstMessageTlsServer(name: keyof typeof startTls) {
  const { greeting, requestLength, answer, refusal } = startTls[name];
  const silent = Promise.withResolvers<() => void>();
  const terminator = tls.createServer(tlsCert, socket => {
    socket.on("error", () => {});
    socket.once("data", () => silent.resolve(() => void socket.write(refusal)));
  });
  await new Promise<void>(resolve => terminator.listen(0, "127.0.0.1", resolve));
  const { port, server } = await listeningServer(client => {
    client.on("error", () => {});
    if (greeting) client.write(greeting);
    client.once("data", chunk => {
      if (answer) client.write(answer);
      const upstream = net.connect((terminator.address() as net.AddressInfo).port, "127.0.0.1");
      upstream.on("error", () => {});
      upstream.write(chunk.subarray(requestLength));
      client.pipe(upstream).pipe(client);
      silent.promise.then(() => {
        client.unpipe(upstream);
        client.pause();
      });
    });
  });
  return {
    port,
    silent: silent.promise,
    close() {
      server.close();
      terminator.close();
    },
  };
}

for (const [name, scheme, closedCode, timeoutCode] of drivers) {
  test(`${name}: forced close() resolves while a connection is mid-handshake`, async () => {
    const { port, server, accepted } = await neverAnsweringServer();
    try {
      const sql = new SQL({ url: `${scheme}127.0.0.1:${port}/db`, max: 1, connectionTimeout: 0 });
      const queryError = sql`SELECT 1`.catch(e => e);
      // the server holds the connection open without ever completing the
      // handshake, so the pool connection stays mid-handshake from here on
      await accepted;
      await sql.close({ timeout: "0" });
      expect((await queryError).code).toBe(closedCode);
    } finally {
      server.close();
    }
  });

  // https://github.com/oven-sh/bun/issues/39940
  //
  // close() used to fire the user's onclose callback once per pool slot in
  // the pending state, even when that slot's handshake never completed and
  // onconnect never fired, so onconnect/onclose pairing drifted by up to
  // `max` per pool close.
  test(`${name}: close() does not fire onclose for slots that never connected`, async () => {
    const { port, server, accepted } = await neverAnsweringServer();
    try {
      const onconnect = mock();
      const onclose = mock();
      const sql = new SQL({
        url: `${scheme}127.0.0.1:${port}/db`,
        max: 5,
        connectionTimeout: 0,
        onconnect,
        onclose,
      });
      const queryError = sql`SELECT 1`.catch(e => e);
      await accepted;
      await sql.close({ timeout: "0" });
      expect((await queryError).code).toBe(closedCode);
      expect(onconnect).not.toHaveBeenCalled();
      expect(onclose).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });

  test(`${name}: forced close() resolves when called before the native handle is stored`, async () => {
    const { port, server } = await neverAnsweringServer();
    try {
      const sql = new SQL({ url: `${scheme}127.0.0.1:${port}/db`, max: 1, connectionTimeout: 0 });
      const connectError = sql.connect().catch(e => e);
      // close in the same tick: the pool slot exists but its native handle
      // has not been assigned yet
      await sql.close({ timeout: "0" });
      expect((await connectError).code).toBe(closedCode);
    } finally {
      server.close();
    }
  });

  // The timeout closes a socket whose TCP connect is still in flight. The event loop ref the
  // connection holds is released by the socket event that close raises.
  test.skipIf(isWindows || isMusl)(
    `${name}: the process exits after the connection timeout of a dial that never completes`,
    async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          ${blackholePortSource}
          const sql = new Bun.SQL({ url: "${scheme}127.0.0.1:" + port + "/db", max: 1, connectionTimeout: 0.05 });
          console.log(await sql\`SELECT 1\`.catch(err => err.code));
          filler.destroy();
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
        stdout: timeoutCode + "\n",
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    },
  );

  // A graceful TLS close waits for the peer's close_notify. A connection that failed does not.
  test.each([
    ["close()", `await sql.close({ timeout: "0" });`, closedCode],
    ["the server's refusal", "", startTls[name].refusalCode],
  ])(`${name}: the process exits after %s of a TLS connection whose peer reads nothing more`, async (_, act, code) => {
    const server = await silentAfterFirstMessageTlsServer(name);
    try {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            const sql = new Bun.SQL({
              url: "${scheme}127.0.0.1:${server.port}/db",
              max: 1,
              tls: { rejectUnauthorized: false },
              connectionTimeout: 0,
            });
            const query = sql\`SELECT 1\`.catch(err => err.code);
            // The peer reads nothing more.
            await Bun.stdin.text();
            ${act}
            console.log(await query);
            `,
        ],
        env: bunEnv,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      const refuse = await server.silent;
      if (!act) refuse();
      proc.stdin.end();
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
        stdout: code + "\n",
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    } finally {
      server.close();
    }
  });
}

// A FIN in the middle of the TLS handshake used to come back as a failed handshake with no reason,
// and debug builds assert that an Error has a message.
test("giving up on a connection in the middle of its TLS handshake", async () => {
  const rows = drivers.map(([name, scheme]) => [
    scheme,
    startTls[name].greeting?.toString("hex") ?? "",
    startTls[name].requestLength,
    startTls[name].answer?.toString("hex") ?? "",
  ]);
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const net = require("node:net");
      async function giveUp([scheme, greeting, requestLength, answer], connectionTimeout) {
        const clientHello = Promise.withResolvers();
        const server = net.createServer(socket => {
          socket.unref();
          socket.write(Buffer.from(greeting, "hex"));
          let received = 0;
          socket.on("data", chunk => {
            if (received < requestLength && received + chunk.length >= requestLength) socket.write(Buffer.from(answer, "hex"));
            received += chunk.length;
            // The server never speaks TLS.
            if (received > requestLength) clientHello.resolve();
          });
        });
        await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
        server.unref();
        const sql = new Bun.SQL({
          url: scheme + "127.0.0.1:" + server.address().port + "/db",
          max: 1,
          tls: { rejectUnauthorized: false },
          connectionTimeout,
        });
        const query = sql\`SELECT 1\`.catch(err => err.code);
        if (!connectionTimeout) {
          await clientHello.promise;
          await sql.close({ timeout: "0" });
        }
        return query;
      }
      const rows = ${JSON.stringify(rows)};
      console.log((await Promise.all(rows.flatMap(row => [giveUp(row, 1), giveUp(row, 0)]))).join("\\n"));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim().split("\n"), stderr, exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: drivers.flatMap(([, , closedCode, timeoutCode]) => [timeoutCode, closedCode]),
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});

// https://github.com/oven-sh/bun/issues/39940
//
// The per-slot "fired onconnect" marker is per connect cycle. A slot that
// connected once, closed, and is now redialing must not reuse the marker from
// the previous cycle: a forced close() that lands mid-reconnect used to fire
// a second onclose for a cycle whose onconnect never fired.
test("postgres: close() mid-reconnect does not fire onclose for the unfinished cycle", async () => {
  const firstClose = Promise.withResolvers<void>();
  const onconnect = mock();
  const onclose = mock(() => firstClose.resolve());
  const secondAccepted = Promise.withResolvers<void>();
  let firstSocket: import("node:net").Socket;
  let connections = 0;
  const { port, server } = await listeningServer(socket => {
    if (++connections === 1) {
      firstSocket = socket;
      // complete the handshake so the slot fires onconnect
      socket.once("data", () => socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()])));
    } else {
      // the reconnect stays mid-handshake
      secondAccepted.resolve();
    }
  });
  try {
    const sql = new SQL({
      url: `postgres://postgres@127.0.0.1:${port}/postgres`,
      max: 1,
      connectionTimeout: 0,
      onconnect,
      onclose,
    });
    await sql.connect();
    expect(onconnect).toHaveBeenCalledTimes(1);
    // drop the connection from the server side; onclose pairs with onconnect
    firstSocket!.destroy();
    await firstClose.promise;
    expect(onclose).toHaveBeenCalledTimes(1);
    // a new query redials the closed slot, then close() lands mid-handshake
    const queryError = sql`SELECT 1`.catch(e => e);
    await secondAccepted.promise;
    await sql.close({ timeout: "0" });
    expect((await queryError).code).toBe("ERR_POSTGRES_CONNECTION_CLOSED");
    expect(onconnect).toHaveBeenCalledTimes(1);
    expect(onclose).toHaveBeenCalledTimes(1);
  } finally {
    server.close();
  }
});

// https://github.com/oven-sh/bun/issues/32198
//
// The pool's connection array is allocated as `new Array(max)` and filled one
// slot at a time when the pool starts. A function-valued `password` option
// runs synchronously during that fill, so pool methods re-entered from it
// used to dereference unassigned slots and throw a raw TypeError.
test("pool scans tolerate unassigned connection slots during pool start", async () => {
  const { port, server } = await neverAnsweringServer();
  let passwordCalls = 0;
  const errors: unknown[] = [];
  const sql = new SQL({
    adapter: "postgres",
    hostname: "127.0.0.1",
    port,
    username: "u",
    database: "d",
    max: 2,
    connectionTimeout: 0,
    password: () => {
      passwordCalls++;
      try {
        sql.flush();
      } catch (e) {
        errors.push(e);
      }
      try {
        sql.connect().catch(() => {});
      } catch (e) {
        errors.push(e);
      }
      return "";
    },
  });
  try {
    sql.connect().catch(() => {});
    // the pool-start fill loop runs synchronously inside connect(), invoking
    // password() once per pool slot
    expect(passwordCalls).toBe(2);
    expect(errors).toEqual([]);
  } finally {
    // force an immediate close even with waiters queued
    await sql.close({ timeout: "0" });
    server.close();
  }
});

// Closing a TLS connection does not depend on the peer: not on one that never answers the
// close_notify, nor on one that answers late. Bun.listen peers, because a node:tls one always
// ends its own side when the close_notify arrives.
type TlsPeer = {
  port: number;
  // TLS connections accepted so far
  connections: number;
  // the first close_notify from a client, and the first connection this side closed
  ended: Promise<void>;
  closed: Promise<void>;
  [Symbol.dispose](): void;
};

// the plaintext socket's state: the SSL request bytes so far, then "upgraded"
type RawData = Buffer | "upgraded" | undefined;

type PeerConnection = {
  data(socket: Socket, chunk: Buffer): void;
  // what the peer does with the client's close_notify
  end(socket: Socket): void;
};

// Stays silent. The probe write only fails, and so only closes this side, once
// the client's fd is gone: the kernel answers it with a reset.
const holdOpen = (socket: Socket) => void socket.write("probe");
// What a server does: it closes its side too.
const closeBack = (socket: Socket) => void socket.end();

function tlsPeer(
  greeting: Buffer | null,
  // the length of the client's plaintext SSL request, once enough of it has arrived to tell
  sslRequestLength: (buffered: Buffer) => number | undefined,
  // answers the complete plaintext SSL request
  onSslRequest: (raw: Socket<RawData>) => void,
  // called once for each connection
  connect: () => PeerConnection,
): TlsPeer {
  const ended = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<void>();
  const listener = Bun.listen<RawData>({
    hostname: "127.0.0.1",
    port: 0,
    allowHalfOpen: true,
    socket: {
      open(raw) {
        if (greeting) raw.write(greeting);
      },
      data(raw, chunk) {
        // the raw socket keeps observing bytes after the upgrade
        if (raw.data === "upgraded") return;
        const buffered = raw.data ? Buffer.concat([raw.data, chunk]) : chunk;
        const length = sslRequestLength(buffered);
        if (length === undefined || buffered.length < length) {
          raw.data = buffered;
          return;
        }
        raw.data = "upgraded";
        onSslRequest(raw);
        peer.connections++;
        const connection = connect();
        raw.upgradeTLS({
          isServer: true,
          initialData: buffered.subarray(length),
          tls: { key: tlsCert.key, cert: tlsCert.cert },
          socket: {
            handshake() {},
            data: connection.data,
            end(socket) {
              ended.resolve();
              connection.end(socket);
            },
            close() {
              closed.resolve();
            },
            error() {},
          },
        });
      },
      close() {},
      error() {},
    },
  });
  const peer: TlsPeer = {
    port: listener.port,
    connections: 0,
    ended: ended.promise,
    closed: closed.promise,
    [Symbol.dispose]() {
      listener.stop(true);
    },
  };
  return peer;
}

const postgresTls = (connect: () => PeerConnection) =>
  // the 8-byte SSLRequest; the client sends nothing else until it sees 'S'
  tlsPeer(
    null,
    () => 8,
    raw => raw.write(pgSSLResponse("S")),
    connect,
  );

// `startupReply` answers the StartupMessage
function postgresTlsPeer(
  end: PeerConnection["end"],
  startupReply: Buffer = Buffer.concat([pgAuthenticationOk(), pgReadyForQuery("I")]),
): TlsPeer {
  return postgresTls(() => {
    let started = false;
    return {
      data(socket) {
        if (started) return;
        started = true;
        socket.write(startupReply);
      },
      end,
    };
  });
}

// `authReply` answers the HandshakeResponse that carries sequence id `seq`
function mysqlTlsPeer(
  end: PeerConnection["end"],
  authReply: (seq: number) => Buffer = seq => mysqlOkPacket(seq + 1),
): TlsPeer {
  return tlsPeer(
    mysqlHandshakeV10({ capabilities: MYSQL_DEFAULT_CAPABILITIES | MYSQL_CLIENT_SSL }),
    // the SSLRequest packet: a 3-byte payload length, a sequence id, the payload
    buffered => (buffered.length >= 4 ? 4 + (buffered[0] | (buffered[1] << 8) | (buffered[2] << 16)) : undefined),
    () => {},
    () => {
      let buffered: Buffer = Buffer.alloc(0);
      let authed = false;
      return {
        data(socket, chunk) {
          buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (seq, payload) => {
            if (!authed) {
              authed = true;
              socket.write(authReply(seq));
              return;
            }
            mysqlAckSessionSetup(socket, payload);
          });
        },
        end,
      };
    },
  );
}

const postgresTlsUrl = (port: number) => `postgres://u:p@127.0.0.1:${port}/db?sslmode=require`;
const mysqlTlsUrl = (port: number) => `mysql://root:pw@127.0.0.1:${port}/db`;

const tlsDrivers = [
  ["postgres", postgresTlsPeer, postgresTlsUrl],
  ["mysql", mysqlTlsPeer, mysqlTlsUrl],
] as const;

for (const [name, peer, url] of tlsDrivers) {
  test.concurrent(`${name}: close() settles against a TLS peer that never answers close_notify`, async () => {
    using server = peer(holdOpen);
    const sql = new SQL({ url: url(server.port), max: 1, tls: { rejectUnauthorized: false } });
    await sql.connect();
    await sql.close({ timeout: 0 });
    await server.ended;
    await server.closed;
  });

  test.concurrent(
    `${name}: idleTimeout eviction settles against a TLS peer that never answers close_notify`,
    async () => {
      using server = peer(holdOpen);
      const closed = Promise.withResolvers<void>();
      await using sql = new SQL({
        url: url(server.port),
        max: 1,
        idleTimeout: 0.05,
        tls: { rejectUnauthorized: false },
        onclose: () => closed.resolve(),
      });
      await sql.connect();
      await closed.promise;
      await server.ended;
      await server.closed;
    },
  );

  // Until the server's answer to the close_notify arrived, the next reserve() waited for the
  // slot of the closed reservation and was rejected with its close.
  test.concurrent(`${name}: reserve() after close() of a reserved TLS connection gets a new connection`, async () => {
    using server = peer(closeBack);
    await using sql = new SQL({ url: url(server.port), max: 1, tls: { rejectUnauthorized: false } });
    const first = await sql.reserve();
    await first.close();
    const second = await sql.reserve();
    await second.release();
    expect(server.connections).toBe(2);
  });

  // The peer has stopped reading and the kernel takes only part of a query, so the rest is
  // ciphertext that waits for the socket to become writable. The close does not wait with it.
  // Not concurrent: one socket of the event loop at a time holds such a remainder.
  test.each([
    // The kernel answers a write to a closed socket with a reset. An open one waits for the rest of the TLS record.
    ["is gone before the peer reads on", (client: net.Socket) => void client.write("\x17"), "ECONNRESET"],
    ["leaves the peer what the kernel took, then a FIN", (client: net.Socket) => void client.resume(), "end"],
  ])(`${name}: a TLS connection closed with a query half sent %s`, async (_, act, expected) => {
    using server = peer(closeBack);
    const accepted = Promise.withResolvers<net.Socket>();
    const proxy = await listeningServer(client => {
      const upstream = net.connect(server.port, "127.0.0.1");
      upstream.on("error", () => {});
      client.pipe(upstream).pipe(client);
      accepted.resolve(client);
    });
    try {
      const sql = new SQL({ url: url(proxy.port), max: 1, tls: { rejectUnauthorized: false } });
      await sql.connect();
      const client = await accepted.promise;
      client.unpipe();
      client.pause();
      const outcome = Promise.withResolvers<string>();
      let received = 0;
      client.on("data", chunk => (received += chunk.length));
      client.pause();
      client.on("error", (error: NodeJS.ErrnoException) => outcome.resolve(error.code!));
      client.on("end", () => outcome.resolve("end"));

      const query = sql.unsafe(`select '${Buffer.alloc(12 << 20, "x")}'`).simple();
      query.catch(() => {});
      // The query is written at the end of this turn of the event loop.
      await new Promise(setImmediate);
      await sql.close({ timeout: "0" });
      act(client);
      expect(await outcome.promise).toBe(expected);
      if (expected === "end") expect(received).toBeGreaterThan(64 * 1024);
    } finally {
      proxy.server.close();
    }
  });
}

// A ReadyForQuery before any Authentication message, resp. an auth reply whose header byte no
// auth packet uses: the client fails the connection from inside the TLS data dispatch.
const protocolViolations = [
  [
    "postgres",
    () => postgresTlsPeer(holdOpen, pgReadyForQuery("I")),
    postgresTlsUrl,
    "ERR_POSTGRES_UNEXPECTED_MESSAGE",
  ],
  [
    "mysql",
    () => mysqlTlsPeer(holdOpen, seq => mysqlRawPacket(seq + 1, Buffer.from([0x42]))),
    mysqlTlsUrl,
    "ERR_MYSQL_UNEXPECTED_PACKET",
  ],
] as const;

for (const [name, peer, url, code] of protocolViolations) {
  test.concurrent(
    `${name}: a protocol violation closes the socket against a TLS peer that never answers close_notify`,
    async () => {
      using server = peer();
      await using sql = new SQL({ url: url(server.port), max: 1, tls: { rejectUnauthorized: false } });
      const settled = await sql.connect().then(
        () => "connected",
        e => e.code,
      );
      expect(settled).toBe(code);
      await server.ended;
      await server.closed;
    },
  );
}

// A backend that runs a query answers it first and the client's close_notify after it. The next
// caller used to wait for that, and was rejected with the error the late answer raised.
test.concurrent("postgres: a query after close() of a busy reserved TLS connection gets a new connection", async () => {
  const running = Promise.withResolvers<void>();
  const row = Buffer.concat([
    pgRowDescription([{ name: "x", typeOid: 25 }]),
    pgDataRow([Buffer.from("1")]),
    pgCommandComplete("SELECT 1"),
    pgReadyForQuery("I"),
  ]);
  using server = postgresTls(() => {
    let started = false;
    let buffered: Buffer = Buffer.alloc(0);
    let busy = false;
    return {
      data(socket, chunk) {
        if (!started) {
          started = true;
          socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery("I")]));
          return;
        }
        buffered = pgReadFrontendMessages(Buffer.concat([buffered, chunk]), (type, body) => {
          if (type !== 0x51 /* Query */) return;
          if (body.includes("pg_sleep")) {
            busy = true;
            running.resolve();
          } else {
            socket.write(row);
          }
        });
      },
      end(socket) {
        if (busy) socket.write(row);
        socket.end();
      },
    };
  });
  await using sql = new SQL({ url: postgresTlsUrl(server.port), max: 1, tls: { rejectUnauthorized: false } });
  const reserved = await sql.reserve();
  const slow = reserved`select pg_sleep(5)`.simple().then(
    () => "resolved",
    e => e.code,
  );
  await running.promise;
  await reserved.close();
  expect(await sql`select 1 as x`.simple()).toEqual([{ x: "1" }]);
  expect(await slow).toBe("ERR_POSTGRES_CONNECTION_CLOSED");
  expect(server.connections).toBe(2);
});
