// https://github.com/oven-sh/bun/issues/43887
//
// A query reaches the pool in the call that starts it: in the call of then(), catch(), finally(), run() or
// execute(). So a close() that follows in the same tick waits for the query.
//
// Most tests use a real server. Each test writes rows with an id of its own, and a second pool reads them after
// the close: a row shows that the server got the statement.
import { SQL } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { describeWithContainer } from "harness";
import { closedPort, neverAnsweringServer } from "./wire-frames";

// Fault-injection tests: a server that never completes the handshake, and a port that refuses the connection. A
// healthy server does neither.
const drivers = [
  ["postgres", "postgres://postgres@", "ERR_POSTGRES_CONNECTION_CLOSED"],
  ["mysql", "mysql://root@", "ERR_MYSQL_CONNECTION_CLOSED"],
] as const;

for (const [name, scheme, closedCode] of drivers) {
  const started = (sql: SQL) =>
    sql`select 1 as x`.then(
      rows => ({ rows: [...rows] }),
      e => ({ code: e.code }),
    );

  test(`${name}: close() waits no longer than connectionTimeout for a query that started before it`, async () => {
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

  test(`${name}: a refused connection rejects a query that started before close()`, async () => {
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

    test("queries reach the server in the order of their starts", async () => {
      await using table = await openTable();
      const expected = Array.from({ length: 50 }, (_, x) => x);
      const names = Object.keys(starts);
      const inserted = expected.map(x => settle(starts[names[x % names.length]](table.insert(x)).then(() => x)));
      await table.sql.close();
      expect({ queries: await Promise.all(inserted), rows: await table.rows() }).toEqual({
        queries: expected.map(value => ({ value })),
        rows: expected,
      });
    });

    test("two close() calls in the same tick wait for a started query", async () => {
      await using table = await openTable();
      const inserted = settle(table.insert(1).then(() => "done"));
      await Promise.all([table.sql.close(), table.sql.close()]);
      expect({ query: await inserted, rows: await table.rows() }).toEqual({ query: { value: "done" }, rows: [1] });
    });

    test("close() waits for a query that started on a pool with no connection", async () => {
      await using table = await openTable({ warm: false });
      const inserted = settle(table.insert(1).then(() => "done"));
      await table.sql.close();
      expect({ query: await inserted, rows: await table.rows() }).toEqual({ query: { value: "done" }, rows: [1] });
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

    // What cancel() does to a query that started is not in these tests. The way that the query started must not
    // change it.
    for (const warm of [true, false]) {
      for (const [name, start] of Object.entries(starts)) {
        if (name === "execute()") continue;
        const pool = warm ? "a pool with a connection" : "a pool with no connection";
        test(`cancel() in the tick of ${name} does what it does in the tick of execute(), on ${pool}`, async () => {
          async function cancelAfter(start: (query: any) => Promise<unknown>) {
            await using table = await openTable({ warm });
            const query = table.insert(1);
            const settled = settle(start(query).then(() => "done"));
            query.cancel();
            const outcome = await settled;
            await table.sql.close();
            return { query: outcome, rows: await table.rows() };
          }
          expect(await cancelAfter(start)).toEqual(await cancelAfter(starts["execute()"]));
        });
      }
    }
  });
}
