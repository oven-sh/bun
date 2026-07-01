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

import { SQL } from "bun";
import { expect, test } from "bun:test";
import {
  listeningServer,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlReadPackets,
  neverAnsweringServer,
  pgAuthenticationOk,
  pgReadyForQuery,
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

  // Same scenario as above but with the *number* 0, the documented spelling
  // of "force-close now". `close({ timeout })` used to gate on `if (timeout)`,
  // and 0 is falsy, so a numeric 0 fell into the graceful "wait for every
  // pending query" branch and the `timeout === 0` force-close check below it
  // was unreachable. The two tests above dodge that gate by passing the
  // truthy string "0".
  test(`${name}: close({ timeout: 0 }) force-closes a mid-handshake connection`, async () => {
    const { port, server, accepted } = await neverAnsweringServer();
    try {
      const sql = new SQL({ url: `${scheme}127.0.0.1:${port}/db`, max: 1, connectionTimeout: 0 });
      const queryError = sql`SELECT 1`.catch(e => e);
      await accepted;
      await sql.close({ timeout: 0 });
      expect((await queryError).code).toBe(closedCode);
    } finally {
      server.close();
    }
  });
}

// ---------------------------------------------------------------------------
// A connection that is fully connected with a query in flight when the server
// stops responding mid-packet. The connection is busy, so no idle timer is
// armed, and idleTimeout / maxLifetime default to 0 (disabled): nothing on
// the client side can ever complete the query. close({ timeout: 0 }) is the
// escape hatch for exactly this, so it must destroy the socket, resolve, and
// reject the in-flight query instead of waiting forever on the peer.
// ---------------------------------------------------------------------------

/**
 * Completes the MySQL handshake, then answers the first post-auth command
 * (the query) with 2 of the 4 bytes of a packet header and never writes
 * again. `wedged` resolves once those bytes are on the wire.
 */
async function mysqlServerStoppingMidPacket() {
  const wedged = Promise.withResolvers<void>();
  const { port, server } = await listeningServer(socket => {
    let buffered = Buffer.alloc(0);
    let authed = false;
    let stopped = false;
    socket.write(mysqlHandshakeV10());
    socket.on("data", chunk => {
      buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), seq => {
        if (!authed) {
          authed = true;
          socket.write(mysqlOkPacket(seq + 1));
        } else if (!stopped) {
          stopped = true;
          socket.write(Buffer.from([0x07, 0x00]));
          wedged.resolve();
        }
        // later packets: stay silent (the peer holds the connection open)
      });
    });
    socket.on("error", () => {});
  });
  return { port, server, wedged: wedged.promise };
}

/**
 * Completes the Postgres startup (AuthenticationOk + ReadyForQuery), then
 * answers the query's extended-protocol messages with 1 of the 5 bytes of a
 * backend message header and never writes again.
 */
async function postgresServerStoppingMidPacket() {
  const wedged = Promise.withResolvers<void>();
  const { port, server } = await listeningServer(socket => {
    let startup = true;
    let stopped = false;
    socket.on("data", () => {
      if (startup) {
        startup = false;
        socket.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]));
      } else if (!stopped) {
        stopped = true;
        socket.write(Buffer.from("T"));
        wedged.resolve();
      }
      // later chunks: stay silent (the peer holds the connection open)
    });
    socket.on("error", () => {});
  });
  return { port, server, wedged: wedged.promise };
}

const serverStoppingMidPacket = {
  postgres: postgresServerStoppingMidPacket,
  mysql: mysqlServerStoppingMidPacket,
} as const;

for (const [name, scheme, closedCode] of drivers) {
  test(`${name}: close({ timeout: 0 }) force-closes a connected connection whose server stopped mid-packet`, async () => {
    const { port, server, wedged } = await serverStoppingMidPacket[name]();
    try {
      const sql = new SQL({ url: `${scheme}127.0.0.1:${port}/db`, max: 1 });
      const queryError = sql`SELECT 1`.catch(e => e);
      // the server has received the query and replied with a truncated
      // message header: the connection is established, the query is in
      // flight, and nothing the peer will ever do can complete either
      await wedged;
      await sql.close({ timeout: 0 });
      expect((await queryError).code).toBe(closedCode);
    } finally {
      server.close();
    }
  });
}

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
