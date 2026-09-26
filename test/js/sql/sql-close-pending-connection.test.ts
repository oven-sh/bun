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
import { bunEnv, bunExe, describeWithContainer } from "harness";
import type { Server, Socket } from "node:net";
import {
  closedPort,
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

// close() on a pool that an earlier close() call is still closing. A later call waits for that close, for at
// most its timeout. When the timeout ends, the pool stops waiting for the queries in flight.
type CloseOptions = { timeout?: number } | undefined;
const show = (options: CloseOptions) => `close(${options ? `{ timeout: ${options.timeout} }` : ""})`;

function heldQuery(sql: SQL) {
  return sql`select 1 as x`.simple().then(
    rows => ({ rows: [...rows] }),
    e => ({ code: e.code }),
  );
}

for (const [name, scheme, closedCode] of drivers) {
  const rows = { rows: [{ x: "1" }] };

  const forcing: [first: CloseOptions, later: CloseOptions][] = [
    [undefined, { timeout: 0 }],
    [{ timeout: 30 }, { timeout: 0 }],
    [undefined, { timeout: 0.01 }],
    [{ timeout: 30 }, { timeout: 0.01 }],
  ];
  for (const [first, later] of forcing) {
    test(`${name}: ${show(later)} closes a pool that waits in ${show(first)}`, async () => {
      const { port, server, commandReceived, respond } = await heldQueryMocks[name]();
      try {
        const sql = new SQL({ url: `${scheme}127.0.0.1:${port}/db`, max: 1 });
        const query = heldQuery(sql);
        await commandReceived;
        const firstClosed = sql.close(first);
        await sql.close(later);
        // a later call that closed nothing leaves the query in flight, and this answer resolves it
        respond();
        expect(await query).toEqual({ code: closedCode });
        await firstClosed;
      } finally {
        server.close();
      }
    });
  }

  const joining: [first: CloseOptions, later: CloseOptions][] = [
    [undefined, undefined],
    [{ timeout: 30 }, undefined],
    [undefined, { timeout: 30 }],
    // more milliseconds than a timer can hold
    [undefined, { timeout: 3_000_000 }],
  ];
  for (const [first, later] of joining) {
    test(`${name}: ${show(later)} settles with a pool that waits in ${show(first)}`, async () => {
      const { port, server, commandReceived, respond } = await heldQueryMocks[name]();
      try {
        const sql = new SQL({ url: `${scheme}127.0.0.1:${port}/db`, max: 1 });
        const order: string[] = [];
        const query = heldQuery(sql).finally(() => order.push("query"));
        await commandReceived;
        const firstClosed = sql.close(first).then(() => order.push("first"));
        const laterClosed = sql.close(later).then(() => order.push("later"));
        respond();
        expect(await query).toEqual(rows);
        await Promise.all([firstClosed, laterClosed]);
        expect(order).toEqual(["query", "first", "later"]);
      } finally {
        server.close();
      }
    });
  }

  test(`${name}: close({ timeout }) closes the pool when the timeout expires, also after a later close()`, async () => {
    const { port, server, commandReceived } = await heldQueryMocks[name]();
    try {
      const sql = new SQL({ url: `${scheme}127.0.0.1:${port}/db`, max: 1 });
      const query = heldQuery(sql);
      await commandReceived;
      // the server never answers, so only the timeout can settle these
      await Promise.all([sql.close({ timeout: 0.01 }), sql.close(), sql.end({ timeout: 30 })]);
      expect(await query).toEqual({ code: closedCode });
      expect(await Promise.all([sql.close(), sql.end({ timeout: 0 })])).toEqual([undefined, undefined]);
    } finally {
      server.close();
    }
  });

  test(`${name}: a later close() with an invalid timeout rejects and changes nothing`, async () => {
    const { port, server, commandReceived, respond } = await heldQueryMocks[name]();
    try {
      const sql = new SQL({ url: `${scheme}127.0.0.1:${port}/db`, max: 1 });
      const query = heldQuery(sql);
      await commandReceived;
      const firstClosed = sql.close();
      const codes = [-1, 2 ** 32, NaN].map(timeout => sql.close({ timeout }).catch(e => e.code));
      expect(await Promise.all(codes)).toEqual(Array(3).fill("ERR_INVALID_ARG_VALUE"));
      respond();
      expect(await query).toEqual(rows);
      await firstClosed;
      expect(await sql.close({ timeout: -1 }).catch(e => e.code)).toBe("ERR_INVALID_ARG_VALUE");
    } finally {
      server.close();
    }
  });

  test(`${name}: end() and asyncDispose reach the same close as close()`, async () => {
    const { port, server, commandReceived, respond } = await heldQueryMocks[name]();
    try {
      const sql = new SQL({ url: `${scheme}127.0.0.1:${port}/db`, max: 1 });
      const order: string[] = [];
      const query = heldQuery(sql).finally(() => order.push("query"));
      await commandReceived;
      const disposed = sql[Symbol.asyncDispose]().then(() => order.push("asyncDispose"));
      const joined = sql.end().then(() => order.push("end"));
      await sql.end({ timeout: 0 });
      respond();
      expect(await query).toEqual({ code: closedCode });
      await Promise.all([disposed, joined]);
      expect(order).toEqual(["query", "asyncDispose", "end"]);
    } finally {
      server.close();
    }
  });

  test(`${name}: only a later close() without a timeout waits for a forced close that still closes a slot`, async () => {
    const { port, server, commandReceived } = await heldQueryMocks[name]();
    const password = Promise.withResolvers<string>();
    try {
      let slots = 0;
      const order: string[] = [];
      const sql = new SQL({
        url: `${scheme}127.0.0.1:${port}/db`,
        max: 2,
        // the second slot has no native connection until the test resolves its password
        password: () => (++slots === 1 ? "" : password.promise),
      });
      const query = heldQuery(sql);
      await commandReceived;
      const forced = sql.close({ timeout: 0 }).then(() => order.push("forced"));
      const later = sql.close().then(() => order.push("later"));
      const laterForced = sql.close({ timeout: 0 }).then(() => order.push("later forced"));
      expect(await query).toEqual({ code: closedCode });
      // one turn of the event loop: a later close() that did not wait with the first one has settled by now
      await new Promise(resolve => setImmediate(resolve));
      order.push("password");
      password.resolve("");
      await Promise.all([forced, later, laterForced]);
      expect(order).toEqual(["later forced", "password", "forced", "later"]);
    } finally {
      password.resolve("");
      server.close();
    }
  });
}

test("Bun.sql.close() and Bun.sql.end() reach the same close", async () => {
  const { port, server, commandReceived, respond } = await heldQueryMocks.postgres();
  try {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { sql } = Bun;
          const query = sql\`select 1 as x\`.simple().then(() => "rows", e => e.code);
          process.stdin.once("data", async () => {
            const first = sql.close();
            await sql.end({ timeout: 0 });
            console.log("forced");
            console.log("query: " + (await query));
            await first;
            console.log("closed");
          });
        `,
      ],
      env: { ...bunEnv, DATABASE_URL: `postgres://postgres@127.0.0.1:${port}/db` },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    });
    await commandReceived;
    proc.stdin.write("close\n");
    proc.stdin.end();
    let stdout = "";
    for await (const chunk of proc.stdout) {
      stdout += Buffer.from(chunk).toString();
      // an end() that closed nothing leaves the query in flight, and this answer resolves it
      if (stdout.includes("forced\n")) respond();
    }
    expect(stdout).toBe("forced\nquery: ERR_POSTGRES_CONNECTION_CLOSED\nclosed\n");
    expect(await proc.exited).toBe(0);
  } finally {
    server.close();
  }
});

