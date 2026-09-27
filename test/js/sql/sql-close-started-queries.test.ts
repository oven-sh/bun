// https://github.com/oven-sh/bun/issues/43887
//
// A close() that waits runs the queries that started before it: the queries on which then(), catch(), finally(),
// run() or execute() was called before close().
//
// Most tests use a real server. Each test writes rows with an id of its own, and a second pool reads them after
// the close: a row shows that the server got the statement.
import { SQL } from "bun";
import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import { describeWithContainer } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  closedPort,
  listeningServer,
  mysqlAckSessionSetup,
  mysqlHandshakeV10,
  mysqlOkPacket,
  mysqlReadPackets,
  neverAnsweringServer,
  pgHold,
  pgMockServer,
} from "./wire-frames";

// Fault-injection tests: a server that gives no answer, a server that never completes the handshake, and a port
// that refuses the connection. A healthy server does none of these. All wire bytes come from ./wire-frames.ts.
const drivers = [
  ["postgres", "postgres://postgres@", "ERR_POSTGRES_CONNECTION_CLOSED"],
  ["mysql", "mysql://root@", "ERR_MYSQL_CONNECTION_CLOSED"],
] as const;

// Each mock completes the handshake and gives no answer to a query. `received` tells when the query arrives. It
// rejects when the client goes away with no query sent, so a test of an unsent query fails and does not hang.
const serversThatDoNotAnswer = {
  async postgres() {
    const received = Promise.withResolvers<void>();
    const { port, server } = await pgMockServer(type => {
      if (type !== "Q") return;
      received.resolve();
      return [pgHold];
    });
    server.on("connection", socket => socket.on("close", () => received.reject(new Error("no query was sent"))));
    return { port, server, received: received.promise };
  },
  async mysql() {
    const received = Promise.withResolvers<void>();
    const { port, server } = await listeningServer(socket => {
      let buffered: Buffer = Buffer.alloc(0);
      let authed = false;
      socket.write(mysqlHandshakeV10());
      socket.on("data", (chunk: Buffer) => {
        buffered = mysqlReadPackets(Buffer.concat([buffered, chunk]), (seq, payload) => {
          if (!authed) {
            authed = true;
            socket.write(mysqlOkPacket(seq + 1));
            return;
          }
          if (mysqlAckSessionSetup(socket, payload)) return;
          if (payload[0] === 0x03 /* COM_QUERY */) received.resolve();
        });
      });
      socket.on("error", () => {});
      socket.on("close", () => received.reject(new Error("no query was sent")));
    });
    return { port, server, received: received.promise };
  },
} as const;

const started = (sql: SQL) =>
  sql`select 1 as x`.simple().then(
    rows => ({ rows: [...rows] }),
    e => ({ code: e.code }),
  );

