// Fault-injection test: requires a server that refuses / drops / sends malformed
// frames, which a healthy container will not do on demand. DO NOT COPY THIS
// PATTERN — anything a real server can produce belongs in describeWithContainer.
// All wire-protocol bytes come from test/js/sql/wire-frames.ts; do not inline
// Buffer.alloc frame construction here.

// https://github.com/oven-sh/bun/issues/32095
//
// A forced pool close (`close({ timeout: 0 })`) must resolve even when a
// pool connection has been accepted at the TCP level but the database
// handshake has not completed yet (a database that is still starting up).
// Previously the pending queries were rejected but the promise returned by
// close() stayed pending forever: the native close path emitted no socket
// event for in-flight connects, so the JS onclose callback never fired.
//
// connectionTimeout: 0 disables the connect timer, so close() is the only
// thing that can tear the connection down — without the fix these tests hang.

import { SQL } from "bun";
import { expect, mock, test } from "bun:test";
import type { Server, Socket } from "node:net";
import {
  listeningServer,
  mysqlAckSessionSetup,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlReadPackets,
  mysqlTextResultSet,
  neverAnsweringServer,
  pgAuthenticationOk,
  pgCommandComplete,
  pgDataRow,
  pgHold,
  pgMockServer,
  pgReadyForQuery,
  pgRowDescription,
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
      await sql.close({ timeout: 0 });
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
      await sql.close({ timeout: 0 });
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
      await sql.close({ timeout: 0 });
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
    await sql.close({ timeout: 0 });
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
    await sql.close({ timeout: 0 });
    server.close();
  }
});

// https://github.com/oven-sh/bun/issues/32038
//
// Each mock completes the handshake, holds the first query, and answers it with one text row when `respond()` is
// called. A close() that waits lets that answer resolve the query. A forced close() has already rejected it. Both
// outcomes settle, so a close() that wrongly waits fails an assertion instead of hanging.

type HeldQueryMock = { port: number; server: Server; commandReceived: Promise<void>; respond: () => void };

// After the command arrives `received` is settled, so the reset caused by a forced close() is ignored.
function failUntilCommand(socket: Socket, received: PromiseWithResolvers<void>) {
  socket.on("error", received.reject);
  socket.on("close", () => received.reject(new Error("the client disconnected before it sent a command")));
}

const heldQueryMocks = {
  async postgres(): Promise<HeldQueryMock> {
    const received = Promise.withResolvers<void>();
    const { port, server, release } = await pgMockServer(type => {
      if (type !== "Q") return;
      received.resolve();
      return [
        pgHold,
        pgRowDescription([{ name: "x", typeOid: 25 }]),
        pgDataRow([Buffer.from("1")]),
        pgCommandComplete("SELECT 1"),
        pgReadyForQuery(),
      ];
    });
    server.on("connection", socket => failUntilCommand(socket, received));
    return { port, server, commandReceived: received.promise, respond: release };
  },
  async mysql(): Promise<HeldQueryMock> {
    const received = Promise.withResolvers<void>();
    let respond = () => {};
    const { port, server } = await listeningServer(socket => {
      let buffered = Buffer.alloc(0);
      let authed = false;
      socket.write(mysqlHandshakeV10());
      socket.on("data", chunk => {
        buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (seq, payload) => {
          if (!authed) {
            authed = true;
            socket.write(mysqlOkPacket(seq + 1));
            return;
          }
          if (mysqlAckSessionSetup(socket, payload)) return;
          if (payload[0] !== 0x03 /* COM_QUERY */) return;
          respond = () => socket.write(mysqlTextResultSet(seq + 1, [{ name: "x", type: 0xfd }], [["1"]]));
          received.resolve();
        });
      });
      failUntilCommand(socket, received);
    });
    return { port, server, commandReceived: received.promise, respond: () => respond() };
  },
} as const;

// `false`, `""`, `"0"` and `null` are outside the declared `number` type. JS callers can still pass them.
const timeoutSpellings = [
  ["0", 0, "forced"],
  ['"0"', "0", "forced"],
  ["false", false, "forced"],
  ['""', "", "forced"],
  ["undefined", undefined, "drained"],
  ["null", null, "drained"],
  ["NaN", NaN, "invalid"],
  ["-1", -1, "invalid"],
] as const;

for (const [name, scheme, closedCode] of drivers) {
  const rows = { rows: [{ x: "1" }] };
  const outcomes = {
    forced: { query: { code: closedCode }, close: "resolved" },
    drained: { query: rows, close: "resolved" },
    // The option is rejected before the pool is marked closed, so the query still completes.
    invalid: { query: rows, close: "ERR_INVALID_ARG_VALUE" },
  };

  for (const [label, timeout, outcome] of timeoutSpellings) {
    test(`${name}: close({ timeout: ${label} }) with a query in flight is ${outcome}`, async () => {
      const { port, server, commandReceived, respond } = await heldQueryMocks[name]();
      try {
        await using sql = new SQL({ url: `${scheme}127.0.0.1:${port}/db`, max: 1 });
        const query = sql`select 1 as x`.simple().then(
          rows => ({ rows }),
          e => ({ code: e.code }),
        );
        await commandReceived;
        const close = sql.close({ timeout: timeout as any }).then(
          () => "resolved",
          e => e.code,
        );
        respond();
        expect({ query: await query, close: await close }).toEqual(outcomes[outcome]);
      } finally {
        server.close();
      }
    });
  }
}
