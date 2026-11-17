import { SQL, randomUUIDv7 } from "bun";
import { Database } from "bun:sqlite";
import { beforeAll, describe, expect, test } from "bun:test";
import { describeWithContainer, tempDir } from "harness";
import { join } from "node:path";

describe("the six functions", () => {
  // postgres.js 3.4.9 gives the same, but for "trailing_" (toCamel and toPascal throw) and "" (undefined, throws).
  test.each([
    // name, toCamel, toPascal, toKebab, fromCamel, fromPascal
    ["user_id", "userId", "UserId", "user-id", "user_id", "user_id"],
    ["USER_ID", "USERID", "USERID", "USER-ID", "_u_s_e_r__i_d", "u_s_e_r__i_d"],
    ["_private", "_private", "_private", "-private", "_private", "_private"],
    ["a__b", "a_b", "A_b", "a--b", "a__b", "a__b"],
    ["trailing_", "trailing_", "Trailing_", "trailing-", "trailing_", "trailing_"],
    ["user_id_2", "userId2", "UserId2", "user-id-2", "user_id_2", "user_id_2"],
    ["créée_à", "crééeÀ", "CrééeÀ", "créée-à", "créée_à", "créée_à"], // prettier-ignore
    ["x_ß", "xSS", "XSS", "x-ß", "x_ß", "x_ß"],
    ["x_\u{1f600}", "x\u{1f600}", "X\u{1f600}", "x-\u{1f600}", "x_\u{1f600}", "x_\u{1f600}"],
    ["userID", "userID", "UserID", "userID", "user_i_d", "user_i_d"],
    ["UserId", "UserId", "UserId", "UserId", "_user_id", "user_id"],
    ["", "", "", "", "", ""],
    ["_", "_", "_", "-", "_", "_"],
  ])("%p", (name, camel, pascal, kebab, uncamel, unpascal) => {
    expect({
      toCamel: SQL.toCamel(name),
      toPascal: SQL.toPascal(name),
      toKebab: SQL.toKebab(name),
      fromCamel: SQL.fromCamel(name),
      fromPascal: SQL.fromPascal(name),
    }).toEqual({ toCamel: camel, toPascal: pascal, toKebab: kebab, fromCamel: uncamel, fromPascal: unpascal });
  });

  test("fromKebab", () => {
    expect(["user-id", "a--b", "-x-", "user_id", ""].map(SQL.fromKebab)).toEqual([
      "user_id",
      "a__b",
      "_x_",
      "user_id",
      "",
    ]);
  });

  test("a preset is both directions, a function is one", () => {
    expect({ camel: SQL.camel, pascal: SQL.pascal, kebab: SQL.kebab }).toEqual({
      camel: { column: { from: SQL.toCamel, to: SQL.fromCamel } },
      pascal: { column: { from: SQL.toPascal, to: SQL.fromPascal } },
      kebab: { column: { from: SQL.toKebab, to: SQL.fromKebab } },
    });
    const parsed = (transform: unknown) => new SQL(":memory:", { transform } as never).options.transform?.column;
    expect({
      camel: parsed(SQL.camel),
      toCamel: parsed(SQL.toCamel),
      fromCamel: parsed(SQL.fromCamel),
      toPascal: parsed(SQL.toPascal),
      fromPascal: parsed(SQL.fromPascal),
      toKebab: parsed(SQL.toKebab),
      fromKebab: parsed(SQL.fromKebab),
    }).toEqual({
      camel: { from: SQL.toCamel, to: SQL.fromCamel },
      toCamel: { from: SQL.toCamel, to: undefined },
      fromCamel: { from: undefined, to: SQL.fromCamel },
      toPascal: { from: SQL.toPascal, to: undefined },
      fromPascal: { from: undefined, to: SQL.fromPascal },
      toKebab: { from: SQL.toKebab, to: undefined },
      fromKebab: { from: undefined, to: SQL.fromKebab },
    });
  });
});