// https://github.com/oven-sh/bun/issues/43887
//
// A close() that waits runs the queries that started before it. Only a mock can hold an answer back, never answer,
// or refuse the connection, so these cases are here. The other cases use a real server, below.
for (const [name, scheme, closedCode] of drivers) {
  test(`${name}: close({ timeout }) that expires rejects a query that started before it and was sent`, async () => {
    const { port, server, commandReceived } = await heldQueryMocks[name]();
    try {
      const sql = new SQL({ url: `${scheme}127.0.0.1:${port}/db`, max: 1 });
      await sql.connect();
      const query = heldQuery(sql);
      const closed = sql.close({ timeout: 0.05 });
      // the server never answers, so only the timeout can settle the query
      await commandReceived;
      await closed;
      expect(await query).toEqual({ code: closedCode });
    } finally {
      server.close();
    }
  });

  test(`${name}: close() opens the pool for a started query and waits no longer than connectionTimeout`, async () => {
    const { port, server, accepted } = await neverAnsweringServer();
    try {
      const sql = new SQL({ url: `${scheme}127.0.0.1:${port}/db`, max: 1, connectionTimeout: 0.05 });
      const query = heldQuery(sql);
      await sql.close();
      expect(await query).toEqual({ code: closedCode.replace("CONNECTION_CLOSED", "CONNECTION_TIMEOUT") });
      await accepted;
    } finally {
      server.close();
    }
  });

  test(`${name}: close() opens the pool for a started query, and a refused connection rejects the query`, async () => {
    const sql = new SQL({ url: `${scheme}127.0.0.1:${await closedPort()}/db`, max: 1 });
    const query = heldQuery(sql);
    await sql.close();
    expect(await query).toEqual({ code: closedCode.replace("CONNECTION_CLOSED", "CONNECTION_REFUSED") });
  });
}

