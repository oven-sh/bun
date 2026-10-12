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

// sql("name") is a fragment for another statement, so nothing awaits it. A name
// that cannot be escaped is reported by what uses it, and by nothing when it is only made.
describe.each(adapters)("%s identifier with a NUL byte", (adapter, makeSql) => {
  const nulName = {
    code: "ERR_INVALID_ARG_VALUE",
    message: "The argument 'name' must not contain null bytes. Received 'col\\x00umn'",
  };
  const failure = (promise: PromiseLike<unknown>) =>
    promise.then(
      () => null,
      err => ({ code: err.code, message: err.message }),
    );

  test("fails each statement that uses it", async () => {
    await using sql = makeSql();
    await using other = makeSql();
    const name = sql("col\0umn");
    expect(name.constructor.name).toBe("Query");

    const errors = await Promise.all([
      sql`SELECT ${name} FROM t`.catch(e => e),
      sql`SELECT 1 FROM ${name}`.catch(e => e),
      // made by one client, used by another
      other`SELECT ${name} FROM t`.catch(e => e),
      // extra arguments do not make it a statement
      sql`SELECT ${(sql as any)("col\0umn", 1)} FROM t`.catch(e => e),
    ]);
    expect(errors.map(err => ({ type: err.constructor, code: err.code, message: err.message }))).toEqual(
      errors.map(() => ({ type: TypeError, ...nulName })),
    );
    // The stack shows where the identifier was made.
    expect(errors[0].stack).toContain(import.meta.filename);
  });

  test("fails when it is used as a statement", async () => {
    await using sql = makeSql();
    const make = () => sql("col\0umn") as any;
    expect({
      await: await failure(make()),
      then: await failure(make().then(() => {})),
      catch: await make().catch((err: any) => ({ code: err.code, message: err.message })),
      finally: await failure(make().finally(() => {})),
      execute: await failure(make().execute()),
      run: await failure(make().run()),
      values: await failure(make().values()),
      raw: await failure(make().raw()),
    }).toEqual({
      await: nulName,
      then: nulName,
      catch: nulName,
      finally: nulName,
      execute: nulName,
      run: nulName,
      values: nulName,
      raw: nulName,
    });
  });

  test("a valid identifier used as a statement still fails as not tagged", async () => {
    await using sql = makeSql();
    const make = () => sql("column") as any;
    const thrown = (fn: () => unknown) => {
      try {
        fn();
      } catch (err: any) {
        return err.code;
      }
      return null;
    };
    const notTagged = `ERR_${adapter.toUpperCase()}_NOT_TAGGED_CALL`;
    expect({
      await: (await failure(make()))?.code,
      then: (await failure(make().then(() => {})))?.code,
      execute: (await failure(make().execute()))?.code,
      run: (await failure(make().run()))?.code,
      catch: thrown(() => make().catch(() => {})),
      finally: thrown(() => make().finally(() => {})),
    }).toEqual({
      await: notTagged,
      then: notTagged,
      execute: notTagged,
      run: notTagged,
      catch: notTagged,
      finally: notTagged,
    });
  });
});

describe("sqlite identifier with a NUL byte in a transaction", () => {
  test("a statement that catches the name error leaves the transaction intact", async () => {
    await using sql = new SQL("sqlite://:memory:");
    await sql`CREATE TABLE t (a INT)`;
    const codes = await sql.begin(async tx => {
      const inTransaction = await tx`SELECT ${tx("a\0b")} FROM t`.catch(e => e.code);
      const inSavepoint = await tx.savepoint(async sp => await sp`SELECT ${sp("a\0b")} FROM t`.catch(e => e.code));
      const madeOnThePool = await tx`SELECT ${sql("a\0b")} FROM t`.catch(e => e.code);
      await tx`INSERT INTO ${tx("t")} (a) VALUES (1)`;
      return { inTransaction, inSavepoint, madeOnThePool };
    });
    expect(codes).toEqual({
      inTransaction: "ERR_INVALID_ARG_VALUE",
      inSavepoint: "ERR_INVALID_ARG_VALUE",
      madeOnThePool: "ERR_INVALID_ARG_VALUE",
    });
    expect(await sql`SELECT a FROM t`).toEqual([{ a: 1 }]);
  });

  test("a statement that does not catch it rejects begin() and rolls back", async () => {
    await using sql = new SQL("sqlite://:memory:");
    await sql`CREATE TABLE t (a INT)`;
    const begun = await sql
      .begin(async tx => {
        await tx`INSERT INTO t (a) VALUES (1)`;
        await tx`SELECT ${tx("a\0b")} FROM t`;
      })
      .catch(e => e.code);
    expect(begun).toBe("ERR_INVALID_ARG_VALUE");
    expect(await sql`SELECT a FROM t`).toEqual([]);

    const saved = await sql.begin(async tx => {
      await tx`INSERT INTO t (a) VALUES (1)`;
      return await tx
        .savepoint(async sp => {
          await sp`INSERT INTO t (a) VALUES (2)`;
          await sp`SELECT ${sp("a\0b")} FROM t`;
        })
        .catch(e => e.code);
    });
    expect(saved).toBe("ERR_INVALID_ARG_VALUE");
    expect(await sql`SELECT a FROM t`).toEqual([{ a: 1 }]);
  });
});

// Runs in a child process: the contract is what the process reports. An
// unhandled rejection prints to stderr and sets exit code 1.
test("an identifier with a NUL byte reports nothing unless something uses it", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const clients = {
        sqlite: new Bun.SQL("sqlite://:memory:"),
        postgres: new Bun.SQL("postgres://bun_sql_test@127.0.0.1:1/bun_sql_test", { max: 1 }),
        mysql: new Bun.SQL("mysql://bun_sql_test@127.0.0.1:1/bun_sql_test", { max: 1 }),
      };
      const report = {};
      for (const [adapter, sql] of Object.entries(clients)) {
        // made, never used
        const made = sql("a\\0b").constructor.name;
        // used: the caller handles the error where it uses the identifier
        let caught;
        try {
          await sql\`SELECT \${sql("a\\0b")} FROM t\`;
        } catch (err) {
          caught = err.code;
        }
        report[adapter] = { made, caught };
      }
      report.transaction = await clients.sqlite.begin(async tx => {
        const made = tx("a\\0b").constructor.name;
        const inSavepoint = await tx.savepoint(async sp => sp("a\\0b").constructor.name);
        return { made, inSavepoint };
      });
      console.log(JSON.stringify(report));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
    stdout: {
      sqlite: { made: "Query", caught: "ERR_INVALID_ARG_VALUE" },
      postgres: { made: "Query", caught: "ERR_INVALID_ARG_VALUE" },
      mysql: { made: "Query", caught: "ERR_INVALID_ARG_VALUE" },
      transaction: { made: "Query", inSavepoint: "Query" },
    },
    stderr: "",
    exitCode: 0,
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
