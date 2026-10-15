// What a JS value becomes in a column of each type, against a real server.
// The bytes on the wire are pinned in postgres-bind-wire.test.ts.
import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { describeWithContainer } from "harness";

const columns = {
  text: "text",
  int4: "int4",
  int8: "int8",
  float4: "float4",
  float8: "float8",
  numeric: "numeric",
  bool: "bool",
  date: "date",
  time: "time",
  timetz: "timetz",
  timestamp: "timestamp",
  timestamptz: "timestamptz",
  json: "json",
  jsonb: "jsonb",
  bytea: "bytea",
  int4_array: "int4[]",
  float4_array: "float4[]",
  text_array: "text[]",
  jsonb_array: "jsonb[]",
  mood: "pg_temp.mood",
  mood_array: "pg_temp.mood[]",
};
const everyColumn = Object.keys(columns).join(" ");
const iso = "2024-01-02T03:04:05.678Z";
const textBytes = (text: string) => "\\x" + Buffer.from(text).toString("hex");

// `column::text` after the insert, or an error -> the columns where that happens.
// A column that is not named refuses the value.
type Cells = Record<string, string>;
// The last element is what differs with `prepare: false`: Bind is written before the server has described the
// statement, unless the text of a value depends on the type (an array, a TypedArray of numbers, an own toString).
const matrix: [label: string, value: () => unknown, cells: Cells, unprepared?: Cells][] = [
  ['"1"', () => "1", { 1: "text int4 int8 float4 float8 numeric json jsonb", true: "bool", [textBytes("1")]: "bytea" }],
  ["'{\"a\":1}'", () => '{"a":1}', { '{"a":1}': "text json", '{"a": 1}': "jsonb", [textBytes('{"a":1}')]: "bytea" }],
  [
    "an ISO string",
    () => iso,
    {
      [iso]: "text",
      "2024-01-02": "date",
      "2024-01-02 03:04:05.678": "timestamp",
      "2024-01-02 03:04:05.678+00": "timestamptz",
      [textBytes(iso)]: "bytea",
    },
  ],
  [
    '"{1,2}"',
    () => "{1,2}",
    { "{1,2}": "text int4_array float4_array text_array jsonb_array", [textBytes("{1,2}")]: "bytea" },
  ],
  ['"a"', () => "a", { a: "text mood", [textBytes("a")]: "bytea" }],
  [
    'new String("1")',
    () => new String("1"),
    { 1: "text int4 int8 float4 float8 numeric json jsonb", true: "bool", [textBytes("1")]: "bytea" },
  ],
  ["1", () => 1, { 1: "text int4 int8 float4 float8 numeric" }],
  ["1.5", () => 1.5, { "1.5": "text float4 float8 numeric", 2: "int4 int8" }],
  ["2 ** 31", () => 2 ** 31, { 2147483648: "text int8 float8 numeric", "2.1474836e+09": "float4" }],
  [
    "2 ** 52",
    () => 2 ** 52,
    { "4503599627370496": "text int8 numeric", "4.5035996e+15": "float4", "4.503599627370496e+15": "float8" },
  ],
  [
    "Number.MAX_SAFE_INTEGER",
    () => Number.MAX_SAFE_INTEGER,
    { "9007199254740991": "text int8 numeric", "9.007199e+15": "float4", "9.007199254740991e+15": "float8" },
  ],
  [
    "2 ** 53",
    () => 2 ** 53,
    {
      "9.007199254740992e+15": "text float8",
      "9007199254740992": "int8",
      "9.007199e+15": "float4",
      "9007199254740990": "numeric",
    },
  ],
  ["-0", () => -0, { "-0": "text float4 float8", 0: "int4 int8 numeric" }],
  ["NaN", () => NaN, { NaN: "text float4 float8 numeric" }],
  [
    "Infinity",
    () => Infinity,
    { Infinity: "text float4 float8 numeric", infinity: "date timestamp timestamptz", ERR_INVALID_ARG_TYPE: "bytea" },
    { [textBytes("Infinity")]: "bytea" },
  ],
  [
    "-Infinity",
    () => -Infinity,
    {
      "-Infinity": "text float4 float8 numeric",
      "-infinity": "date timestamp timestamptz",
      ERR_INVALID_ARG_TYPE: "bytea",
    },
    { [textBytes("-Infinity")]: "bytea" },
  ],
  ["1n", () => 1n, { 1: "text int4 int8 float4 float8 numeric" }],
  [
    "2n ** 63n",
    () => 2n ** 63n,
    { "9223372036854775808": "text numeric", "9.223372e+18": "float4", "9.223372036854776e+18": "float8" },
  ],
  ["true", () => true, { true: "text bool" }],
  [
    "a Date",
    () => new Date(iso),
    {
      [iso]: "text",
      "2024-01-02": "date",
      "03:04:05.678": "time",
      "03:04:05.678+00": "timetz",
      "2024-01-02 03:04:05.678": "timestamp",
      "2024-01-02 03:04:05.678+00": "timestamptz",
      '"2024-01-02T03:04:05.678Z"': "json jsonb",
      ERR_INVALID_ARG_TYPE: "bytea",
    },
    { rejected: "time timetz json jsonb", [textBytes(iso)]: "bytea" },
  ],
  [
    "an Invalid Date",
    () => new Date(NaN),
    { "Invalid Date": "text", ERR_INVALID_ARG_TYPE: "bytea" },
    { [textBytes("Invalid Date")]: "bytea" },
  ],
  ["a Buffer", () => Buffer.from("hi"), { "\\x6869": "text bytea" }],
  ["an ArrayBuffer", () => new Uint8Array([1, 2]).buffer, { "\\x0102": "text bytea" }],
  ["a DataView", () => new DataView(new Uint8Array([1, 2]).buffer), { "\\x0102": "text bytea" }],
  [
    "Int32Array [1, 2]",
    () => new Int32Array([1, 2]),
    {
      '{"1","2"}': "text",
      '{"0":1,"1":2}': "json",
      '{"0": 1, "1": 2}': "jsonb",
      "\\x0100000002000000": "bytea",
      "{1,2}": "int4_array float4_array text_array jsonb_array",
    },
  ],
  [
    "Float32Array [1.5]",
    () => new Float32Array([1.5]),
    {
      '{"1.5"}': "text",
      '{"0":1.5}': "json",
      '{"0": 1.5}': "jsonb",
      "\\x0000c03f": "bytea",
      "{1.5}": "float4_array text_array jsonb_array",
    },
  ],
  [
    "[]",
    () => [],
    {
      "{}": "text int4_array float4_array text_array jsonb_array mood_array",
      "[]": "json jsonb",
      ERR_INVALID_ARG_TYPE: "bytea",
    },
  ],
  [
    "[1, 2]",
    () => [1, 2],
    {
      '{"1","2"}': "text",
      "[1,2]": "json",
      "[1, 2]": "jsonb",
      ERR_INVALID_ARG_TYPE: "bytea",
      "{1,2}": "int4_array float4_array text_array jsonb_array",
    },
  ],
  [
    '["a", "b"]',
    () => ["a", "b"],
    {
      '{"a","b"}': "text",
      '["a","b"]': "json",
      '["a", "b"]': "jsonb",
      ERR_INVALID_ARG_TYPE: "bytea",
      "{a,b}": "text_array mood_array",
      '{"\\"a\\"","\\"b\\""}': "jsonb_array",
    },
  ],
  [
    "[true]",
    () => [true],
    { '{"true"}': "text", "[true]": "json jsonb", ERR_INVALID_ARG_TYPE: "bytea", "{true}": "text_array jsonb_array" },
  ],
  [
    "[1, null]",
    () => [1, null],
    {
      '{"1",NULL}': "text",
      "[1,null]": "json",
      "[1, null]": "jsonb",
      ERR_INVALID_ARG_TYPE: "bytea",
      "{1,NULL}": "int4_array float4_array text_array jsonb_array",
    },
  ],
  [
    "[[1, 2], [3, 4]]",
    () => [
      [1, 2],
      [3, 4],
    ],
    {
      '{{"1","2"},{"3","4"}}': "text",
      "[[1,2],[3,4]]": "json",
      "[[1, 2], [3, 4]]": "jsonb",
      ERR_INVALID_ARG_TYPE: "bytea",
      "{{1,2},{3,4}}": "int4_array float4_array text_array",
      '{"[1, 2]","[3, 4]"}': "jsonb_array",
    },
  ],
  [
    "{ a: 1 }",
    () => ({ a: 1 }),
    { '{"a":1}': "text json", '{"a": 1}': "jsonb", ERR_INVALID_ARG_TYPE: "bytea" },
    { [textBytes('{"a":1}')]: "bytea" },
  ],
  [
    "an object with toJSON",
    () => ({ toJSON: () => ({ b: 2 }) }),
    { '{"b":2}': "text json", '{"b": 2}': "jsonb", ERR_INVALID_ARG_TYPE: "bytea" },
    { [textBytes('{"b":2}')]: "bytea" },
  ],
  [
    "an object without a prototype",
    () => Object.assign(Object.create(null), { a: 1 }),
    { '{"a":1}': "text json", '{"a": 1}': "jsonb", ERR_INVALID_ARG_TYPE: "bytea" },
    { [textBytes('{"a":1}')]: "bytea" },
  ],
  [
    "an object with toString",
    () => ({ toString: () => "7" }),
    { 7: "text int4 int8 float4 float8 numeric", "{}": "json jsonb", ERR_INVALID_ARG_TYPE: "bytea" },
  ],
  [
    "a URL",
    () => new URL("http://a/b"),
    { "http://a/b": "text", '"http://a/b"': "json jsonb", ERR_INVALID_ARG_TYPE: "bytea" },
  ],
  ["null", () => null, { NULL: everyColumn }],
  ["undefined", () => undefined, { NULL: everyColumn }],
];