describe.each(["sqlite://:memory:", "postgres://u@127.0.0.1:1/d", "mysql://u@127.0.0.1:1/d"])("the option, %s", url => {
  const upper = (name: string) => name.toUpperCase();
  const lower = (name: string) => name.toLowerCase();

  test.each<[unknown, unknown]>([
    [{}, { undefined: undefined, column: { from: undefined, to: undefined } }],
    [{ column: upper }, { undefined: undefined, column: { from: upper, to: undefined } }],
    [{ column: { from: upper } }, { undefined: undefined, column: { from: upper, to: undefined } }],
    [{ column: { to: lower } }, { undefined: undefined, column: { from: undefined, to: lower } }],
    [
      { column: { from: upper, to: lower }, undefined: null },
      { undefined: null, column: { from: upper, to: lower } },
    ],
    [{ column: { from: null, to: undefined } }, { undefined: undefined, column: { from: undefined, to: undefined } }],
    [
      { column: null, undefined: 0 },
      { undefined: 0, column: { from: undefined, to: undefined } },
    ],
    [
      { ...SQL.kebab, undefined: null },
      { undefined: null, column: { from: SQL.toKebab, to: SQL.fromKebab } },
    ],
  ])("%p", async (transform, parsed) => {
    await using sql = new SQL(url, { transform } as never);
    expect(sql.options.transform).toEqual(parsed);
  });

  test("not given", async () => {
    await using sql = new SQL(url);
    expect(sql.options.transform).toBeUndefined();
    await using nothing = new SQL(url, { transform: undefined } as never);
    expect(nothing.options.transform).toBeUndefined();
  });

  test.each<[unknown, string]>([
    ["camel", "The \"transform\" argument must be of type object. Received type string ('camel')"],
    [1, 'The "transform" argument must be of type object. Received type number (1)'],
    [true, 'The "transform" argument must be of type object. Received type boolean (true)'],
    // not a shape of postgres.js either: it says neither which names nor which direction
    [upper, 'The "transform" argument must be of type object. Received function upper'],
    [{ column: "camel" }, 'The "transform.column" property must be one of type function or object. Received type string (\'camel\')'], // prettier-ignore
    [{ column: { from: "camel" } }, 'The "transform.column.from" property must be of type function. Received type string (\'camel\')'], // prettier-ignore
    [{ column: { to: {} } }, 'The "transform.column.to" property must be of type function. Received an instance of Object'], // prettier-ignore
  ])("%p throws", (transform, message) => {
    expect(() => new SQL(url, { transform } as never)).toThrow(
      expect.objectContaining({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE", message }),
    );
  });

  test("every property is read once", async () => {
    const reads: string[] = [];
    const spy = <T extends object>(name: string, target: T) =>
      new Proxy(target, {
        get(target, key, receiver) {
          if (typeof key === "string") reads.push(`${name}.${key}`);
          return Reflect.get(target, key, receiver);
        },
      });
    await using sql = new SQL(url, {
      transform: spy("transform", { undefined: null, column: spy("column", { from: upper, to: lower }) }),
    } as never);
    expect(reads.toSorted()).toEqual(["column.from", "column.to", "transform.column", "transform.undefined"]);
  });
});

type Dialect = "sqlite" | "postgres" | "mysql" | "mariadb";
const randomName = () => "tr_" + randomUUIDv7("hex").replaceAll("-", "");

function suite(dialect: Dialect, url: () => string) {
  const connect = (transform: unknown, options: object = {}) =>
    new SQL(url(), { max: 1, transform, ...options } as never);
  const isMySQL = dialect === "mysql" || dialect === "mariadb";
  const quote = isMySQL ? "`" : '"';
  const closedCode = `ERR_${isMySQL ? "MYSQL" : dialect.toUpperCase()}_CONNECTION_CLOSED`;

  async function people(sql: SQL) {
    const name = randomName();
    await sql.unsafe(`create temporary table ${name} (user_id int, first_name varchar(20))`);
    await sql.unsafe(`insert into ${name} values (1, 'a'), (2, 'b')`);
    return name;
  }
  const camelPeople = [
    { userId: 1, firstName: "a" },
    { userId: 2, firstName: "b" },
  ];

  describe("from the database", () => {
    test("every way to run a query renames the columns; values() has none", async () => {
      await using sql = connect(SQL.camel);
      const name = await people(sql);
      const text = `select user_id, first_name from ${name} order by user_id`;
      const placeholder = dialect === "postgres" ? "$1" : "?";
      const filtered = `select user_id, first_name from ${name} where user_id > ${placeholder} order by user_id`;

      expect({
        tagged: [...(await sql`select user_id, first_name from ${sql.unsafe(name)} order by user_id`)],
        again: [...(await sql`select user_id, first_name from ${sql.unsafe(name)} order by user_id`)],
        parameter: [...(await sql`select user_id, first_name from ${sql.unsafe(name)} where user_id > ${0} order by user_id`)], // prettier-ignore
        simple: [...(await sql`select user_id, first_name from ${sql.unsafe(name)} order by user_id`.simple())],
        unsafe: [...(await sql.unsafe(text))],
        unsafeWithValues: [...(await sql.unsafe(filtered, [0]))],
        begin: [...(await sql.begin(tx => tx.unsafe(text)))],
        values: [...(await sql.unsafe(text).values())],
      }).toEqual({
        tagged: camelPeople,
        again: camelPeople,
        parameter: camelPeople,
        simple: camelPeople,
        unsafe: camelPeople,
        unsafeWithValues: camelPeople,
        begin: camelPeople,
        values: [
          [1, "a"],
          [2, "b"],
        ],
      });
    });

    test.skipIf(dialect === "sqlite")(
      "on a reserved connection, and on each result of several statements",
      async () => {
        await using sql = connect(SQL.pascal);
        const name = await people(sql);
        using reserved = await sql.reserve();
        expect(await reserved.unsafe(`select user_id from ${name} where user_id = 1`)).toEqual([{ UserId: 1 }]);
        const results = await reserved.unsafe(`select 1 as first_one; select 2 as second_one, 3 as third_one`);
        expect(results.map((rows: any) => [...rows])).toEqual([[{ FirstOne: 1 }], [{ SecondOne: 2, ThirdOne: 3 }]]);
      },
    );

    test.skipIf(dialect !== "postgres")("prepare: false", async () => {
      await using sql = connect(SQL.camel, { prepare: false });
      const name = await people(sql);
      for (let i = 0; i < 2; i++) {
        expect(await sql`select user_id, first_name from ${sql.unsafe(name)} where user_id > ${0} order by 1`).toEqual(
          camelPeople,
        );
      }
    });

    test("a function alone, and a function as `column`, rename only what comes out", async () => {
      for (const transform of [SQL.toCamel, { column: SQL.toCamel }, { column: { from: SQL.toCamel } }]) {
        await using sql = connect(transform);
        const name = await people(sql);
        expect(await sql`select ${sql("user_id")} from ${sql(name)} where ${sql("first_name")} = ${"a"}`).toEqual([
          { userId: 1 },
        ]);
      }
    });

    test("is called once for a column of a result shape, not once for a row", async () => {
      const calls: string[] = [];
      await using sql = connect({ column: (name: string) => (calls.push(name), name.toUpperCase()) });
      const name = randomName();
      await sql.unsafe(`create temporary table ${name} (a int, b int)`);
      await sql`insert into ${sql(name)} ${sql(Array.from({ length: 100 }, (_, i) => ({ a: i, b: -i })))}`;
      expect(calls).toEqual([]);

      for (let i = 0; i < 3; i++) {
        const rows = await sql`select a, b from ${sql(name)} where a >= ${0} order by a`;
        expect(rows.length).toBe(100);
        expect(rows[99]).toEqual({ A: 99, B: -99 });
      }
      // The SQLite adapter compiles the statement for each query. The servers keep it.
      expect(calls).toEqual(dialect === "sqlite" ? ["a", "b", "a", "b", "a", "b"] : ["a", "b"]);

      calls.length = 0;
      await sql`select a from ${sql(name)} where a = 1`.values();
      await sql`select a from ${sql(name)} where a < 0`;
      // nothing has a name in values(); a result without rows may or may not need its shape
      expect(calls.length).toBeLessThanOrEqual(2);
    });

    test("two columns with one name after the transform: the last one wins, as without a transform", async () => {
      await using sql = connect(SQL.camel);
      const rows = await sql.unsafe(`select 1 as user_id, 2 as ${quote}userId${quote}, 3 as other`);
      expect(rows).toEqual([{ userId: 2, other: 3 }]);
      expect(Object.keys(rows[0])).toEqual(["userId", "other"]);
    });

    test("a name that becomes an index", async () => {
      await using sql = connect({ column: (name: string) => (name === "one" ? "1" : name === "zero" ? "0" : name) });
      const rows = await sql.unsafe(`select 5 as b, 6 as one, 7 as zero`);
      expect(rows).toEqual([{ 0: 7, 1: 6, b: 5 }]);
      expect(Object.keys(rows[0])).toEqual(["0", "1", "b"]);
    });

    test("more columns than a row shape caches", async () => {
      await using sql = connect(SQL.camel);
      const count = 70;
      const text = "select " + Array.from({ length: count }, (_, i) => `${i} as col_x${i}`).join(", ");
      const row = Object.fromEntries(Array.from({ length: count }, (_, i) => [`colX${i}`, i]));
      expect(await sql.unsafe(text)).toEqual([row]);
      expect(await sql`${sql.unsafe(text)} where 1 = ${1}`).toEqual([row]);
    });

    test("names that are not ASCII", async () => {
      await using sql = connect(SQL.camel);
      const q = (name: string) => quote + name + quote;
      expect(await sql.unsafe(`select 1 as ${q("créée_à")}, 2 as ${q("名_x")}, 3 as ${q("x_ß")}`)).toEqual([
        { "crééeÀ": 1, "名X": 2, xSS: 3 },
      ]);
    });

    test("what it returns is converted to a string", async () => {
      await using sql = connect({
        column: (name: string) => (name === "a" ? { toString: () => "fromObject" } : name === "b" ? 7 : undefined),
      });
      expect(await sql.unsafe(`select 1 as a, 2 as b, 3 as c`)).toEqual([{ fromObject: 1, 7: 2, undefined: 3 }]);
    });

    test("what it throws rejects the query, and no half-renamed shape is kept", async () => {
      const thrown = new Error("from failed");
      let failing = true;
      await using sql = connect({
        column(name: string) {
          if (failing && name === "second_one") throw thrown;
          return SQL.toCamel(name);
        },
      });
      const query = () => sql`select 1 as first_one, 2 as second_one where 1 = ${1}`;
      expect(await query().catch(e => e)).toBe(thrown);
      expect(await query().catch(e => e)).toBe(thrown);
      expect(await sql.unsafe("select 1 as second_one").catch(e => e)).toBe(thrown);
      failing = false;
      expect(await query()).toEqual([{ firstOne: 1, secondOne: 2 }]);
      expect(await sql.unsafe("select 1 as second_one")).toEqual([{ secondOne: 1 }]);
    });

    test.skipIf(dialect === "sqlite")(
      "what it throws also rejects the queries that wait for the same statement, and only them",
      async () => {
        const thrown = new Error("from failed");
        const calls: string[] = [];
        await using sql = connect({
          column(name: string) {
            calls.push(name);
            if (name === "second_one") throw thrown;
            return SQL.toCamel(name);
          },
        });
        const query = () => sql`select 1 as first_one, 2 as second_one, 3 as third_one where 1 = ${1}`;
        const outcomes = await Promise.allSettled([query(), query(), query(), sql`select 5 as other_one`]);
        expect(outcomes.map(outcome => (outcome.status === "rejected" ? outcome.reason : [...outcome.value]))).toEqual([
          thrown,
          thrown,
          thrown,
          [{ otherOne: 5 }],
        ]);
        // PostgreSQL describes a statement once, and the three share it. MySQL describes each execution.
        expect(calls).toEqual(
          dialect === "postgres"
            ? ["first_one", "second_one", "other_one"]
            : ["first_one", "second_one", "second_one", "second_one", "other_one"],
        );
        if (dialect === "postgres") {
          // the server does not keep the statement either
          expect(await sql.unsafe("select statement from pg_prepared_statements").values()).toEqual([
            ["select 5 as other_one"],
          ]);
        }
      },
    );

    test.skipIf(dialect === "sqlite")("what it throws at a later result of several statements", async () => {
      const thrown = new Error("from failed");
      const calls: string[] = [];
      await using sql = connect({
        column(name: string) {
          calls.push(name);
          if (name === "second_one") throw thrown;
          return SQL.toCamel(name);
        },
      });
      const text = "select 1 as first_one; select 2 as second_one; select 3 as third_one";
      expect(await sql.unsafe(text).catch(e => e)).toBe(thrown);
      // the rest of the answer is read and dropped
      expect(calls).toEqual(["first_one", "second_one"]);
      expect(await sql.unsafe("select 4 as fourth_one")).toEqual([{ fourthOne: 4 }]);
    });

    test("it may start a query on the same client", async () => {
      let nested: Promise<unknown> | undefined;
      await using sql = connect({
        column(name: string) {
          nested ??= sql.unsafe("select 2 as nested_one").then(
            rows => [...rows],
            error => error.message,
          );
          return SQL.toCamel(name);
        },
      });
      expect(await sql`select 1 as outer_one where 1 = ${1}`).toEqual([{ outerOne: 1 }]);
      expect(await nested).toEqual(
        // SQLite is inside the outer statement at that moment
        dialect === "sqlite" ? "This database connection is busy executing a query" : [{ nestedOne: 2 }],
      );
      expect(await sql`select 3 as later_one`).toEqual([{ laterOne: 3 }]);
    });

    test("it may close the client", async () => {
      let closing: Promise<void> | undefined;
      const sql = connect({
        column(name: string) {
          closing ??= sql.close({ timeout: 0 });
          return SQL.toCamel(name);
        },
      });
      const outcome = await sql`select 1 as outer_one where 1 = ${1}`.then(
        rows => [...rows],
        error => error.code,
      );
      // SQLite has the rows by the time it can close. A server's answer is dropped with the connection.
      expect(outcome).toEqual(dialect === "sqlite" ? [{ outerOne: 1 }] : closedCode);
      await closing;
      expect(await sql`select 1`.catch(e => e.code)).toBe(closedCode);
    });
  });

  describe("to the database", () => {
    test("the keys of a helper, the columns of a helper and sql(name)", async () => {
      await using sql = connect(SQL.camel);
      const table = sql(await people(sql));

      await sql`insert into ${table} ${sql({ userId: 3, firstName: "c" })}`;
      await sql`insert into ${table} ${sql([{ userId: 4, firstName: "d", ignored: 1 }], "userId", "firstName")}`;
      await sql`update ${table} set ${sql({ firstName: "z" })} where ${sql("userId")} = ${1}`;
      // values(): what comes out has no names, so this is `to` alone
      const rows = await sql`select ${sql("userId")}, ${sql("firstName")} from ${table}
          where ${sql("userId")} in ${sql([{ userId: 1 }, { userId: 3 }, { userId: 4 }], "userId")}
          order by ${sql("userId")}`.values();
      expect([...rows]).toEqual([
        [1, "z"],
        [3, "c"],
        [4, "d"],
      ]);
    });

    test("the whole name is given to the function, the dots are split afterwards", async () => {
      const seen: string[] = [];
      await using sql = connect({ column: { to: (name: string) => (seen.push(name), SQL.fromCamel(name)) } });
      const name = await people(sql);
      expect(
        await sql`select ${sql("myPeople.userId")} from ${sql.unsafe(name)} as my_people where user_id = 1`,
      ).toEqual([{ user_id: 1 }]);
      expect(seen).toEqual(["myPeople.userId"]);
    });

    test("a function alone renames only what goes in", async () => {
      await using sql = connect(SQL.fromPascal);
      const table = sql.unsafe(await people(sql));
      expect(await sql`select ${sql("UserId")} from ${table} where ${sql("FirstName")} = ${"b"}`).toEqual([
        { user_id: 2 },
      ]);
    });

    test("what it returns is quoted like any name", async () => {
      await using sql = connect({ column: { to: () => `a${quote} from nowhere -- ` } });
      const outcome = await sql`select ${sql("x")} as x`.catch(e => e.message);
      const name = `a${quote} from nowhere -- `;
      expect(outcome).toEqual(
        {
          sqlite: [{ x: name }],
          postgres: `column "${name}" does not exist`,
          mysql: `Unknown column '${name}' in 'field list'`,
          mariadb: `Unknown column '${name}' in 'SELECT'`,
        }[dialect],
      );
      await using nul = connect({ column: { to: () => "a\0b" } });
      expect(await nul`select ${nul("x")}`.catch(e => e.code)).toBe("ERR_INVALID_ARG_VALUE");
    });

    test("what it throws rejects the query before anything is sent", async () => {
      const thrown = new Error("to failed");
      await using sql = connect({
        column: {
          to() {
            throw thrown;
          },
        },
      });
      expect(await sql`select ${sql("x")}`.catch(e => e)).toBe(thrown);
      expect(await sql`insert into t ${sql({ x: 1 })}`.catch(e => e)).toBe(thrown);
      expect(await sql`select 1 as x`).toEqual([{ x: 1 }]);
    });

    test("a key that is a number arrives as a string", async () => {
      const seen: unknown[] = [];
      await using sql = connect({ column: { to: (name: string) => (seen.push(name), "first_name") } });
      const table = sql.unsafe(await people(sql));
      await sql`update ${table} set ${sql({ 7: "seven" }, 7)} where user_id = 1`;
      expect(seen).toEqual(["7"]);
      expect(await sql`select first_name from ${table} where user_id = 1`).toEqual([{ first_name: "seven" }]);
    });

    test("it may start a query or close the client: no connection has the statement yet", async () => {
      let nested: Promise<unknown> | undefined;
      await using sql = connect({
        column: {
          to(name: string) {
            nested ??= sql`select 2 as n`.then(rows => [...rows]);
            return name;
          },
        },
      });
      expect(await sql`select 1 as ${sql("x")}`).toEqual([{ x: 1 }]);
      expect(await nested).toEqual([{ n: 2 }]);

      let closing: Promise<void> | undefined;
      const closed = connect({
        column: {
          to(name: string) {
            closing ??= closed.close({ timeout: 0 });
            return name;
          },
        },
      });
      expect(await closed`select 1 as ${closed("x")}`.catch(e => e.code)).toBe(closedCode);
      await closing;
    });

    test("an identifier is renamed by the client that runs the query", async () => {
      await using sql = connect(SQL.fromCamel);
      await using plain = connect(undefined);
      const name = await people(sql);
      expect(await sql`select ${plain("userId")} from ${plain(name)} where ${plain("userId")} = 1`).toEqual([
        { user_id: 1 },
      ]);
    });
  });

  describe("undefined", () => {
    test("is NULL unless the option says otherwise", async () => {
      for (const [transform, sent] of [
        [undefined, null],
        [{}, null],
        [{ undefined: null }, null],
        [{ undefined: undefined }, null],
        [{ undefined: 7 }, 7],
        [{ ...SQL.camel, undefined: 0 }, 0],
      ] as const) {
        await using sql = connect(transform);
        const name = randomName();
        await sql.unsafe(`create temporary table ${name} (id int, n int)`);
        await sql`insert into ${sql(name)} (id, n) values (${1}, ${undefined})`;
        await sql`insert into ${sql(name)} ${sql([
          { id: 2, n: undefined },
          { id: 3, n: 5 },
        ])}`;
        expect([...(await sql`select n from ${sql(name)} order by id`.values())]).toEqual([[sent], [sent], [5]]);
      }
    });

    // postgres.js 3.4.9 stores the same with the option. Without it, it throws UNDEFINED_VALUE.
    test("a helper leaves out a column that is only undefined, unless the option says what undefined is", async () => {
      for (const [transform, stored] of [
        [undefined, { inserted: 5, updated: 1 }],
        [{ undefined: undefined }, { inserted: 5, updated: 1 }],
        [{ undefined: null }, { inserted: null, updated: null }],
        [{ undefined: 7 }, { inserted: 7, updated: 7 }],
      ] as const) {
        await using sql = connect(transform);
        const table = sql(randomName());
        await sql`create temporary table ${table} (id int, n int default 5)`;

        await sql`insert into ${table} ${sql({ id: 1, n: undefined })}`;
        const [[inserted]] = await sql`select n from ${table}`.values();
        await sql`update ${table} set n = 1`;
        await sql`update ${table} set ${sql({ id: 2, n: undefined })}`;
        const [[updated]] = await sql`select n from ${table} where id = 2`.values();
        expect({ inserted, updated }).toEqual(stored);

        // null is a value with and without the option
        await sql`update ${table} set ${sql({ id: null, n: 3 })}`;
        expect([...(await sql`select id, n from ${table}`.values())]).toEqual([[null, 3]]);
      }
    });
  });
}

describe.concurrent("sqlite", () => {
  suite("sqlite", () => "sqlite://:memory:");

  // bun:sqlite closes nothing while a statement is on a row, and that is when `from` runs.
  test.each([
    ["a read", "select 1 as a", [{ a: 1 }]],
    ["a write that returns rows", "insert into t values (2) returning a", [{ a: 2 }]],
    ["a `from` that throws", "select 1 as boom", "from failed"],
  ])("a close() that `from` makes has let go of the file when it resolves: %s", async (_, text, outcome) => {
    using dir = tempDir("sql-transform-close", {});
    const filename = join(String(dir), "exclusive.db");
    let closing: Promise<void> | undefined;
    const sql = new SQL({
      adapter: "sqlite",
      filename,
      transform: {
        column(name: string) {
          closing ??= sql.close();
          if (name === "boom") throw new Error("from failed");
          return name;
        },
      },
    } as never);
    // From its first write on, nobody else can read the file. values() has no names, so `from` does not run yet.
    await sql`pragma locking_mode = exclusive`.values();
    await sql`create table t (a)`;

    const settled = await sql.unsafe(text).then(
      rows => [...rows],
      error => error.message,
    );
    expect(settled).toEqual(outcome);
    await closing;
    using other = new Database(filename);
    expect(other.query("select name from sqlite_master").all()).toEqual([{ name: "t" }]);
  });
});

for (const [dialect, image, url] of [
  ["postgres", "postgres_plain", "postgres://bun_sql_test@"],
  ["mysql", "mysql_plain", "mysql://root@"],
  ["mariadb", "mariadb_plain", "mysql://root@"],
] as const) {
  describeWithContainer(dialect, { image, concurrent: true }, container => {
    beforeAll(() => container.ready);
    suite(dialect, () => `${url}${container.host}:${container.port}/bun_sql_test`);
  });
}
