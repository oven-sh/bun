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
import { bunEnv, bunExe, tls as tlsCert } from "harness";
import {
  listeningServer,
  MYSQL_CLIENT_SSL,
  MYSQL_DEFAULT_CAPABILITIES,
  mysqlAckSessionSetup,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlRawPacket,
  mysqlReadPackets,
  neverAnsweringServer,
  pgAuthenticationOk,
  pgReadyForQuery,
  pgSSLResponse,
} from "./wire-frames";

const drivers = [
  ["postgres", "postgres://postgres@", "ERR_POSTGRES_CONNECTION_CLOSED"],
  ["mysql", "mysql://root@", "ERR_MYSQL_CONNECTION_CLOSED"],
] as const;

for (const [name, scheme, closedCode] of drivers) {
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
}

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

// A TLS peer that stays silent after the client's close_notify: it answers
// the handshake, reports itself ready, and then holds its side of the
// connection open (a half-open proxy, a partition at shutdown). The client
// used to send close_notify and keep the fd until the peer replied, so the
// pool's close() never settled and the process never exited. Teardown of a
// connection the client has given up on must not depend on the peer.
//
// Bun.listen peers instead of node:tls: a TLSSocket wrapped over a net.Socket
// always ends its own side when the client's close_notify arrives, which is
// exactly the reply a holding peer never sends.
type HoldingPeer = { port: number; ended: Promise<void>; closed: Promise<void>; [Symbol.dispose](): void };

function holdingTlsPeer(
  greeting: Buffer | null,
  // answers the client's plaintext SSL request; returns the bytes after it
  onSslRequest: (raw: Socket, chunk: Buffer) => Buffer,
  onSecureData: (socket: Socket, chunk: Buffer) => void,
): HoldingPeer {
  const ended = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<void>();
  const listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    allowHalfOpen: true,
    socket: {
      open(raw) {
        if (greeting) raw.write(greeting);
      },
      data(raw, chunk) {
        // the raw socket keeps observing bytes after the upgrade
        if (raw.data) return;
        raw.data = true;
        raw.upgradeTLS({
          isServer: true,
          initialData: onSslRequest(raw, chunk),
          tls: { key: tlsCert.key, cert: tlsCert.cert },
          socket: {
            handshake() {},
            data: onSecureData,
            // the client's close_notify; hold the connection open. The probe
            // write only fails, and so only closes this side, once the
            // client's fd is gone: the kernel answers it with a reset.
            end(socket) {
              ended.resolve();
              socket.write("probe");
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
  return {
    port: listener.port,
    ended: ended.promise,
    closed: closed.promise,
    [Symbol.dispose]() {
      listener.stop(true);
    },
  };
}

// `startupReply` answers the StartupMessage
function holdingPostgresPeer(
  startupReply: Buffer = Buffer.concat([pgAuthenticationOk(), pgReadyForQuery("I")]),
): HoldingPeer {
  let started = false;
  return holdingTlsPeer(
    null,
    (raw, chunk) => {
      // the 8-byte SSLRequest; the client sends nothing else until it sees 'S'
      raw.write(pgSSLResponse("S"));
      return chunk.subarray(8);
    },
    (socket, _chunk) => {
      if (started) return;
      started = true;
      socket.write(startupReply);
    },
  );
}

// `authReply` answers the HandshakeResponse that carries sequence id `seq`
function holdingMysqlPeer(authReply: (seq: number) => Buffer = seq => mysqlOkPacket(seq + 1)): HoldingPeer {
  let buffered = Buffer.alloc(0);
  let authed = false;
  return holdingTlsPeer(
    mysqlHandshakeV10({ capabilities: MYSQL_DEFAULT_CAPABILITIES | MYSQL_CLIENT_SSL }),
    (_raw, chunk) => chunk.subarray(4 + (chunk[0] | (chunk[1] << 8) | (chunk[2] << 16))),
    (socket, chunk) => {
      buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (seq, payload) => {
        if (!authed) {
          authed = true;
          socket.write(authReply(seq));
          return;
        }
        mysqlAckSessionSetup(socket, payload);
      });
    },
  );
}

const postgresTlsUrl = (port: number) => `postgres://u:p@127.0.0.1:${port}/db?sslmode=require`;
const mysqlTlsUrl = (port: number) => `mysql://root:pw@127.0.0.1:${port}/db`;

const holdingPeers = [
  ["postgres", holdingPostgresPeer, postgresTlsUrl],
  ["mysql", holdingMysqlPeer, mysqlTlsUrl],
] as const;

for (const [name, peer, url] of holdingPeers) {
  test.concurrent(`${name}: close() settles against a TLS peer that never answers close_notify`, async () => {
    using server = peer();
    const sql = new SQL({ url: url(server.port), max: 1, tls: { rejectUnauthorized: false } });
    await sql.connect();
    await sql.close({ timeout: 0 });
    await server.ended;
    await server.closed;
  });

  test.concurrent(
    `${name}: idleTimeout eviction settles against a TLS peer that never answers close_notify`,
    async () => {
      using server = peer();
      const closed = Promise.withResolvers<void>();
      const sql = new SQL({
        url: url(server.port),
        max: 1,
        idleTimeout: 1,
        tls: { rejectUnauthorized: false },
        onclose: () => closed.resolve(),
      });
      await sql.connect();
      await closed.promise;
      await server.ended;
      await server.closed;
      await sql.close();
    },
  );
}

// The peer answers the startup with a message the client rejects: a
// ReadyForQuery before any Authentication message, resp. an auth reply whose
// header byte no auth packet uses. The client fails the connection from
// inside the TLS data dispatch, the same path an ErrorResponse during
// authentication takes.
const protocolViolations = [
  ["postgres", () => holdingPostgresPeer(pgReadyForQuery("I")), postgresTlsUrl, "ERR_POSTGRES_UNEXPECTED_MESSAGE"],
  [
    "mysql",
    () => holdingMysqlPeer(seq => mysqlRawPacket(seq + 1, Buffer.from([0x42]))),
    mysqlTlsUrl,
    "ERR_MYSQL_UNEXPECTED_PACKET",
  ],
] as const;

for (const [name, peer, url, code] of protocolViolations) {
  test.concurrent(
    `${name}: a protocol violation closes the socket against a TLS peer that never answers close_notify`,
    async () => {
      using server = peer();
      const sql = new SQL({ url: url(server.port), max: 1, tls: { rejectUnauthorized: false } });
      const settled = await sql.connect().then(
        () => "connected",
        e => e.code,
      );
      expect(settled).toBe(code);
      await server.ended;
      await server.closed;
      await sql.close();
    },
  );
}

test.concurrent("postgres: a rejected certificate over a holding TLS peer does not pin the process", async () => {
  using server = holdingPostgresPeer();
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { SQL } = require("bun");
      const sql = new SQL("postgres://u:p@127.0.0.1:${server.port}/db?sslmode=verify-full", { max: 1 });
      const code = await sql.connect().then(() => "connected", e => e.code);
      console.log(code);
      // the socket the client gave up on must not keep the event loop alive
      setTimeout(() => process.exit(7), 2000).unref();
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("DEPTH_ZERO_SELF_SIGNED_CERT\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