// These tests use a real server. Each test has a table of its own, and a second pool reads that table after the
// close: a row shows that the server got the statement.
const settle = (promise: Promise<unknown>) =>
  promise.then(
    value => ({ value }),
    e => ({ code: e.code }),
  );

const starts = {
  "then()": query => query.then(rows => rows),
  "catch()": query => query.catch(e => Promise.reject(e)),
  "finally()": query => query.finally(() => {}),
  "run()": query => query.run(),
  "execute()": query => query.execute(),
};
// These call then() from a later promise job, so a close() in the same tick comes before the start.
const laterStarts = {
  "`await` in a function that nobody awaits": query => (async () => await query)(),
  "Promise.all()": query => Promise.all([query]),
  "Promise.resolve()": query => Promise.resolve(query),
};
const closes = {
  "close({ timeout: 5 })": sql => sql.close({ timeout: 5 }),
  "close({ timeout: null })": sql => sql.close({ timeout: null }),
  "end()": sql => sql.end(),
  "[Symbol.asyncDispose]()": sql => sql[Symbol.asyncDispose](),
};

const servers = [
  { adapter: "postgres", image: "postgres_plain", user: "bun_sql_test", serial: "SERIAL PRIMARY KEY" },
  { adapter: "mysql", image: "mysql_plain", user: "root", serial: "INT AUTO_INCREMENT PRIMARY KEY" },
] as const;

