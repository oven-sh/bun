// A connection keeps its prepared statements in a cache. The key of a
// statement is its query text and the types of its parameters. A statement
// that the server refuses at COM_STMT_PREPARE leaves the cache, so the next
// query with that key prepares again: the error can be temporary, as for a
// table that a migration creates later. The queries that share the statement
// when it fails are rejected with its error.

import { SQL, randomUUIDv7 } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

// The rows of a query, or what it was rejected with.
const outcome = (query: Promise<unknown>) =>
  query.then(
    rows => rows,
    reason => ({
      rejected: {
        type: reason?.constructor?.name,
        errno: reason?.errno,
        sqlState: reason?.sqlState,
        message: reason?.message,
      },
    }),
  );
const noSuchTable = (table: string) => ({
  rejected: {
    type: "MySQLError",
    errno: 1146,
    sqlState: "42S02",
    message: `Table 'bun_sql_test.${table}' doesn't exist`,
  },
});
const newTable = () => "t_" + randomUUIDv7("hex").replaceAll("-", "");

// The prepares that the server has counted on this connection. A simple query
// reads the counter, so the read does not count.
const prepares = async (sql: SQL) =>
  Number((await sql.unsafe("SHOW SESSION STATUS LIKE 'Com_stmt_prepare'").simple())[0].Value);

