// Degenerate inputs to the sql() helpers (null/undefined items where objects
// are expected, update objects with no defined values) must surface clear
// validation errors from query normalization rather than raw TypeErrors or
// engine syntax errors. The validation contract is identical across the three
// adapters, so it is tested as one matrix. Normalization runs when a query is
// first awaited, before any connection is attempted, so the postgres and
// mysql rows need no live server: their URLs point at a closed port that is
// never actually dialed. The sqlite row uses an in-memory database.
// https://github.com/oven-sh/bun/issues/32155
//
// The same matrix also covers how sql(x) tells a tagged-template call apart
// from the sql(array) helper: that decision is made synchronously, before any
// connection, and a wrong answer splices the array's elements into the query
// as SQL text (demonstrated end to end against sqlite at the bottom).
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

const payload = "(0) UNION SELECT id, s FROM secrets";

// Data arrays that nevertheless carry a `raw` array. JSON.parse cannot produce
// these, but structuredClone/postMessage, Object.assign and deep-merge style
// body parsers all preserve or add arbitrary enumerable properties.
const arraysWithRaw: [string, () => string[]][] = [
  [
    "an array with an own raw of the same length",
    () => {
      const items: any = [payload];
      items.raw = [payload];
      return items;
    },
  ],
  [
    "an array with an own empty raw",
    () => {
      const items: any = [payload];
      items.raw = [];
      return items;
    },
  ],
  [
    "a structuredClone of an array with raw",
    () => {
      const items: any = [payload];
      items.raw = [payload];
      return structuredClone(items);
    },
  ],
  ["an array with raw merged in by Object.assign", () => Object.assign([], { 0: payload, raw: [payload] })],
];

// Runs fn while every array inherits a `raw` array, as after a prototype
// pollution bug in the application. Only synchronous work happens inside.
function withPollutedArrayPrototype<T>(fn: () => T): T {
  (Array.prototype as any).raw = [];
  try {
    return fn();
  } finally {
    delete (Array.prototype as any).raw;
  }
}

// Template objects as created by the engine and by downlevel compilers. All of
// them define `raw` as an own, non-enumerable, read-only, non-configurable array.
const templateObjects: [string, () => TemplateStringsArray][] = [
  ["an engine template object", () => ((strings: TemplateStringsArray) => strings)`SELECT 1 AS one`],
  [
    "a tsc __makeTemplateObject template (target es5)",
    () => {
      const cooked: any = ["SELECT 1 AS one"];
      Object.defineProperty(cooked, "raw", { value: ["SELECT 1 AS one"] });
      return cooked;
    },
  ],
  [
    "a babel/swc/esbuild taggedTemplateLiteral template",
    () => {
      const strings: any = ["SELECT 1 AS one"];
      return Object.freeze(Object.defineProperties(strings, { raw: { value: Object.freeze(strings.slice(0)) } }));
    },
  ],
];

describe.each(adapters)("%s template detection", (_adapter, makeSql) => {
  test.each(arraysWithRaw)("%s is a helper, not a query", async (_shape, makeItems) => {
    await using sql = makeSql();
    const items = makeItems();
    const helper = sql(items) as unknown as SQL.Helper<string>;
    expect(helper).not.toBeInstanceOf(Promise);
    expect(helper.value).toBe(items);
    expect(helper.columns).toEqual([]);
  });

  test("a polluted Array.prototype.raw does not turn arrays into queries", async () => {
    await using sql = makeSql();
    const items = [payload];
    const rows = [{ id: 2, name: "bob" }];
    const [inHelper, insertHelper] = withPollutedArrayPrototype(
      () =>
        [
          sql(items) as unknown as SQL.Helper<string>,
          sql(rows) as unknown as SQL.Helper<(typeof rows)[number]>,
        ] as const,
    );
    expect(inHelper).not.toBeInstanceOf(Promise);
    expect(inHelper.value).toBe(items);
    expect(inHelper.columns).toEqual([]);
    expect(insertHelper).not.toBeInstanceOf(Promise);
    expect(insertHelper.value).toBe(rows);
    expect(insertHelper.columns).toEqual(["id", "name"]);
  });

  test.each(templateObjects)("%s passed programmatically is still a query", async (_shape, makeTemplate) => {
    await using sql = makeSql();
    // Queries only connect once awaited, so this never dials the closed port.
    expect(sql(makeTemplate())).toBeInstanceOf(Promise);
  });
});

// What the decision above protects: spliced into the query as text, `payload`
// reads the secrets table; bound as a parameter it matches nothing.
describe("sqlite binds arrays carrying a raw property as parameters", () => {
  async function makeDatabase() {
    const sql = new SQL("sqlite://:memory:");
    await sql`CREATE TABLE users (id INTEGER, name TEXT)`;
    await sql`INSERT INTO users VALUES (1, 'alice')`;
    await sql`CREATE TABLE secrets (id INTEGER, s TEXT)`;
    await sql`INSERT INTO secrets VALUES (7, 'TOPSECRET')`;
    return sql;
  }

  test.each(arraysWithRaw)("WHERE IN given %s", async (_shape, makeItems) => {
    await using sql = await makeDatabase();
    expect(await sql`SELECT * FROM users WHERE id IN ${sql(makeItems())}`).toEqual([]);
  });

  test("every element of such an array is bound", async () => {
    await using sql = await makeDatabase();
    const names: any = ["alice", payload];
    names.raw = ["alice", payload];
    expect(await sql`SELECT * FROM users WHERE name IN ${sql(names)}`).toEqual([{ id: 1, name: "alice" }]);
  });

  test("WHERE IN inside a transaction", async () => {
    await using sql = await makeDatabase();
    const items: any = [payload];
    items.raw = [payload];
    expect(await sql.begin(tx => tx`SELECT * FROM users WHERE id IN ${tx(items)}`)).toEqual([]);
  });

  test("helpers created while Array.prototype.raw is polluted", async () => {
    await using sql = await makeDatabase();
    const [inHelper, insertHelper] = withPollutedArrayPrototype(
      () => [sql([payload] as any), sql([{ id: 2, name: "bob" }] as any)] as const,
    );
    expect(await sql`SELECT * FROM users WHERE id IN ${inHelper}`).toEqual([]);
    await sql`INSERT INTO users ${insertHelper}`;
    expect(await sql`SELECT * FROM users ORDER BY id`).toEqual([
      { id: 1, name: "alice" },
      { id: 2, name: "bob" },
    ]);
  });

  test.each(templateObjects)("%s passed programmatically executes", async (_shape, makeTemplate) => {
    await using sql = await makeDatabase();
    expect(await sql(makeTemplate())).toEqual([{ one: 1 }]);
  });
});