for (const [name, scheme, closedCode] of drivers) {
  test(`${name}: close({ timeout }) that expires rejects a query that started before it and was sent`, async () => {
    const { port, server, received } = await serversThatDoNotAnswer[name]();
    try {
      const sql = new SQL({ url: `${scheme}127.0.0.1:${port}/db`, max: 1 });
      await sql.connect();
      const query = started(sql);
      const closed = sql.close({ timeout: 0.05 });
      await received;
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
      const query = started(sql);
      await sql.close();
      expect(await query).toEqual({ code: closedCode.replace("CONNECTION_CLOSED", "CONNECTION_TIMEOUT") });
      await accepted;
    } finally {
      server.close();
    }
  });

  test(`${name}: close() opens the pool for a started query, and a refused connection rejects the query`, async () => {
    const sql = new SQL({ url: `${scheme}127.0.0.1:${await closedPort()}/db`, max: 1 });
    const query = started(sql);
    await sql.close();
    expect(await query).toEqual({ code: closedCode.replace("CONNECTION_CLOSED", "CONNECTION_REFUSED") });
  });
}

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
    const url = () => `${adapter}://${user}@${container.host}:${container.port}/bun_sql_test`;
    const tableName = "close_" + crypto.randomUUID().replaceAll("-", "");
    let reader: SQL;
    // One table for all the tests of the block. The hooks have the time that a busy server can need for DDL.
    beforeAll(async () => {
      await container.ready;
      reader = new SQL({ url: url(), max: 1 });
      await reader.unsafe(`CREATE TABLE ${tableName} (id ${serial}, test CHAR(36), x INT)`);
    }, 60_000);
    afterAll(async () => {
      await reader.unsafe(`DROP TABLE ${tableName}`);
      await reader.close();
    }, 60_000);

    // `warm: false` leaves the pool without a connection.
    async function openTable({ warm = true, ...options }: Bun.SQL.Options & { warm?: boolean } = {}) {
      const test = crypto.randomUUID();
      const sql = new SQL({ url: url(), max: 1, ...options });
      if (warm) await sql.connect();
      return {
        sql,
        insert: (x: number, on: SQL = sql) => on`INSERT INTO ${sql(tableName)} (test, x) VALUES (${test}, ${x})`,
        insertText: (x: number) => `INSERT INTO ${tableName} (test, x) VALUES ('${test}', ${x})`,
        rows: async () =>
          (await reader`SELECT x FROM ${reader(tableName)} WHERE test = ${test} ORDER BY id`).map(row => row.x),
        [Symbol.asyncDispose]: () => sql.close({ timeout: 0 }),
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
      "sql.unsafe()": { rows: [1], start: ({ sql, insertText }) => sql.unsafe(insertText(1)) },
      "two statements in simple()": {
        rows: [1, 2],
        start: ({ sql, insertText }) => sql.unsafe(`${insertText(1)}; ${insertText(2)}`).simple(),
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

// What the fix must not change: a query that starts, and is not yet with the pool, inside user code of the pool.
const als = new AsyncLocalStorage<string>();
// The ways to start a lazy query that give it to the pool in a later promise job.
const lazyStarts = {
  "then()": query => query.then(rows => rows),
  "catch()": query => query.catch(e => Promise.reject(e)),
  "finally()": query => query.finally(() => {}),
  "await": query => (async () => await query)(),
};

describeWithContainer("postgres: the start of a lazy query", { image: "postgres_plain" }, container => {
  const url = () => `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;
  // The store that a function-valued `password` observes. It runs when something makes the pool dial.
  function poolThatRecordsItsPassword() {
    const seen: (string | undefined)[] = [];
    const sql = als.run(
      "created",
      () => new SQL({ url: url(), max: 1, password: () => (seen.push(als.getStore()), "") }),
    );
    return { sql, seen };
  }

  for (const [name, start] of Object.entries(lazyStarts)) {
    test(`a function-valued password observes the store of the query that ${name} started`, async () => {
      await container.ready;
      const { sql, seen } = poolThatRecordsItsPassword();
      try {
        const rows = await als.run("starter", () => start(sql`select 1 as x`));
        expect({ rows, seen }).toEqual({ rows: [{ x: 1 }], seen: ["starter"] });
      } finally {
        await als.run("closer", () => sql.close());
      }
    });
  }

  // close() gives the query to the pool, so it is close() that makes the pool dial.
  test("a function-valued password observes the store of a close() that opens the pool for a started query", async () => {
    await container.ready;
    const { sql, seen } = poolThatRecordsItsPassword();
    const query = als.run("starter", () =>
      sql`select 1 as x`.then(
        rows => rows,
        e => e.code,
      ),
    );
    await als.run("closer", () => sql.close());
    expect({ rows: await query, seen }).toEqual({ rows: [{ x: 1 }], seen: ["closer"] });
  });

  // The server ends the session of the only connection. A query that starts inside the onclose that follows finds
  // no usable connection, so the pool dials again for it.
  for (const [name, start] of Object.entries(lazyStarts)) {
    test(`a query that ${name} starts inside onclose reconnects and resolves`, async () => {
      await container.ready;
      const started = Promise.withResolvers<unknown>();
      let closes = 0;
      const sql = new SQL({
        url: url(),
        max: 1,
        onclose() {
          if (++closes === 1) started.resolve(start(sql`select 2 as x`));
        },
      });
      try {
        const ended = await sql`select pg_terminate_backend(pg_backend_pid())`.catch(e => e.code);
        expect({ ended, rows: await started.promise }).toEqual({
          ended: "ERR_POSTGRES_SERVER_ERROR",
          rows: [{ x: 2 }],
        });
      } finally {
        await sql.close();
      }
    });
  }
});