// What an input function (or, for a declared type, Parse) says to a value it does not take.
const refusals = new Set(["22P02", "22007", "22003", "42804"]);

function expand(cells: Cells, into: Record<string, string>) {
  for (const [outcome, names] of Object.entries(cells)) for (const name of names.split(" ")) into[name] = outcome;
  return into;
}

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  const url = () => `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;

  describe.each<[string, boolean]>([
    ["prepared", true],
    ["prepare: false", false],
  ])("%s", (_, prepare) => {
    let sql: SQL;
    beforeAll(async () => {
      await container.ready;
      sql = new SQL({ url: url(), max: 1, prepare });
      await sql.unsafe(`
        set time zone 'UTC';
        create type pg_temp.mood as enum ('a', 'b');
        create temp table bind (${Object.entries(columns)
          .map(([name, type]) => `${name} ${type}`)
          .join(", ")});
        create temp table three as select generate_series(1, 3) as id;
      `);
    });
    afterAll(() => sql.close());

    // The default keeps the function's length at 3: a fourth parameter would be `done` for a row of three.
    test.each(matrix)("%s", async (_, value, cells, unprepared = {}) => {
      const expected = expand(cells, Object.fromEntries(Object.keys(columns).map(name => [name, "rejected"])));
      if (!prepare) expand(unprepared, expected);

      const actual: Record<string, string> = {};
      for (const name of Object.keys(columns)) {
        actual[name] = await sql
          .unsafe(`insert into bind (${name}) values ($1) returning ${name}::text as stored`, [value()])
          .then(
            ([{ stored }]) => stored ?? "NULL",
            err => (refusals.has(err.errno) ? "rejected" : (err.errno ?? err.code ?? String(err))),
          );
      }
      expect(actual).toEqual(expected);
    });

    test.each<[unknown, string, string]>([
      [1, "integer", "1"],
      [-(2 ** 31), "integer", "-2147483648"],
      [2 ** 31, "bigint", "2147483648"],
      [2 ** 52, "bigint", "4503599627370496"],
      [Number.MIN_SAFE_INTEGER, "bigint", "-9007199254740991"],
      [2 ** 53, "double precision", "9.007199254740992e+15"],
      [1.5, "double precision", "1.5"],
      [-0, "double precision", "-0"],
      [2n ** 63n - 1n, "bigint", "9223372036854775807"],
      [-(2n ** 63n), "bigint", "-9223372036854775808"],
      [2n ** 63n, "numeric", "9223372036854775808"],
      [-(2n ** 63n) - 1n, "numeric", "-9223372036854775809"],
      [true, "boolean", "true"],
      [new Uint8Array([1]), "bytea", "\\x01"],
      [new DataView(new ArrayBuffer(1)), "bytea", "\\x00"],
    ])("%p is declared as %s", async (value, type, text) => {
      expect(await sql`select pg_typeof(${value})::text as type, ${value}::text as text`).toEqual([{ type, text }]);
    });

    // The server types `$1` as boolean. Only a boolean (or a string the server reads as one) may decide it.
    test.each<[string, unknown]>([
      ["[]", []],
      ["[true]", [true]],
      ["[1]", [1]],
      ["['t']", ["t"]],
      ["{ id: 1 }", { id: 1 }],
      ["a Date", new Date(0)],
      ["Int32Array [1]", new Int32Array([1])],
    ])("delete ... where ${%s} removes nothing", async (_, condition) => {
      const outcome = await sql`delete from three where ${condition}`.then(
        result => `removed ${result.count}`,
        err => err.errno,
      );
      expect({ outcome, left: await sql`select count(*)::int as n from three` }).toEqual({
        outcome: "22P02",
        left: [{ n: 3 }],
      });
    });

    test("what a query returns can be bound again", async () => {
      const [row] = await sql`
        select 'infinity'::timestamptz as tstz, '-infinity'::timestamp as ts, 'infinity'::date as date,
          'infinity'::float4 as float4, '{1,2}'::int4[] as ints, '{1.5,NULL}'::float4[] as floats`;
      expect(
        await sql`
          select ${row.tstz}::timestamptz::text as tstz, ${row.ts}::timestamp::text as ts, ${row.date}::date::text as date,
            ${row.float4}::float4::text as float4, ${row.ints}::int4[]::text as ints, ${row.floats}::float4[]::text as floats`,
      ).toEqual([
        {
          tstz: "infinity",
          ts: "-infinity",
          date: "infinity",
          float4: "Infinity",
          ints: "{1,2}",
          floats: "{1.5,NULL}",
        },
      ]);
    });

    test("sql.array() as a value of sql.unsafe()", async () => {
      expect(await sql.unsafe("select $1::int4[]::text as x", [sql.array([1, 2])])).toEqual([{ x: "{1,2}" }]);
    });

    test("a value that JSON.stringify refuses rejects its own query only", async () => {
      const refused = await sql`select ${{ a: 1n }}::text as x`.then(
        rows => rows,
        err => err,
      );
      expect(refused).toBeInstanceOf(TypeError);
      expect(await sql`select ${"next"}::text as x`).toEqual([{ x: "next" }]);
    });

    test("raw() returns the text format on every run", async () => {
      const run = async () => {
        const [row] = await sql`select ${1}::int4, ${true}::bool, ${1.5}::float8, ${Buffer.from("hi")}::bytea`.raw();
        return row.map((cell: Uint8Array) => Buffer.from(cell).toString());
      };
      expect([await run(), await run()]).toEqual([
        ["1", "t", "1.5", "\\x6869"],
        ["1", "t", "1.5", "\\x6869"],
      ]);
    });

    test.each<[string, (sql: SQL) => Promise<unknown>]>([
      ["sql.unsafe(text)", sql => sql.unsafe("select 1 as x\0")],
      ["sql.unsafe(text, [parameter])", sql => sql.unsafe("select $1::int as x\0", [1])],
      ["a tagged template", sql => sql`select ${1}::int as x\0`],
    ])("%s that ends in NUL is refused and the connection stays usable", async (_, statement) => {
      const session = async () => (await sql`select pg_backend_pid() as pid`)[0].pid;
      const before = await session();
      const errno = await statement(sql).then(
        () => "resolved",
        err => err.errno,
      );
      expect({ errno, sameSession: (await session()) === before }).toEqual({ errno: "08P01", sameSession: true });
    });
  });

  // PostgreSQL starts both timeouts when it sends ReadyForQuery and stops them at the next message of any kind.
  describe.concurrent("after a simple query the server still ends an idle session", () => {
    // Resolves once the server has ended the backend `pid`, or has left it in one state for
    // 2 seconds by its own clock. The limits below are 50 ms.
    async function sessionOutcome(watch: SQL, pid: number): Promise<string> {
      while (true) {
        // pg_sleep runs only while the backend is there. It paces the poll.
        const [session] = await watch`
          select state, clock_timestamp() - state_change > interval '2 seconds' as overdue, pg_sleep(0.01)
          from pg_stat_activity where pid = ${pid}`;
        if (!session) return "ended by the server";
        if (session.overdue) return session.state;
      }
    }

    // The server applies a limit from the ReadyForQuery of the statement that sets it.
    test.each<[string, (sql: SQL, idle: () => Promise<void>) => Promise<unknown>]>([
      [
        "idle_in_transaction_session_timeout",
        (sql, idle) => sql.begin(tx => tx.unsafe("set idle_in_transaction_session_timeout = 50").then(idle)),
      ],
      ["idle_session_timeout", (sql, idle) => sql.unsafe("set idle_session_timeout = 50").then(idle)],
    ])("%s", async (_, run) => {
      await container.ready;
      await using watch = new SQL({ url: url(), max: 1 });
      await using sql = new SQL({ url: url(), max: 1 });
      const [{ pid }] = await sql`select pg_backend_pid() as pid`;
      let session: Promise<string> | undefined;
      // begin() rejects as soon as its connection is gone.
      await run(sql, async () => void (await (session = sessionOutcome(watch, pid)))).catch(() => {});
      expect(await session).toBe("ended by the server");
    });
  });
});