describeWithContainer("mysql", { image: "mysql_plain" }, container => {
  // One connection, so that every query uses the same statement cache.
  async function connect() {
    await container.ready;
    return new SQL({ url: `mysql://root@${container.host}:${container.port}/bun_sql_test`, max: 1 });
  }

  // Runs the queries one by one. Returns what each one gave, and the prepares
  // that the server counted for each one.
  async function each(sql: SQL, queries: (() => Promise<unknown>)[]) {
    const outcomes: unknown[] = [];
    const prepared: number[] = [];
    for (const query of queries) {
      const before = await prepares(sql);
      outcomes.push(await outcome(query()));
      prepared.push((await prepares(sql)) - before);
    }
    return { outcomes, prepared };
  }

  const createTable = async (sql: SQL, table: string) => {
    await sql.unsafe(`CREATE TABLE \`${table}\` (id INT PRIMARY KEY, n INT)`).simple();
    await sql.unsafe(`INSERT INTO \`${table}\` VALUES (42, 7)`).simple();
  };
  const dropTable = (sql: SQL, table: string) => sql.unsafe(`DROP TABLE IF EXISTS \`${table}\``).simple();

  test("a query on a table that did not exist finds the table after it is created", async () => {
    await using sql = await connect();
    const table = newTable();
    const text = `SELECT n FROM \`${table}\` WHERE id = ? LIMIT 1`;
    const select = () => sql.unsafe(text, [42]);

    try {
      const missing = await each(sql, [select, select]);
      await createTable(sql, table);
      // The last query has the same text and one more space.
      const created = await each(sql, [select, select, () => sql.unsafe(text + " ", [42])]);

      expect({ missing, created }).toEqual({
        missing: { outcomes: [noSuchTable(table), noSuchTable(table)], prepared: [1, 1] },
        // The second query uses the statement that the first one prepared.
        created: { outcomes: [[{ n: 7 }], [{ n: 7 }], [{ n: 7 }]], prepared: [1, 0, 1] },
      });
    } finally {
      await dropTable(sql, table);
    }
  });

  test.each<[string, (sql: SQL, table: string) => Promise<unknown>]>([
    ["a parameter", (sql, table) => sql`SELECT n FROM ${sql(table)} WHERE id = ${42}`],
    ["no parameter", (sql, table) => sql`SELECT n FROM ${sql(table)}`],
  ])("a tagged template with %s prepares again after its prepare failed", async (_, query) => {
    await using sql = await connect();
    const table = newTable();
    const select = () => query(sql, table);

    try {
      const missing = await each(sql, [select, select]);
      await createTable(sql, table);
      const created = await each(sql, [select, select]);

      expect({ missing, created }).toEqual({
        missing: { outcomes: [noSuchTable(table), noSuchTable(table)], prepared: [1, 1] },
        created: { outcomes: [[{ n: 7 }], [{ n: 7 }]], prepared: [1, 0] },
      });
    } finally {
      await dropTable(sql, table);
    }
  });

  test("a failed prepare removes its own statement and no other", async () => {
    await using sql = await connect();
    const table = newTable();
    // A string: for `SELECT ?` with a number, MySQL 8.4 prepares the statement
    // again at its first execute and counts that.
    const healthy = () => sql`SELECT ${"h"} AS healthy`;
    const missing = () => sql`SELECT n FROM ${sql(table)} WHERE id = ${42}`;

    expect(await each(sql, [healthy, missing, healthy, missing, healthy])).toEqual({
      outcomes: [[{ healthy: "h" }], noSuchTable(table), [{ healthy: "h" }], noSuchTable(table), [{ healthy: "h" }]],
      prepared: [1, 1, 0, 1, 0],
    });
  });

  test("the queries that share a failed prepare are rejected with its error, and do not prepare again", async () => {
    await using sql = await connect();
    const table = newTable();
    const select = () => sql`SELECT n FROM ${sql(table)} WHERE id = ${42}`;

    // The queries start in one tick, so the second one shares the statement
    // that the first one prepares.
    const before = await prepares(sql);
    const outcomes = await Promise.all([select(), select()].map(outcome));
    expect({ outcomes, prepared: (await prepares(sql)) - before }).toEqual({
      outcomes: [noSuchTable(table), noSuchTable(table)],
      prepared: 1,
    });
  });

  test("a query that shares a failed prepare gets its message after the connection has read again", async () => {
    await using sql = await connect();
    const table = newTable();
    const select = () => sql`SELECT n FROM ${sql(table)} WHERE id = ${42}`;
    const filler = Buffer.alloc(1024, "Z").toString();

    // The queries start in one tick. The second `select` shares the statement
    // of the first one and waits behind a query that the connection has not
    // prepared: the connection reads the reply to that prepare before it
    // rejects the second `select`.
    const before = await prepares(sql);
    const outcomes = await Promise.all([select(), sql`SELECT ${filler} AS x`, select()].map(outcome));
    expect({ outcomes, prepared: (await prepares(sql)) - before }).toEqual({
      outcomes: [noSuchTable(table), [{ x: filler }], noSuchTable(table)],
      prepared: 2,
    });
  });

  test("a statement with a syntax error prepares again and gives the same error", async () => {
    await using sql = await connect();

    // Long bogus identifiers so the server's echoed error_message exceeds the 15-byte
    // inline-string threshold and is heap-backed, and so the two messages differ.
    // MySQL truncates the "near '...'" clause to ~80 chars, so keep these short
    // enough to appear in full.
    const longA = Buffer.alloc(50, "A").toString();
    const longZ = Buffer.alloc(50, "Z").toString();

    const err1 = await sql`wat ${1} ${sql.unsafe(longA)}`.catch((x: any) => x);
    expect(err1).toBeInstanceOf(Error);
    expect(err1.code).toBe("ERR_MYSQL_SYNTAX_ERROR");
    expect(err1.errno).toBe(1064);
    expect(err1.message).toContain(longA);

    const errOverwrite = await sql`other ${1} ${sql.unsafe(longZ)}`.catch((x: any) => x);
    expect(errOverwrite).toBeInstanceOf(Error);
    expect(errOverwrite.message).toContain(longZ);
    expect(errOverwrite.message).not.toBe(err1.message);

    // The same text as the first query. The server receives one more
    // COM_STMT_PREPARE and gives the error of the first query again.
    const preparesBefore = await prepares(sql);
    // err1 and errOverwrite each reached COM_STMT_PREPARE.
    expect(preparesBefore).toBeGreaterThan(0);
    const err2 = await sql`wat ${1} ${sql.unsafe(longA)}`.catch((x: any) => x);
    const preparesAfter = await prepares(sql);
    expect({
      code: err2.code,
      errno: err2.errno,
      sqlState: err2.sqlState,
      message: err2.message,
      preparesAfter,
    }).toEqual({
      code: err1.code,
      errno: err1.errno,
      sqlState: err1.sqlState,
      message: err1.message,
      preparesAfter: preparesBefore + 1,
    });
    expect(err2).toBeInstanceOf(Error);
    expect(err2.message).toContain(longA);
    expect(err2.message).not.toContain(longZ);
  });
});
