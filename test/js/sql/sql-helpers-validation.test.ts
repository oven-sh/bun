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
import { tempDir } from "harness";
import { join } from "node:path";

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

  // The outer query takes a nested fragment's values by index, so only an array can carry them.
  const received = (what: string) => `Nested sql.unsafe() fragment values must be an array, received ${what}`;

  test("a nested sql.unsafe() fragment whose values are not an array is rejected", async () => {
    await using sql = makeSql();
    const notArrays: [unknown, string][] = [
      [{ $o: "bob" }, received("an object")],
      [{}, received("an object")],
      [new Uint8Array([1]), received("an object")],
      [new Date(0), received("an object")],
      [new Map(), received("an object")],
      ["abc", received("a string")],
      ["", received("a string")],
      [0, received("a number")],
      [5, received("a number")],
      [false, received("a boolean")],
      [1n, received("a bigint")],
    ];
    for (const [values, message] of notArrays) {
      const fragment = () => sql.unsafe("?", values as any);
      for (const query of [
        () => sql`SELECT ${fragment()}`,
        () => sql`SELECT ${fragment()}`.values(),
        () => sql`SELECT ${fragment()}`.raw(),
        // inside a nested template fragment
        () => sql`SELECT ${sql`${fragment()}`}`,
        // with outer values before and after it
        () => sql`SELECT ${1}, ${fragment()}, ${2}`,
      ]) {
        const err = await query().catch(e => e);
        expect(err).toBeInstanceOf(SyntaxError);
        expect(err.message).toBe(message);
      }
    }
  });

  test("sql.unsafe passed to Array#map takes the index as its values and is rejected when nested", async () => {
    await using sql = makeSql();
    const [only] = ["1 AS a"].map(sql.unsafe as any);
    const [a, b] = ["1 AS a", "2 AS b"].map(sql.unsafe as any);
    for (const query of [() => sql`SELECT ${only}`, () => sql`SELECT ${a}, ${b}`]) {
      const err = await query().catch(e => e);
      expect(err).toBeInstanceOf(SyntaxError);
      expect(err.message).toBe(received("a number"));
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

// sql.unsafe() and sql.file() take their values as an array, and only undefined and null mean
// "no values". Any other value goes to the adapter: 0, false and "" like 5, true and "abc".

// bun:sqlite takes one scalar as one positional value.
describe.each([false, true])("sqlite direct unsafe() values (strict: %p)", strict => {
  // [values, what SQLite stores, its type]
  const scalars: [unknown, unknown, string][] = [
    [0, 0, "integer"],
    [-0, -0, "real"],
    [false, 0, "integer"],
    ["", "", "text"],
    [0n, 0, "integer"],
    [5, 5, "integer"],
    [true, 1, "integer"],
    ["abc", "abc", "text"],
    [1n, 1, "integer"],
    // bun:sqlite binds NaN as NULL.
    [NaN, null, "null"],
  ];
  const makeDb = async () => {
    const db = new SQL({ adapter: "sqlite", filename: ":memory:", strict });
    await db`CREATE TABLE scalars (v)`;
    return db;
  };

  test.each(scalars)("a scalar %p binds as one positional value", async (value, stored, type) => {
    await using db = await makeDb();
    const select = () => db.unsafe("SELECT ? AS v, typeof(?1) AS type", value as any);
    expect(await select()).toEqual([{ v: stored, type }]);
    expect(await select().execute()).toEqual([{ v: stored, type }]);
    expect(await select().values()).toEqual([[stored, type]]);

    // A statement that returns no rows takes the other path of the adapter, db.run().
    await db.unsafe("INSERT INTO scalars (v) VALUES (?)", value as any);
    expect(await db`SELECT v, typeof(v) AS type FROM scalars`).toEqual([{ v: stored, type }]);
  });

  test("sql.file, tx.unsafe and tx.file bind a falsy scalar", async () => {
    await using db = await makeDb();
    using dir = tempDir("sqlite-unsafe-scalar", {
      "select.sql": "SELECT ? AS v",
      "insert.sql": "INSERT INTO scalars (v) VALUES (?)",
    });
    const file = (name: string) => join(String(dir), name);

    expect(await db.file(file("select.sql"), 0 as any)).toEqual([{ v: 0 }]);
    await db.begin(async tx => {
      expect(await tx.unsafe("SELECT ? AS v", "" as any)).toEqual([{ v: "" }]);
      expect(await tx.file(file("select.sql"), false as any)).toEqual([{ v: 0 }]);
      await tx.unsafe("INSERT INTO scalars (v) VALUES (?)", 0 as any);
      await tx.file(file("insert.sql"), "" as any);
    });
    expect(await db`SELECT v FROM scalars ORDER BY rowid`).toEqual([{ v: 0 }, { v: "" }]);
  });

  // One scalar is one value, and bun:sqlite takes it only for a statement with one parameter.
  test("a falsy scalar is rejected like a truthy one when the statement does not have one parameter", async () => {
    await using db = await makeDb();
    const outcome = (query: PromiseLike<unknown>) =>
      query.then(
        rows => rows,
        e => e.message,
      );
    for (const value of [0, false, "", 0n, 5]) {
      expect({
        value,
        noParameter: await outcome(db.unsafe("INSERT INTO scalars (v) VALUES ('k')", value as any)),
        twoParameters: await outcome(db.unsafe("INSERT INTO scalars (v) VALUES (?), (?)", value as any)),
        twoParametersAndRows: await outcome(db.unsafe("SELECT ? AS a, ? AS b", value as any)),
        // A statement that has no parameter and returns rows does not look at its values.
        noParameterAndRows: await outcome(db.unsafe("SELECT 1 AS a", value as any)),
      }).toEqual({
        value,
        noParameter: "SQLite query expected 0 values, received 1",
        twoParameters: "SQLite query expected 2 values, received 1",
        twoParametersAndRows: "SQLite query expected 2 values, received 1",
        noParameterAndRows: [{ a: 1 }],
      });
    }
    expect(await db`SELECT count(*) AS count FROM scalars`).toEqual([{ count: 0 }]);
  });

  test("undefined, null and an empty array still mean no values", async () => {
    await using db = await makeDb();
    for (const values of [undefined, null, []]) {
      await db.unsafe("INSERT INTO scalars (v) VALUES ('k')", values as any);
    }
    expect(await db`SELECT count(*) AS count FROM scalars`).toEqual([{ count: 3 }]);
  });
});

// PostgreSQL and MySQL reject it when the query starts, before they dial.
const serverAdapters = adapters.filter(([adapter]) => adapter !== "sqlite");

describe.each(serverAdapters)("%s direct unsafe() values", (_adapter, makeSql) => {
  const rejected = "values must be an array";
  const outcome = (query: PromiseLike<unknown>) =>
    query.then(
      () => "resolved",
      e => e.message,
    );

  test.each([0, -0, NaN, false, "", 0n, 5, true, "abc", 1n])("a scalar %p is rejected", async value => {
    await using sql = makeSql();
    using dir = tempDir("sql-unsafe-values", { "query.sql": "SELECT 1" });
    const query = () => sql.unsafe("SELECT 1", value as any);
    expect({
      await: await outcome(query()),
      execute: await outcome(query().execute()),
      values: await outcome(query().values()),
      raw: await outcome(query().raw()),
      run: await outcome((query() as any).run()),
      file: await outcome(sql.file(join(String(dir), "query.sql"), value as any)),
    }).toEqual({
      await: rejected,
      execute: rejected,
      values: rejected,
      raw: rejected,
      run: rejected,
      file: rejected,
    });
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
