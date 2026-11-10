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
import { bunEnv, bunExe } from "harness";

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

describe.each(adapters)("%s dynamic identifier validation", (_adapter, makeSql) => {
  test("an identifier with a NUL byte throws where it is made", async () => {
    await using sql = makeSql();
    // not toThrow(): that also accepts a function that returns a rejected promise
    let err: any;
    try {
      sql("col\0umn");
    } catch (e) {
      err = e;
    }
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

describe.each(adapters)("%s helper keys", (_adapter, makeSql) => {
  test("a key is a string or a number", async () => {
    await using sql = makeSql();
    for (const key of [Symbol("k"), 1n, () => {}, null, {}]) {
      expect(() => sql({ a: 1 }, key as any)).toThrow("Keys must be strings or numbers: ");
    }
    for (const key of ["-1", "1.5", "Infinity", "1e3", "", 0]) {
      expect(() => sql({ a: 1 }, key as any)).not.toThrow();
    }
    expect(() => sql({ "-1": 1, "1.5": 2, Infinity: 3 })).not.toThrow();
  });
});

describe.each(adapters)("%s values of a nested sql.unsafe()", (adapter, makeSql) => {
  test("named parameters are refused where there are any: SQLite would bind NULL", async () => {
    await using sql = makeSql();
    const outcome = await sql`select ${sql.unsafe("$o as a", { $o: "bob" })}`.catch(e => e);
    if (adapter === "sqlite") {
      expect(outcome).toBeInstanceOf(SyntaxError);
      expect(outcome.message).toBe(
        "Nested sql.unsafe() cannot have named parameters: the query around it binds by position",
      );
    } else {
      expect(outcome.code).toEndWith("_CONNECTION_REFUSED");
    }
  });

  test("what has a length is read like an array", async () => {
    await using sql = makeSql();
    const outcome = await sql`select ${sql.unsafe("? as a", new Uint8Array([7]) as any)}`.catch(e => e);
    if (adapter === "sqlite") expect(outcome).toEqual([{ a: 7 }]);
    else expect(outcome.code).toEndWith("_CONNECTION_REFUSED");
  });

  test("none, an empty array and what has no length are no values", async () => {
    await using sql = makeSql();
    for (const fragment of [
      sql.unsafe("1 as a"),
      ...[null, undefined, [], 5, 0, "", false, true, 1n, Symbol("s"), {}, new Date(0), new Map([[1, 2]])].map(values =>
        sql.unsafe("1 as a", values as any),
      ),
      // the index
      ...["1 as a", "1 as a"].map(sql.unsafe as any),
    ]) {
      const outcome = await sql`select ${2} as b, ${fragment}, ${3} as c`.catch(e => e);
      if (adapter === "sqlite") expect(outcome).toEqual([{ b: 2, a: 1, c: 3 }]);
      else expect(outcome.code).toEndWith("_CONNECTION_REFUSED");
    }
  });

  test("sql.file() is not a fragment: its text is not read yet", async () => {
    await using sql = makeSql();
    const err = await sql`select ${sql.file("/does/not/exist.sql")}`.catch(e => e);
    expect(err).toBeInstanceOf(SyntaxError);
    expect(err.message).toBe("sql.file() cannot be used as a fragment of another query");
  });

  test("cannot follow other parameters where placeholders are numbered", async () => {
    await using sql = makeSql();
    for (const query of [
      () => sql`select ${3} as b, ${sql.unsafe("$1 as a", [2])}`,
      () => sql`select ${sql`${3} as b`}, ${sql`${sql.unsafe("$1 as a", [2])}`}`,
      () => sql`select 1 where 1 in ${sql([3])} and ${sql.unsafe("1 = $1", [2])}`,
    ]) {
      const outcome = await query().catch(e => e);
      if (adapter === "postgres") {
        expect(outcome).toBeInstanceOf(SyntaxError);
        expect(outcome.message).toStartWith("Nested sql.unsafe() cannot have values when it follows other parameters");
      } else {
        expect(outcome).not.toBeInstanceOf(SyntaxError);
      }
    }
    const first = await sql`select ${sql.unsafe("$1 as a", [2])}, ${3} as b`.catch(e => e);
    expect(first).not.toBeInstanceOf(SyntaxError);
  });
});

describe.each([
  ["postgres", "ERR_POSTGRES_UNSAFE_TRANSACTION"],
  ["mysql", "ERR_MYSQL_UNSAFE_TRANSACTION"],
])("%s unsafe transaction guard", (adapter, code) => {
  const makeSql = (max: number) => new SQL(`${adapter}://bun_sql_test@127.0.0.1:1/bun_sql_test`, { max });
  const codeOf = (sql: SQL, query: string) =>
    sql.unsafe(query).then(
      () => "resolved",
      e => e.code,
    );

  test("rejects a text that starts a transaction", async () => {
    await using sql = makeSql(2);
    const queries = [
      "BEGIN",
      "  Begin  ",
      "\r\n\t\v\fbegin transaction",
      " BEGIN",
      "begin;",
      "START TRANSACTION",
      "start transaction read only",
      "START\tTRANSACTION",
      "start  \n transaction",
      "/* trace */ BEGIN",
      "/**/begin",
      "/* a */ /* * b **/\n-- c\n  begin",
      "-- trace\nstart transaction",
    ];
    const codes: Record<string, string> = {};
    for (const query of queries) codes[query] = await codeOf(sql, query);
    expect(codes).toEqual(Object.fromEntries(queries.map(query => [query, code])));
  });

  test("lets everything else through to the connection", async () => {
    await using sql = makeSql(2);
    const queries = [
      "select * from beginners",
      "beginning",
      "begin_work()",
      "commit",
      "-- begin\nselect 1",
      "/* begin */ select 1",
      "/* begin",
      "-- begin",
      "",
      "BEG",
      "START ",
      "STARTTRANSACTION",
      "start transactions",
      // long runs that a backtracking pattern would try in every combination
      Buffer.alloc(200, " ").toString() + "select 1",
      Buffer.alloc(400, "/**/ ").toString() + "select 1",
    ];
    const codes = new Set<string>();
    for (const query of queries) codes.add(await codeOf(sql, query));
    expect([...codes]).toEqual([code.replace("UNSAFE_TRANSACTION", "CONNECTION_REFUSED")]);
  });

  test("is off when the pool has one connection", async () => {
    await using sql = makeSql(1);
    expect(await codeOf(sql, "begin")).toEndWith("_CONNECTION_REFUSED");
  });
});

test("Bun.SQL does not depend on globalThis.Array", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const RealArray = Array;
        globalThis.Array = () => {};
        const sql = new Bun.SQL("sqlite://:memory:");
        const rows = await sql\`select 1 as x\`;
        globalThis.Array = RealArray;
        console.log(Array.isArray(rows), rows instanceof Array, rows.map(row => row.x) instanceof Array, JSON.stringify(rows));
        await sql.close();
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr }).toEqual({ stdout: 'true true true [{"x":1}]\n', stderr: "" });
  expect(exitCode).toBe(0);
});

test("line and column of a PostgresError are PostgreSQL's fields or absent, never a place in a JavaScript source", async () => {
  await using sql = new SQL("postgres://bun_sql_test@127.0.0.1:1/bun_sql_test", { max: 2 });
  const madeByTheClient = await sql.unsafe("begin").catch(e => e);
  expect(madeByTheClient.code).toBe("ERR_POSTGRES_UNSAFE_TRANSACTION");
  const bare = new SQL.PostgresError("message", { code: "CODE" });
  for (const error of [madeByTheClient, bare]) {
    expect({ line: "line" in error, column: "column" in error, keys: Object.keys(error) }).toEqual({
      line: false,
      column: false,
      keys: ["name", "code"],
    });
  }
  expect(bare.stack).toContain("sql-helpers-validation.test.ts");

  const full = new SQL.PostgresError("message", { code: "CODE", column: "email", line: "2023" });
  expect({ ...full }).toEqual({ name: "PostgresError", code: "CODE", column: "email", line: "2023" });
  expect(Bun.inspect(full)).toContain('column: "email"');
});
