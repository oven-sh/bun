// Binding a JS value to a parameter whose type the server reports. Bun declares
// no type for an object, array, Date or function, so the server infers one from
// the context (a column, a cast, a comparison, a bare `where $1`). Bun then
// encoded the value for that type with a JS coercion: ToBoolean for `boolean`
// (`[]` and `{ enabled: false }` were sent as `true`), ToInt32 for `int4` (0),
// ToNumber for `float8` (NaN, which sorts above every number), and 2000-01-01
// or 1970-01-01 for `timestamptz`. The query succeeded:
// `delete from t where ${[a, b]}` and `where id not in (${[1, 2]})` removed
// every row.
//
// A binary encoder now runs only for the JS class it represents exactly. A
// boolean parameter rejects any other value with ERR_INVALID_ARG_TYPE (as a
// bytea parameter does). For the other types the value goes as text, and the
// server parses or rejects it.
import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer("postgres", { image: "postgres_plain", concurrent: true }, container => {
  const connect = () =>
    new SQL({
      url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
    });

  const rejected: [string, unknown, string][] = [
    ["{ enabled: false }", { enabled: false }, "an instance of Object"],
    ["[]", [], "an instance of Array"],
    ["[1, 2]", [1, 2], "an instance of Array"],
    ["[true]", [true], "an instance of Array"],
    ["Invalid Date", new Date(NaN), "an instance of Date"],
    ["Date", new Date(0), "an instance of Date"],
    [
      "function",
      function enabled() {
        return false;
      },
      "function enabled",
    ],
    ["Int32Array", new Int32Array([1]), "an instance of Int32Array"],
  ];
  if (typeof Temporal !== "undefined") {
    rejected.push(["Temporal.PlainDate", Temporal.PlainDate.from("2024-05-06"), "an instance of PlainDate"]);
  }

  test.each(rejected)("%s bound to a boolean column rejects instead of storing true", async (_, value, received) => {
    await container.ready;
    await using sql = connect();
    await sql`create temp table bool_bind (id int, b bool)`;
    // Twice: the first run prepares the statement and binds from the request
    // queue, the second binds the cached statement directly at query time.
    for (let i = 0; i < 2; i++) {
      const err: any = await sql`insert into bool_bind (id, b) values (${1}, ${value}) returning b`.then(
        rows => rows,
        e => e,
      );
      expect(err).toBeInstanceOf(TypeError);
      expect(err.code).toBe("ERR_INVALID_ARG_TYPE");
      expect(err.message).toBe(
        `Query parameter $2 of type boolean must be a boolean or a string. Received ${received}`,
      );
    }
    // The temp table only exists on the original session, so this also fails
    // if the rejection cost the connection.
    expect(await sql`select count(*)::int as n from bool_bind`).toEqual([{ n: 0 }]);
  });

  test("an array or an object as a WHERE condition rejects and removes no row", async () => {
    await container.ready;
    await using sql = connect();
    await sql`create temp table bool_where (id int primary key)`;
    await sql`insert into bool_where values (1), (2), (3)`;
    const conditions: unknown[] = [[sql`id = 1`, sql`id = 2`], [sql`id = 1`], [], [1, 2], [true], [false], { id: 1 }];
    const outcomes: string[] = [];
    for (const condition of conditions) {
      outcomes.push(
        await sql`delete from bool_where where ${condition}`.then(
          result => `deleted ${result.count}`,
          e => e.code,
        ),
      );
    }
    expect(outcomes).toEqual(conditions.map(() => "ERR_INVALID_ARG_TYPE"));
    expect(await sql`select id from bool_where order by id`).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);

    // A boolean and a fragment in that place still do what they say.
    expect((await sql`delete from bool_where where ${false}`).count).toBe(0);
    expect((await sql`delete from bool_where where ${sql`id = 1`}`).count).toBe(1);
    expect((await sql`delete from bool_where where ${true}`).count).toBe(2);
  });

  test("a cast and a comparison type the parameter as boolean too", async () => {
    await container.ready;
    await using sql = connect();
    const message = (query: PromiseLike<unknown>) =>
      query.then(
        () => "resolved",
        e => e.message,
      );
    expect(await message(sql`select ${{ a: 1 }}::bool as v`)).toBe(
      "Query parameter $1 of type boolean must be a boolean or a string. Received an instance of Object",
    );
    expect(await message(sql`select 1 as v where true = ${[]}`)).toBe(
      "Query parameter $1 of type boolean must be a boolean or a string. Received an instance of Array",
    );
  });

  test("booleans, null and strings bound to a boolean column still work", async () => {
    await container.ready;
    await using sql = connect();
    await sql`create temp table bool_bind (id int, b bool)`;
    const values = [true, false, null, undefined, "t", "f", "true", "false", "yes", "off", "1", "0"];
    for (const [id, b] of values.entries()) {
      await sql`insert into bool_bind (id, b) values (${id}, ${b})`;
    }
    expect(await sql`select id, b from bool_bind order by id`).toEqual([
      { id: 0, b: true },
      { id: 1, b: false },
      { id: 2, b: null },
      { id: 3, b: null },
      { id: 4, b: true },
      { id: 5, b: false },
      { id: 6, b: true },
      { id: 7, b: false },
      { id: 8, b: true },
      { id: 9, b: false },
      { id: 10, b: true },
      { id: 11, b: false },
    ]);
    // A string the server cannot parse as a boolean is still a server error,
    // and the connection stays usable after it.
    const err = await sql`insert into bool_bind (id, b) values (99, ${"garbage"})`.catch(e => e);
    expect([err?.code, err?.errno]).toEqual(["ERR_POSTGRES_SERVER_ERROR", "22P02"]);
    expect(await sql`select id from bool_bind where b = ${true} order by id`).toEqual([
      { id: 0 },
      { id: 4 },
      { id: 6 },
      { id: 8 },
      { id: 10 },
    ]);
    expect(await sql`select ${false}::bool as v, ${true}::bool as w`).toEqual([{ v: false, w: true }]);
  });

  test("queries pipelined behind a rejected boolean parameter still run", async () => {
    await container.ready;
    await using sql = connect();
    await sql`create temp table flags (id serial primary key, b bool)`;
    const results = await Promise.all([
      sql`insert into flags (b) values (${[]})`.then(
        () => "stored",
        e => e.code,
      ),
      sql`insert into flags (b) values (${false}) returning b`.then(
        rows => rows[0].b,
        e => e.code,
      ),
      sql`select 2 as v`.then(
        rows => rows[0].v,
        e => e.code,
      ),
    ]);
    expect(results).toEqual(["ERR_INVALID_ARG_TYPE", false, 2]);
    expect(await sql`select b from flags order by id`).toEqual([{ b: false }]);
  });

  test("a rejected boolean parameter inside a transaction does not abort it", async () => {
    await container.ready;
    await using sql = connect();
    await sql`create temp table flags (id serial primary key, b bool)`;
    const rejection = await sql.begin(async tx => {
      await tx`insert into flags (b) values (${true})`;
      const code = await tx`insert into flags (b) values (${[]})`.then(
        () => "stored",
        e => e.code,
      );
      await tx`insert into flags (b) values (${false})`;
      return code;
    });
    expect(rejection).toBe("ERR_INVALID_ARG_TYPE");
    expect(await sql`select b from flags order by id`).toEqual([{ b: true }, { b: false }]);
  });

  const containers: [string, unknown][] = [
    ["{}", {}],
    ["[]", []],
    ["[1, 2]", [1, 2]],
    ["a function", function limit() {}],
  ];
  // [the type the server infers, what its input function answers, the values]
  const refusedByServer: [string, string, [string, unknown][]][] = [
    ["int4", "22P02", containers],
    ["float8", "22P02", containers],
    ["timestamptz", "22007", [...containers.slice(0, 2), ["Invalid Date", new Date(NaN)]]],
  ];

  test.each(refusedByServer)(
    "a value of another class bound to %s goes as text and the server answers %s",
    async (type, sqlstate, values) => {
      await container.ready;
      await using sql = connect();
      const outcomes: Record<string, string[]> = {};
      for (const [n, [label, value]] of values.entries()) {
        outcomes[label] = [];
        // Twice, as above. The comment gives every value a statement of its own.
        for (let i = 0; i < 2; i++) {
          outcomes[label].push(
            await sql.unsafe(`select $1::${type} as v /* ${n} */`, [value]).then(
              rows => `resolved ${JSON.stringify(rows[0].v)}`,
              e => `${e.code} ${e.errno}`,
            ),
          );
        }
      }
      expect(outcomes).toEqual(
        Object.fromEntries(values.map(([label]) => [label, Array(2).fill(`ERR_POSTGRES_SERVER_ERROR ${sqlstate}`)])),
      );
    },
  );

  test("a container used as one value in a WHERE clause removes no row", async () => {
    await container.ready;
    await using sql = connect();
    await sql`create temp table param_class (id int primary key, score float8, at timestamptz)`;
    await sql`insert into param_class select n, n * 1.5, now() from generate_series(1, 5) n`;
    const statements = [
      () => sql`delete from param_class where id not in (${[1, 2]})`,
      () => sql`delete from param_class where id > ${[]}`,
      () => sql`delete from param_class where score <> ${{}}`,
      () => sql`delete from param_class where score < ${{ max: 10 }}`,
      () => sql`delete from param_class where at >= ${{}}`,
      () => sql`delete from param_class where at >= ${new Date(NaN)}`,
    ];
    const outcomes: string[] = [];
    for (const run of statements) {
      outcomes.push(
        await run().then(
          result => `deleted ${result.count}`,
          e => e.errno,
        ),
      );
    }
    expect(outcomes).toEqual(["22P02", "22P02", "22P02", "22P02", "22007", "22007"]);
    expect(await sql`select count(*)::int as n from param_class`).toEqual([{ n: 5 }]);
  });

  test("an object with its own toString() binds as that text", async () => {
    await container.ready;
    await using sql = connect();
    const text = (value: string) => ({ toString: () => value });
    for (let i = 0; i < 2; i++) {
      const rows =
        await sql`select ${text("12.50")}::numeric as n, ${text("7")}::int4 as i, ${text("2024-05-06T07:08:09Z")}::timestamptz as at`;
      expect(rows).toEqual([{ n: "12.50", i: 7, at: new Date("2024-05-06T07:08:09Z") }]);
    }
  });
});
