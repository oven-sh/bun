// Degenerate inputs to the sql() helpers (null/undefined items where objects
// are expected, update objects with no defined values) must surface clear
// validation errors from query normalization rather than raw TypeErrors or
// engine syntax errors. The validation contract is identical across the three
// adapters, so it is tested as one matrix. Normalization runs when a query is
// first awaited, before any connection is attempted, so the postgres and
// mysql rows need no live server: their URLs point at a closed port that is
// never actually dialed. The sqlite row uses an in-memory database.
// https://github.com/oven-sh/bun/issues/32155
import { SQL } from "bun";
import { describe, expect, test } from "bun:test";

const adapters: [string, () => SQL][] = [
  ["sqlite", () => new SQL("sqlite://:memory:")],
  ["postgres", () => new SQL("postgres://bun_sql_test@127.0.0.1:1/bun_sql_test", { max: 1 })],
  ["mysql", () => new SQL("mysql://bun_sql_test@127.0.0.1:1/bun_sql_test", { max: 1 })],
];

describe.each(adapters)("%s helper validation", (_adapter, makeSql) => {
  test("null items in WHERE IN helper with a column are rejected", async () => {
    await using sql = makeSql();
    for (const items of [[null], [{ id: 1 }, null]]) {
      const err = await sql`SELECT * FROM t WHERE id IN ${sql(items as any, "id")}`.catch(e => e);
      expect(err).toBeInstanceOf(SyntaxError);
      expect(err.message).toBe("Cannot use null as an item in WHERE IN helper with a column");
    }
  });

  test("null and undefined items in INSERT helper are rejected", async () => {
    await using sql = makeSql();
    for (const item of [null, undefined]) {
      const err = await sql`INSERT INTO t ${sql([{ id: 1 }, item as any])}`.catch(e => e);
      expect(err).toBeInstanceOf(SyntaxError);
      expect(err.message).toBe("Cannot use null or undefined as an item in INSERT helper");
    }
  });

  test("null and undefined items in UPDATE helper are rejected", async () => {
    await using sql = makeSql();
    const err1 = await sql`UPDATE t SET ${sql(null as any, "name")} WHERE id = 1`.catch(e => e);
    expect(err1).toBeInstanceOf(SyntaxError);
    expect(err1.message).toBe("Cannot use null or undefined as an item in UPDATE helper");

    const err2 = await sql`UPDATE t SET ${sql([undefined as any], "name")} WHERE id = 1`.catch(e => e);
    expect(err2).toBeInstanceOf(SyntaxError);
    expect(err2.message).toBe("Cannot use null or undefined as an item in UPDATE helper");
  });

  test("empty update helper throws regardless of SET casing", async () => {
    await using sql = makeSql();
    for (const query of [
      () => sql`update t set ${sql({ name: undefined })} where id = 1`,
      () => sql`UPDATE t SET ${sql({ name: undefined })} WHERE id = 1`,
      // the helper emits SET itself when the query does not end with one
      () => sql`update t ${sql({ name: undefined })} where id = 1`,
    ]) {
      const err = await query().catch(e => e);
      expect(err).toBeInstanceOf(SyntaxError);
      expect(err.message).toBe("Update needs to have at least one column");
    }
  });

  test("empty update helper throws even alongside a literal assignment", async () => {
    // sqlite previously allowed the helper-last form of this (it stripped the
    // trailing comma and executed the literal assignment) while throwing for
    // the helper-first form; postgres and mysql throw for both. All three now
    // throw for both orders.
    await using sql = makeSql();
    for (const query of [
      () => sql`UPDATE t SET updated_at = CURRENT_TIMESTAMP, ${sql({ name: undefined })} WHERE id = 1`,
      () => sql`UPDATE t SET ${sql({ name: undefined })}, updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
    ]) {
      const err = await query().catch(e => e);
      expect(err).toBeInstanceOf(SyntaxError);
      expect(err.message).toBe("Update needs to have at least one column");
    }
  });
});

const distributedAdapters: [string, () => SQL][] = [
  ["postgres", () => new SQL("postgres://bun_sql_test@127.0.0.1:1/bun_sql_test", { max: 1 })],
  ["mysql", () => new SQL("mysql://bun_sql_test@127.0.0.1:1/bun_sql_test", { max: 1 })],
];

describe.each(distributedAdapters)("%s distributed transaction name validation", (_adapter, makeSql) => {
  const invalidNames = [["tx'name"], 42, null, undefined, { toString: () => "tx" }];

  test("commitDistributed requires the transaction name to be a string", async () => {
    await using sql = makeSql();
    for (const name of invalidNames) {
      const err = await sql.commitDistributed(name as any).catch(e => e);
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe("Distributed transaction name must be a string.");
    }
  });

  test("rollbackDistributed requires the transaction name to be a string", async () => {
    await using sql = makeSql();
    for (const name of invalidNames) {
      const err = await sql.rollbackDistributed(name as any).catch(e => e);
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe("Distributed transaction name must be a string.");
    }
  });
});

describe("postgres dynamic identifier validation", () => {
  test("identifiers containing a NUL byte are rejected", async () => {
    await using sql = new SQL("postgres://bun_sql_test@127.0.0.1:1/bun_sql_test", { max: 1 });
    const err = await (sql("col\0umn") as unknown as Promise<any>).catch(e => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(err.code).toBe("ERR_INVALID_ARG_VALUE");
    expect(err.message).toStartWith("The argument 'name' must not contain null bytes. Received ");
  });

  test("insert helper column names containing a NUL byte are rejected", async () => {
    await using sql = new SQL("postgres://bun_sql_test@127.0.0.1:1/bun_sql_test", { max: 1 });
    const err = await sql`INSERT INTO t ${sql([{ ["col\0umn"]: 1 }])}`.catch(e => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(err.code).toBe("ERR_INVALID_ARG_VALUE");
    expect(err.message).toStartWith("The argument 'name' must not contain null bytes. Received ");
  });
});

const identifierAdapters: [string, () => SQL][] = [
  ["sqlite", () => new SQL("sqlite://:memory:")],
  ["mysql", () => new SQL("mysql://bun_sql_test@127.0.0.1:1/bun_sql_test", { max: 1 })],
];

describe.each(identifierAdapters)("%s dynamic identifier validation", (_adapter, makeSql) => {
  test("identifiers containing a NUL byte are rejected", async () => {
    await using sql = makeSql();
    const err = await (sql("col\0umn") as unknown as Promise<any>).catch(e => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(err.code).toBe("ERR_INVALID_ARG_VALUE");
    expect(err.message).toStartWith("The argument 'name' must not contain null bytes. Received ");
  });

  test("insert helper column names containing a NUL byte are rejected", async () => {
    await using sql = makeSql();
    const err = await sql`INSERT INTO t ${sql([{ ["col\0umn"]: 1 }])}`.catch(e => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(err.code).toBe("ERR_INVALID_ARG_VALUE");
    expect(err.message).toStartWith("The argument 'name' must not contain null bytes. Received ");
  });
});

// Behaviors that must keep working; these execute real queries, so they run
// against sqlite only.
describe("sqlite helper behavior preserved", () => {
  test("update helper with lowercase set and defined values still works", async () => {
    await using sql = new SQL("sqlite://:memory:");
    await sql`CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, age INT)`;
    await sql`INSERT INTO t ${sql({ id: 1, name: "John", age: 30 })}`;

    await sql`update t set ${sql({ name: "Mary", age: undefined })} where id = 1`;
    expect(await sql`SELECT * FROM t`).toEqual([{ id: 1, name: "Mary", age: 30 }]);
  });

  test("update helper alongside a literal assignment still works with defined values", async () => {
    await using sql = new SQL("sqlite://:memory:");
    await sql`CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, flag INT)`;
    await sql`INSERT INTO t (id, name, flag) VALUES (1, 'John', 0)`;

    await sql`UPDATE t SET flag = 1, ${sql({ name: "Mary", age: undefined })} WHERE id = 1`;
    expect(await sql`SELECT * FROM t`).toEqual([{ id: 1, name: "Mary", flag: 1 }]);
  });

  test("undefined items and null column values in WHERE IN helper still bind NULL", async () => {
    await using sql = new SQL("sqlite://:memory:");
    // an undefined item binds NULL
    expect(await sql`SELECT 1 as num WHERE 1 IN ${sql([undefined as any, { id: 1 }], "id")}`).toEqual([{ num: 1 }]);
    // a null value under the column key binds NULL
    expect(await sql`SELECT 1 as num WHERE 1 IN ${sql([{ id: null }, { id: 1 }], "id")}`).toEqual([{ num: 1 }]);
    // a null item without a column binds NULL
    expect(await sql`SELECT 1 as num WHERE 1 IN ${sql([null, 1])}`).toEqual([{ num: 1 }]);
  });
});

// The command a helper belongs to is found by scanning the query backwards for
// the nearest keyword. The scan is case-insensitive, and what precedes the
// keyword must not change the answer however long it is. Both scanners (the
// shared one for postgres/mysql, and sqlite's own) are covered.
const detectionAdapters: [string, string, () => SQL][] = [
  [
    "postgres",
    "Helpers are only allowed for INSERT, UPDATE and IN commands",
    () => new SQL("postgres://bun_sql_test@127.0.0.1:1/bun_sql_test", { max: 1 }),
  ],
  [
    "mysql",
    "Helpers are only allowed for INSERT, UPDATE and IN commands",
    () => new SQL("mysql://bun_sql_test@127.0.0.1:1/bun_sql_test", { max: 1 }),
  ],
  ["sqlite", "Helpers are only allowed for INSERT, UPDATE and WHERE IN commands", () => new SQL("sqlite://:memory:")],
];

describe.each(detectionAdapters)("%s helper command detection", (_adapter, noKeywordMessage, makeSql) => {
  test("INSERT is matched in any case", async () => {
    await using sql = makeSql();
    for (const query of [
      () => sql`INSERT INTO t ${sql({})}`,
      () => sql`insert into t ${sql({})}`,
      () => sql`InSeRt InTo t ${sql({})}`,
    ]) {
      const err = await query().catch(e => e);
      expect(err).toBeInstanceOf(SyntaxError);
      expect(err.message).toBe("Cannot INSERT with no columns");
    }
  });

  test("UPDATE and SET are matched in any case", async () => {
    await using sql = makeSql();
    for (const query of [
      () => sql`UPDATE t SET ${sql({})}`,
      () => sql`update t set ${sql({})}`,
      () => sql`UpDaTe t SeT ${sql({})}`,
      () => sql`update t ${sql({})}`,
    ]) {
      const err = await query().catch(e => e);
      expect(err).toBeInstanceOf(SyntaxError);
      expect(err.message).toBe("Cannot UPDATE with no columns");
    }
  });

  test("every whitespace character separates the keyword from the helper", async () => {
    await using sql = makeSql();
    for (const query of [
      () => sql`INSERT INTO t\n${sql({})}`,
      () => sql`INSERT INTO t\t${sql({})}`,
      () => sql`INSERT INTO t\r${sql({})}`,
      () => sql`INSERT INTO t\f${sql({})}`,
      () => sql`INSERT INTO t\v${sql({})}`,
      () => sql`INSERT INTO t   ${sql({})}`,
    ]) {
      const err = await query().catch(e => e);
      expect(err).toBeInstanceOf(SyntaxError);
      expect(err.message).toBe("Cannot INSERT with no columns");
    }
  });

  test("a keyword inside a quoted identifier is not matched", async () => {
    await using sql = makeSql();
    const err = await sql`SELECT * FROM "insert" ${sql({})}`.catch(e => e);
    expect(err).toBeInstanceOf(SyntaxError);
    expect(err.message).toBe(noKeywordMessage);
  });

  test("quoted characters are dropped from the token, not treated as separators", async () => {
    await using sql = makeSql();
    // A quoted run next to the keyword leaves the keyword intact, because the
    // quoted characters are removed rather than ending the token.
    const attached = await sql`"x"INSERT INTO t ${sql({})}`.catch(e => e);
    expect(attached).toBeInstanceOf(SyntaxError);
    expect(attached.message).toBe("Cannot INSERT with no columns");

    // A quoted run inside the keyword breaks it, because what is left is not it.
    for (const query of [() => sql`IN"S"ERT INTO t ${sql({})}`, () => sql`S"E"T ${sql({})}`]) {
      const err = await query().catch(e => e);
      expect(err).toBeInstanceOf(SyntaxError);
      expect(err.message).toBe(noKeywordMessage);
    }
  });

  test("a long query before the keyword does not change the command", async () => {
    await using sql = makeSql();
    // The scan only needs the token nearest the helper, so a large body in
    // front of it must not change what is detected.
    const padding = Buffer.alloc(100_000, "x").toString();

    const insert = await sql`INSERT INTO t /* ${sql.unsafe(padding)} */ ${sql({})}`.catch(e => e);
    expect(insert).toBeInstanceOf(SyntaxError);
    expect(insert.message).toBe("Cannot INSERT with no columns");

    const update = await sql`UPDATE t SET /* ${sql.unsafe(padding)} */ ${sql({})}`.catch(e => e);
    expect(update).toBeInstanceOf(SyntaxError);
    expect(update.message).toBe("Cannot UPDATE with no columns");

    // and a long query with no keyword at all is still rejected
    const none = await sql`SELECT * FROM t /* ${sql.unsafe(padding)} */ ${sql({})}`.catch(e => e);
    expect(none).toBeInstanceOf(SyntaxError);
    expect(none.message).toBe(noKeywordMessage);
  });
});

describe("bare ANY/ALL is only IN on mysql", () => {
  // A query that is nothing but ANY or ALL reaches the end-of-scan branch rather
  // than the whitespace branch, and only mysql treats it as IN there. This is
  // the one caller of that branch, so it is easy to lose in a refactor.
  test("postgres rejects the helper", async () => {
    await using sql = new SQL("postgres://bun_sql_test@127.0.0.1:1/bun_sql_test", { max: 1 });
    for (const query of [() => sql`any ${sql([1, 2])}`, () => sql`ALL ${sql([1, 2])}`]) {
      const err = await query().catch(e => e);
      expect(err).toBeInstanceOf(SyntaxError);
      expect(err.message).toBe("Helpers are only allowed for INSERT, UPDATE and IN commands");
    }
  });

  test("mysql accepts the helper and goes on to connect", async () => {
    await using sql = new SQL("mysql://bun_sql_test@127.0.0.1:1/bun_sql_test", { max: 1 });
    for (const query of [() => sql`any ${sql([1, 2])}`, () => sql`ALL ${sql([1, 2])}`]) {
      const err = await query().catch(e => e);
      expect(err).not.toBeInstanceOf(SyntaxError);
      expect(err.message).toBe("Failed to connect");
    }
  });
});