for (const { adapter, image, user, serial } of servers) {
  const code = (name: string) => `ERR_${adapter.toUpperCase()}_${name}`;

  describeWithContainer(`${adapter}: close() and the queries that started before it`, { image }, container => {
    // `warm: false` leaves the pool without a connection.
    async function openTable({ warm = true, ...options }: Bun.SQL.Options & { warm?: boolean } = {}) {
      await container.ready;
      const url = `${adapter}://${user}@${container.host}:${container.port}/bun_sql_test`;
      const reader = new SQL({ url, max: 1 });
      const table = "close_" + crypto.randomUUID().replaceAll("-", "");
      await reader.unsafe(`CREATE TABLE ${table} (id ${serial}, x INT)`);
      const sql = new SQL({ url, max: 1, ...options });
      if (warm) await sql.connect();
      return {
        sql,
        table,
        insert: (x: number, on: SQL = sql) => on`INSERT INTO ${sql(table)} (x) VALUES (${x})`,
        rows: async () => (await reader.unsafe(`SELECT x FROM ${table} ORDER BY id`)).map(row => row.x),
        async [Symbol.asyncDispose]() {
          await sql.close({ timeout: 0 });
          await reader.unsafe(`DROP TABLE ${table}`);
          await reader.close();
        },
      };
    }

    for (const [name, start] of Object.entries(starts)) {
      test(`close() waits for a query that ${name} started`, async () => {
        await using table = await openTable();
        const inserted = settle(start(table.insert(1)).then(() => "done"));
        await table.sql.close();
        expect({ query: await inserted, rows: await table.rows() }).toEqual({ query: { value: "done" }, rows: [1] });
      });
    }

    for (const [name, close] of Object.entries(closes)) {
      test(`${name} waits for a query that started before it`, async () => {
        await using table = await openTable();
        const inserted = settle(table.insert(1).then(() => "done"));
        await close(table.sql);
        expect({ query: await inserted, rows: await table.rows() }).toEqual({ query: { value: "done" }, rows: [1] });
      });
    }

    for (const [name, { rows, start }] of Object.entries({
      "sql.unsafe()": { rows: [1], start: ({ sql, table }) => sql.unsafe(`INSERT INTO ${table} (x) VALUES (1)`) },
      "two statements in simple()": {
        rows: [1, 2],
        start: ({ sql, table }) =>
          sql.unsafe(`INSERT INTO ${table} (x) VALUES (1); INSERT INTO ${table} (x) VALUES (2)`).simple(),
      },
    })) {
      test(`close() waits for ${name}`, async () => {
        await using table = await openTable();
        const inserted = settle(start(table).then(() => "done"));
        await table.sql.close();
        expect({ query: await inserted, rows: await table.rows() }).toEqual({ query: { value: "done" }, rows });
      });
    }

    test("an `await using` block runs the 20 inserts that it did not await", async () => {
      await using table = await openTable();
      const errors: unknown[] = [];
      {
        await using _ = table.sql;
        for (let x = 0; x < 20; x++) table.insert(x).catch(e => errors.push(e.code));
      }
      expect({ errors, rows: await table.rows() }).toEqual({
        errors: [],
        rows: Array.from({ length: 20 }, (_, x) => x),
      });
    });

    test("close() runs the queries that started before it in start order", async () => {
      await using table = await openTable();
      const expected = Array.from({ length: 50 }, (_, x) => x);
      const inserted = expected.map(x => settle(table.insert(x).then(() => x)));
      await table.sql.close();
      expect({ queries: await Promise.all(inserted), rows: await table.rows() }).toEqual({
        queries: expected.map(value => ({ value })),
        rows: expected,
      });
    });

    test("two close() calls in the same tick run a started query once", async () => {
      await using table = await openTable();
      const inserted = settle(table.insert(1).then(() => "done"));
      await Promise.all([table.sql.close(), table.sql.close()]);
      expect({ query: await inserted, rows: await table.rows() }).toEqual({ query: { value: "done" }, rows: [1] });
    });

    // The pool has `max` connections and opens them all for its first query.
    test("close() opens a pool that never connected for a started query", async () => {
      const password = mock(() => "");
      const onconnect = mock();
      const onclose = mock();
      await using table = await openTable({ warm: false, max: 3, password, onconnect, onclose });
      const inserted = settle(table.insert(1).then(() => "done"));
      await table.sql.close();
      expect({
        query: await inserted,
        rows: await table.rows(),
        passwords: password.mock.calls.length,
        connected: onconnect.mock.calls.length > 0,
        closed: onclose.mock.calls.length === onconnect.mock.calls.length,
      }).toEqual({ query: { value: "done" }, rows: [1], passwords: 3, connected: true, closed: true });
    });

    // The pool opens inside close(), so a function-valued password runs there. Its close() finds the first one at work.
    test("a close() from the password function of a pool that close() opens runs a started query once", async () => {
      const inner: Promise<void>[] = [];
      await using table = await openTable({
        warm: false,
        password: () => {
          if (inner.length === 0) inner.push(table.sql.close());
          return "";
        },
      });
      const inserted = settle(table.insert(1).then(() => "done"));
      await table.sql.close();
      await Promise.all(inner);
      expect({ query: await inserted, rows: await table.rows(), closes: inner.length }).toEqual({
        query: { value: "done" },
        rows: [1],
        closes: 1,
      });
    });

    for (const [name, statement] of [
      ["commitDistributed", "COMMIT"],
      ["rollbackDistributed", "ROLLBACK"],
    ] as const) {
      // No such transaction exists, so the error of the server shows that the server got the statement.
      test(`close() waits for the ${statement} of sql.${name}() that was called before it`, async () => {
        await using table = await openTable();
        const finished = settle(table.sql[name]("close_no_such_transaction"));
        await table.sql.close();
        expect(await finished).toEqual({ code: code("SERVER_ERROR") });
      });
    }

    test("close() waits for a started query when a transaction has the only connection", async () => {
      await using table = await openTable();
      const order: string[] = [];
      const open = Promise.withResolvers<void>();
      const gate = Promise.withResolvers<void>();
      const transaction = table.sql
        .begin(async tx => {
          await table.insert(1, tx);
          open.resolve();
          await gate.promise;
          await table.insert(2, tx);
        })
        .finally(() => order.push("transaction"));
      await open.promise;
      const inserted = settle(table.insert(3).then(() => "done")).finally(() => order.push("query"));
      const closed = table.sql.close().finally(() => order.push("close()"));
      gate.resolve();
      await Promise.all([transaction, closed]);
      expect({ query: await inserted, rows: await table.rows(), order }).toEqual({
        query: { value: "done" },
        rows: [1, 2, 3],
        order: ["transaction", "query", "close()"],
      });
    });

    test("close() waits for a started query when a reservation has the only connection", async () => {
      await using table = await openTable();
      const order: string[] = [];
      const reserved = await table.sql.reserve();
      await table.insert(1, reserved);
      const inserted = settle(table.insert(3).then(() => "done")).finally(() => order.push("query"));
      const closed = table.sql.close().finally(() => order.push("close()"));
      await table.insert(2, reserved);
      reserved.release();
      await closed;
      expect({ query: await inserted, rows: await table.rows(), order }).toEqual({
        query: { value: "done" },
        rows: [1, 2, 3],
        order: ["query", "close()"],
      });
    });

    test("a query that starts after close() is rejected and never sent", async () => {
      await using table = await openTable();
      const early = settle(table.insert(1).then(() => "done"));
      const closed = table.sql.close();
      const late = [settle(table.insert(2).execute()), settle(table.insert(3).then(rows => rows))];
      await closed;
      expect({ early: await early, late: await Promise.all(late), rows: await table.rows() }).toEqual({
        early: { value: "done" },
        late: [{ code: code("CONNECTION_CLOSED") }, { code: code("CONNECTION_CLOSED") }],
        rows: [1],
      });
    });

    for (const [name, start] of Object.entries(laterStarts)) {
      test(`a query that only ${name} started is rejected and never sent`, async () => {
        await using table = await openTable();
        const inserted = settle(start(table.insert(1)));
        await table.sql.close();
        expect({ query: await inserted, rows: await table.rows() }).toEqual({
          query: { code: code("CONNECTION_CLOSED") },
          rows: [],
        });
      });
    }

    for (const [label, timeout] of [
      ["0", 0],
      ['"0"', "0"],
    ] as const) {
      test(`close({ timeout: ${label} }) does not send a query that started before it`, async () => {
        await using table = await openTable();
        const inserted = settle(table.insert(1).then(rows => rows));
        await table.sql.close({ timeout: timeout as any });
        expect({ query: await inserted, rows: await table.rows() }).toEqual({
          query: { code: code("CONNECTION_CLOSED") },
          rows: [],
        });
      });
    }

    test("close() with an invalid timeout rejects, and a query that started before it runs", async () => {
      await using table = await openTable();
      const inserted = settle(table.insert(1).then(() => "done"));
      const closed = settle(table.sql.close({ timeout: -1 }));
      expect({ closed: await closed, query: await inserted, rows: await table.rows() }).toEqual({
        closed: { code: "ERR_INVALID_ARG_VALUE" },
        query: { value: "done" },
        rows: [1],
      });
    });

    test("a query that is cancelled in the tick that started it is never sent and holds no connection", async () => {
      await using table = await openTable();
      const query = table.insert(1);
      const inserted = settle(query.then(rows => rows));
      query.cancel();
      const cancelled = await inserted;
      // max is 1, so this query only runs when the cancelled one left the connection free.
      await table.insert(2);
      expect({ cancelled, rows: await table.rows() }).toEqual({
        cancelled: { code: code("QUERY_CANCELLED") },
        rows: [2],
      });
    });

    test("a query that is cancelled before close() is never sent", async () => {
      await using table = await openTable();
      const query = table.insert(1);
      const inserted = settle(query.then(rows => rows));
      query.cancel();
      await table.sql.close();
      expect({ query: await inserted, rows: await table.rows() }).toEqual({
        query: { code: code("QUERY_CANCELLED") },
        rows: [],
      });
    });

    // close() gave the query to the pool. A pool with a connection sent it at once.
    test("a query that is cancelled after close() was sent already", async () => {
      await using table = await openTable();
      const query = table.insert(1);
      const inserted = settle(query.then(() => "done"));
      const closed = table.sql.close();
      query.cancel();
      await closed;
      expect({ query: await inserted, rows: await table.rows() }).toEqual({ query: { value: "done" }, rows: [1] });
    });

    test("a query that is cancelled after close() is never sent when the pool had no connection", async () => {
      await using table = await openTable({ warm: false });
      const query = table.insert(1);
      const inserted = settle(query.then(rows => rows));
      const closed = table.sql.close();
      query.cancel();
      await closed;
      expect({ query: await inserted, rows: await table.rows() }).toEqual({
        query: { code: code("QUERY_CANCELLED") },
        rows: [],
      });
    });

    // A query of a reserved connection does not go through the pool, so close() does not send it.
    test("a query of a reserved connection that is cancelled after close() is never sent", async () => {
      await using table = await openTable();
      const reserved = await table.sql.reserve();
      const query = table.insert(1, reserved);
      const inserted = settle(query.then(rows => rows));
      const closed = table.sql.close();
      query.cancel();
      expect(await inserted).toEqual({ code: code("QUERY_CANCELLED") });
      reserved.release();
      await closed;
      expect(await table.rows()).toEqual([]);
    });
  });
}
