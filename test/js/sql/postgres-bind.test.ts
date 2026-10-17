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
const builtinArrays = "int4_array float4_array text_array jsonb_array";
const iso = "2024-01-02T03:04:05.678Z";
const textBytes = (text: string) => "\\x" + Buffer.from(text).toString("hex");

// `column::text` after the insert, or an error -> the columns where that happens.
// A column that is not named refuses the value.
type Cells = Record<string, string>;
// The last element is what differs with `prepare: false`: Bind is written before the server has described the
// statement, unless the text of a value depends on the type (an array, an Int32Array, an object that converts itself).
// A string is then sent as it is, also to json and jsonb.
const matrix: [label: string, value: () => unknown, cells: Cells, unprepared?: Cells][] = [
  [
    '"1"',
    () => "1",
    { 1: "text int4 int8 float4 float8 numeric", '"1"': "json jsonb", true: "bool", [textBytes("1")]: "bytea" },
    { 1: "json jsonb" },
  ],
  [
    "'{\"a\":1}'",
    () => '{"a":1}',
    { '{"a":1}': "text", '"{\\"a\\":1}"': "json jsonb", [textBytes('{"a":1}')]: "bytea" },
    { '{"a":1}': "json", '{"a": 1}': "jsonb" },
  ],
  [
    "an ISO string",
    () => iso,
    {
      [iso]: "text",
      "2024-01-02": "date",
      "2024-01-02 03:04:05.678": "timestamp",
      "2024-01-02 03:04:05.678+00": "timestamptz",
      [`"${iso}"`]: "json jsonb",
      [textBytes(iso)]: "bytea",
    },
    { rejected: "json jsonb" },
  ],
  [
    '"{1,2}"',
    () => "{1,2}",
    {
      "{1,2}": "text int4_array float4_array text_array jsonb_array",
      '"{1,2}"': "json jsonb",
      [textBytes("{1,2}")]: "bytea",
    },
    { rejected: "json jsonb" },
  ],
  ['"a"', () => "a", { a: "text mood", '"a"': "json jsonb", [textBytes("a")]: "bytea" }, { rejected: "json jsonb" }],
  [
    'new String("1")',
    () => new String("1"),
    { 1: "text int4 int8 float4 float8 numeric", '"1"': "json jsonb", true: "bool", [textBytes("1")]: "bytea" },
    { 1: "json jsonb" },
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
  ["Infinity", () => Infinity, { Infinity: "text float4 float8 numeric" }],
  ["-Infinity", () => -Infinity, { "-Infinity": "text float4 float8 numeric" }],
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
    { "Invalid Date": "text", null: "json jsonb", ERR_INVALID_ARG_TYPE: "bytea" },
    { rejected: "json jsonb", [textBytes("Invalid Date")]: "bytea" },
  ],
  ["a Buffer", () => Buffer.from("hi"), { "\\x6869": "text bytea" }],
  ["an ArrayBuffer", () => new Uint8Array([1, 2]).buffer, { "\\x0102": "text bytea" }],
  ["a DataView", () => new DataView(new Uint8Array([1, 2]).buffer), { "\\x0102": "text bytea" }],
  [
    "Int32Array [1, 2]",
    () => new Int32Array([1, 2]),
    {
      "1,2": "text",
      '{"0":1,"1":2}': "json",
      '{"0": 1, "1": 2}': "jsonb",
      "\\x0100000002000000": "bytea",
      "{1,2}": "int4_array float4_array text_array jsonb_array",
    },
  ],
  ["Float32Array [1.5]", () => new Float32Array([1.5]), { "\\x0000c03f": "text bytea" }],
  [
    "[]",
    () => [],
    {
      "": "text",
      "{}": "int4_array float4_array text_array jsonb_array",
      "[]": "json jsonb",
      ERR_INVALID_ARG_TYPE: "bytea",
    },
  ],
  [
    "[1]",
    () => [1],
    {
      1: "text int4 int8 float4 float8 numeric",
      true: "bool",
      "[1]": "json jsonb",
      ERR_INVALID_ARG_TYPE: "bytea",
      "{1}": "int4_array float4_array text_array jsonb_array",
    },
  ],
  [
    "[1, 2]",
    () => [1, 2],
    {
      "1,2": "text",
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
      "a,b": "text",
      '["a","b"]': "json",
      '["a", "b"]': "jsonb",
      ERR_INVALID_ARG_TYPE: "bytea",
      "{a,b}": "text_array",
      '{"\\"a\\"","\\"b\\""}': "jsonb_array",
    },
  ],
  // The OID of a user-defined type does not say whether it is an array type: sql.array(values, "mood") does.
  [
    '["a"]',
    () => ["a"],
    {
      a: "text mood",
      '["a"]': "json jsonb",
      ERR_INVALID_ARG_TYPE: "bytea",
      "{a}": "text_array",
      '{"\\"a\\""}': "jsonb_array",
    },
  ],
  [
    "[true]",
    () => [true],
    { true: "text bool", "[true]": "json jsonb", ERR_INVALID_ARG_TYPE: "bytea", "{true}": "text_array jsonb_array" },
  ],
  [
    "[1, null]",
    () => [1, null],
    {
      "1,": "text",
      "[1,null]": "json",
      "[1, null]": "jsonb",
      ERR_INVALID_ARG_TYPE: "bytea",
      "{1,NULL}": "int4_array float4_array text_array",
      '{1,"null"}': "jsonb_array",
    },
  ],
  [
    "[[1, 2], [3, 4]]",
    () => [
      [1, 2],
      [3, 4],
    ],
    {
      "1,2,3,4": "text",
      "[[1,2],[3,4]]": "json",
      "[[1, 2], [3, 4]]": "jsonb",
      ERR_INVALID_ARG_TYPE: "bytea",
      "{{1,2},{3,4}}": "int4_array float4_array text_array jsonb_array",
    },
  ],
  [
    "{ a: 1 }",
    () => ({ a: 1 }),
    { '{"a":1}': "text json", '{"a": 1}': "jsonb", ERR_INVALID_ARG_TYPE: "bytea " + builtinArrays },
    { [textBytes('{"a":1}')]: "bytea", rejected: builtinArrays },
  ],
  [
    // The client does not know that mood[] is an array, nor any type when it has not asked for them.
    "{}",
    () => ({}),
    { "{}": "text json jsonb mood_array", ERR_INVALID_ARG_TYPE: "bytea " + builtinArrays },
    { [textBytes("{}")]: "bytea", "{}": builtinArrays },
  ],
  [
    "an object with toJSON",
    () => ({ toJSON: () => ({ b: 2 }) }),
    { '{"b":2}': "text json", '{"b": 2}': "jsonb", ERR_INVALID_ARG_TYPE: "bytea " + builtinArrays },
    { [textBytes('{"b":2}')]: "bytea", rejected: builtinArrays },
  ],
  [
    "an object without a prototype",
    () => Object.assign(Object.create(null), { a: 1 }),
    { '{"a":1}': "text json", '{"a": 1}': "jsonb", ERR_INVALID_ARG_TYPE: "bytea " + builtinArrays },
    { [textBytes('{"a":1}')]: "bytea", rejected: builtinArrays },
  ],
  [
    "an object with valueOf",
    () => ({ c: 12, valueOf: () => 12 }),
    { '{"c":12}': "text json", '{"c": 12}': "jsonb", ERR_INVALID_ARG_TYPE: "bytea " + builtinArrays },
    { [textBytes('{"c":12}')]: "bytea", rejected: builtinArrays },
  ],
  [
    "a Symbol.toPrimitive that is undefined",
    () => ({ a: 1, [Symbol.toPrimitive]: undefined }),
    { '{"a":1}': "text json", '{"a": 1}': "jsonb", ERR_INVALID_ARG_TYPE: "bytea " + builtinArrays },
    { [textBytes('{"a":1}')]: "bytea", rejected: builtinArrays },
  ],
  [
    "a Symbol.toPrimitive that is null",
    () => ({ a: 1, [Symbol.toPrimitive]: null }),
    { '{"a":1}': "text json", '{"a": 1}': "jsonb", ERR_INVALID_ARG_TYPE: "bytea " + builtinArrays },
    { [textBytes('{"a":1}')]: "bytea", rejected: builtinArrays },
  ],
  [
    "an object with toString",
    () => ({ toString: () => "7" }),
    { 7: "text int4 int8 float4 float8 numeric", "{}": "json jsonb", ERR_INVALID_ARG_TYPE: "bytea" },
  ],
  [
    "an object with valueOf and toString",
    () => ({ valueOf: () => 12, toString: () => "s12" }),
    { s12: "text", "{}": "json jsonb", ERR_INVALID_ARG_TYPE: "bytea" },
  ],
  [
    "an object with Symbol.toPrimitive",
    () => ({ [Symbol.toPrimitive]: () => "7" }),
    { 7: "text int4 int8 float4 float8 numeric", "{}": "json jsonb", ERR_INVALID_ARG_TYPE: "bytea" },
  ],
  [
    "a Symbol.toPrimitive that minds the hint",
    () => ({ cents: 1200, [Symbol.toPrimitive]: (hint: string) => (hint === "number" ? 12 : "12.00") }),
    {
      "12.00": "text numeric",
      12: "float4 float8",
      '{"cents":1200}': "json",
      '{"cents": 1200}': "jsonb",
      ERR_INVALID_ARG_TYPE: "bytea",
    },
  ],
  [
    "Symbol.toPrimitive and toJSON",
    () => ({ [Symbol.toPrimitive]: () => "p12", toJSON: () => ({ j: 12 }) }),
    { p12: "text", '{"j":12}': "json", '{"j": 12}': "jsonb", ERR_INVALID_ARG_TYPE: "bytea" },
  ],
  [
    "a Symbol.toPrimitive that gives an array literal",
    () => ({ [Symbol.toPrimitive]: () => "{1,2}" }),
    { "{1,2}": "text " + builtinArrays, "{}": "json jsonb", ERR_INVALID_ARG_TYPE: "bytea" },
  ],
  [
    "a Symbol.toPrimitive that gives a date",
    () => ({ [Symbol.toPrimitive]: () => "2024-01-02" }),
    {
      "2024-01-02": "text date",
      "2024-01-02 00:00:00": "timestamp",
      "2024-01-02 00:00:00+00": "timestamptz",
      "{}": "json jsonb",
      ERR_INVALID_ARG_TYPE: "bytea",
    },
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

    describe("an object that converts itself", () => {
      // It goes as String(value), whatever the type of the parameter is. What `select $1::type::text` gives for one
      // that converts itself to the first element; null: the server refuses that text.
      const types = ["text", "int2", "int4", "int8", "oid", "float4", "float8", "numeric", "bool"];
      const conversions: [primitive: unknown, ...stored: (string | null)[]][] = [
        [12, "12", "12", "12", "12", "12", "12", "12", "12", null],
        [12.5, "12.5", null, null, null, null, "12.5", "12.5", "12.5", null],
        [-12.7, "-12.7", null, null, null, null, "-12.7", "-12.7", "-12.7", null],
        [-0, "0", "0", "0", "0", "0", "0", "0", "0", "false"],
        [2147483647, "2147483647", null, "2147483647", "2147483647", "2147483647", "2.1474836e+09", "2147483647", "2147483647", null], // prettier-ignore
        [2147483648, "2147483648", null, null, "2147483648", "2147483648", "2.1474836e+09", "2147483648", "2147483648", null], // prettier-ignore
        [1e20, "100000000000000000000", null, null, null, null, "1e+20", "1e+20", "100000000000000000000", null],
        [1e21, "1e+21", null, null, null, null, "1e+21", "1e+21", "1000000000000000000000", null],
        [Infinity, "Infinity", null, null, null, null, "Infinity", "Infinity", "Infinity", null],
        [NaN, "NaN", null, null, null, null, "NaN", "NaN", "NaN", null],
        ["12", "12", "12", "12", "12", "12", "12", "12", "12", null],
        ["12.00", "12.00", null, null, null, null, "12", "12", "12.00", null],
        [" 12 ", " 12 ", "12", "12", "12", "12", "12", "12", "12", null],
        ["", "", null, null, null, null, null, null, null, null],
        ["0x10", "0x10", null, null, null, null, "16", "16", null, null],
        ["1e3", "1e3", null, null, null, null, "1000", "1000", "1000", null],
        ["abc", "abc", null, null, null, null, null, null, null, null],
        [true, "true", null, null, null, null, null, null, null, "true"],
        [null, "null", null, null, null, null, null, null, null, null],
        [undefined, "undefined", null, null, null, null, null, null, null, null],
        [12n, "12", "12", "12", "12", "12", "12", "12", "12", null],
      ];

      describe.each<[string, (primitive: unknown) => object]>([
        ["Symbol.toPrimitive", primitive => ({ [Symbol.toPrimitive]: () => primitive })],
        ["toString", primitive => ({ toString: () => primitive })],
      ])("%s", (_, convertsTo) => {
        test.each(types)("into %s", async type => {
          const stored: [string, unknown][] = [];
          for (const [primitive] of conversions) {
            stored.push([
              Bun.inspect(primitive),
              await sql.unsafe(`select $1::${type}::text as v`, [convertsTo(primitive)]).then(
                ([{ v }]) => v,
                err => (refusals.has(err.errno) ? null : (err.errno ?? err.code ?? String(err))),
              ),
            ]);
          }
          expect(stored).toEqual(conversions.map(row => [Bun.inspect(row[0]), row[types.indexOf(type) + 1]]));
        });
      });

      /** What was called for a parameter of each type of `columns`. */
      async function calls(make: (log: string[]) => object) {
        const logs: Record<string, string> = {};
        for (const [name, type] of Object.entries(columns)) {
          const log: string[] = [];
          await sql.unsafe(`select $1::${type} as v`, [make(log)]).catch(() => {});
          logs[name] = log.join(" ");
        }
        return logs;
      }
      // JSON.stringify asks for neither, and bytea takes no object.
      const everywhere = (log: string) =>
        Object.fromEntries(Object.keys(columns).map(name => [name, /^(json|jsonb|bytea)$/.test(name) ? "" : log]));

      test("Symbol.toPrimitive is called once, with the hint string", async () => {
        expect(await calls(log => ({ [Symbol.toPrimitive]: (hint: string) => (log.push(hint), "12") }))).toEqual(
          everywhere("string"),
        );
      });

      test("toString is called once", async () => {
        expect(await calls(log => ({ toString: () => (log.push("toString"), "12") }))).toEqual(everywhere("toString"));
      });

      test.each<[string, (log: string[]) => object, string]>([
        ["alone", log => ({ valueOf: () => (log.push("valueOf"), 12) }), ""],
        [
          "next to toString",
          log => ({ valueOf: () => (log.push("valueOf"), 12), toString: () => (log.push("toString"), "12") }),
          "toString",
        ],
        [
          "next to Symbol.toPrimitive",
          log => ({
            valueOf: () => (log.push("valueOf"), 12),
            [Symbol.toPrimitive]: () => (log.push("toPrimitive"), "12"),
          }),
          "toPrimitive",
        ],
      ])("valueOf is never called: %s", async (_, make, log) => {
        expect(await calls(make)).toEqual(everywhere(log));
      });

      const boom = new Error("boom");
      test.each<[string, object, unknown]>([
        [
          "throws",
          {
            [Symbol.toPrimitive]() {
              throw boom;
            },
          },
          boom,
        ],
        ["returns an object", { [Symbol.toPrimitive]: () => ({}) }, expect.any(TypeError)],
        ["is not callable", { [Symbol.toPrimitive]: 1 }, expect.any(TypeError)],
      ])("a Symbol.toPrimitive that %s rejects the query, and only that", async (_, value, error) => {
        const [{ pid }] = await sql`select pg_backend_pid() as pid`;
        for (const type of ["text", "int4", "float8", "numeric"]) {
          expect(
            await sql.unsafe(`select $1::${type} as v`, [value]).then(
              rows => rows,
              err => err,
            ),
          ).toEqual(error);
        }
        expect(await sql`select pg_backend_pid() as pid`).toEqual([{ pid }]);
      });

      class Money {
        constructor(public cents: number) {}
        [Symbol.toPrimitive](hint: string) {
          return hint === "number" ? this.cents / 100 : (this.cents / 100).toFixed(2);
        }
      }

      test("in sql() for an insert and an update, and in a comparison", async () => {
        await sql`create temp table if not exists prices (id int, label text, ratio float8, amount numeric)`;
        await sql`delete from prices`;
        expect(
          await sql`insert into prices ${sql({ id: 1, label: new Money(1250), ratio: new Money(1250) })} returning label, ratio`,
        ).toEqual([{ label: "12.50", ratio: 12.5 }]);
        expect(await sql`update prices set ${sql({ label: new Money(999) })} where id = 1 returning label`).toEqual([
          { label: "9.99" },
        ]);
        expect(await sql`select id from prices where label = ${new Money(999)}`).toEqual([{ id: 1 }]);
      });

      test("into numeric", async () => {
        expect(await sql`select ${new Money(1250)}::numeric as amount`).toEqual([{ amount: "12.50" }]);
      });
    });

    // '{}' is also the literal of an empty array.
    describe("an object that goes as JSON is no array", () => {
      const outcome = (text: string, values: unknown[]) =>
        sql.unsafe(text, values).then(
          ([{ v }]) => v,
          err => `${err.code}: ${err.message}`,
        );
      class Methods {
        valueOf() {
          return 12;
        }
      }

      // With `prepare: false` it takes another parameter that asks the server for the types.
      test.each<[string, unknown, string]>([
        ["{}", {}, "an instance of Object"],
        ["{ a: undefined }", { a: undefined }, "an instance of Object"],
        ["an instance with methods only", new Methods(), "an instance of Methods"],
        ["a toJSON that returns {}", { toJSON: () => ({}) }, "an instance of Object"],
        ["{ a: 1 }", { a: 1 }, "an instance of Object"],
      ])("%s", async (_, value, received) => {
        for (const type of ["int4", "text", "jsonb"]) {
          expect(await outcome(`select $2::${type}[]::text as v, $1::int4[] as other`, [[1], value])).toBe(
            `ERR_INVALID_ARG_TYPE: Query parameter $2 of type ${type}[] must be an Array, Int32Array or string. Received ${received}`,
          );
        }
      });

      test("what is an array goes on working", async () => {
        expect([
          await outcome("select $1::int4[]::text as v", ["{}"]),
          await outcome("select $1::int4[]::text as v", [[]]),
          await outcome("select $1::int4[]::text as v", [{ toString: () => "{1,2}" }]),
          await outcome("select $1::int4[]::text as v", [{ [Symbol.toPrimitive]: () => "{1,2}" }]),
          await outcome("select $1::jsonb::text as v", [{}]),
          await outcome("select $1::text as v", [{}]),
        ]).toEqual(["{}", "{}", "{1,2}", "{1,2}", "{}", "{}"]);
      });
    });

    describe("in json and jsonb a Date is what JSON.stringify makes of it", () => {
      const day = 86400000;
      // With `prepare: false` it takes another parameter that asks the server for the types.
      const stored = (type: string, value: unknown) =>
        (prepare
          ? sql.unsafe(`select $1::${type}::text as v`, [value])
          : sql.unsafe(`select $1::${type}::text as v, $2::int4[] as other`, [value, [1]])
        ).then(
          ([{ v }]) => v,
          err => err,
        );
      const boom = new Error("boom");

      test.each<[string, () => Date, unknown]>([
        ["a Date", () => new Date(day), '"1970-01-02T00:00:00.000Z"'],
        ["an Invalid Date", () => new Date(NaN), "null"],
        ["the year 10000", () => new Date(253402300800000), '"+010000-01-01T00:00:00.000Z"'],
        ["the year -1", () => new Date(-62198755200000), '"-000001-01-01T00:00:00.000Z"'],
        ["a subclass", () => new (class extends Date {})(day), '"1970-01-02T00:00:00.000Z"'],
        [
          "a subclass with toJSON",
          () =>
            new (class extends Date {
              toJSON() {
                return "1970-01-02";
              }
            })(day),
          '"1970-01-02"',
        ],
        [
          "a subclass with toISOString",
          () =>
            new (class extends Date {
              toISOString() {
                return "iso!";
              }
            })(day),
          '"iso!"',
        ],
        ["a toJSON of its own", () => Object.assign(new Date(day), { toJSON: () => "own" }), '"own"'],
        ["a toJSON that returns an array", () => Object.assign(new Date(day), { toJSON: () => [1970] }), "[1970]"],
        [
          "a toJSON that throws",
          () =>
            Object.assign(new Date(day), {
              toJSON() {
                throw boom;
              },
            }),
          boom,
        ],
        // Neither is asked for JSON.
        ["a toString of its own", () => Object.assign(new Date(day), { toString: () => "day" }), '"1970-01-02T00:00:00.000Z"'], // prettier-ignore
      ])("%s", async (_, date, json) => {
        expect([await stored("json", date()), await stored("jsonb", date())]).toEqual([json, json]);
      });

      test("under a Date.prototype.toJSON of the program", async () => {
        const toJSON = Date.prototype.toJSON;
        Date.prototype.toJSON = () => "patched";
        try {
          expect(await stored("jsonb", new Date(day))).toBe('"patched"');
        } finally {
          Date.prototype.toJSON = toJSON;
        }
      });

      test("alone as inside an object", async () => {
        class Day extends Date {
          toJSON() {
            return "1970-01-02";
          }
        }
        for (const date of [new Day(day), new Date(day), new Date(NaN)]) {
          expect(`{"d": ${await stored("jsonb", date)}}`).toBe(await stored("jsonb", { d: date }));
        }
      });

      test("every other type takes the instant", async () => {
        const date = Object.assign(new Date(day), { toJSON: () => "own", toString: () => "day" });
        expect([await stored("text", date), await stored("date", date), await stored("timestamptz", date)]).toEqual([
          "1970-01-02T00:00:00.000Z",
          "1970-01-02",
          "1970-01-02 00:00:00+00",
        ]);
      });
    });

    describe("a value whose JSON is undefined", () => {
      test.each<[string, () => unknown]>([
        ["a toJSON that returns undefined", () => ({ toJSON: () => undefined })],
        ["a toJSON that returns a function", () => ({ toJSON: () => () => 1 })],
        ["a toJSON that returns a symbol", () => ({ toJSON: () => Symbol("s") })],
        ["sql.json(undefined)", () => sql.json(undefined)],
        ["sql.json(() => 1)", () => sql.json(() => 1)],
      ])("%s is no parameter", async (_, value) => {
        const codes: Record<string, string> = {};
        for (const [name, type] of Object.entries(columns)) {
          codes[name] = await sql.unsafe(`select $1::${type} as v`, [value()]).then(
            ([{ v }]) => `stored ${JSON.stringify(v)}`,
            err => `${err.name} ${err.code}`,
          );
        }
        expect(codes).toEqual(
          Object.fromEntries(Object.keys(columns).map(name => [name, "TypeError ERR_INVALID_ARG_TYPE"])),
        );
        expect(await sql.unsafe("select $1::int4 as a, $2::text as v", [1, value()]).catch(err => err.message)).toBe(
          "Cannot bind an object whose JSON is undefined to query parameter $2",
        );
      });

      test("a Date with such a toJSON", async () => {
        const date = Object.assign(new Date(0), { toJSON: () => undefined });
        expect(
          await sql.unsafe("select $1::jsonb as v, $2::int4[] as other", [date, [1]]).catch(err => err.message),
        ).toBe("Cannot bind an object whose JSON is undefined to query parameter $1");
      });

      test("a function is String(value), and no JSON", async () => {
        const f = () => 1;
        expect([
          await sql.unsafe("select $1::text as v", [f]).then(([{ v }]) => v),
          await sql.unsafe("select $1::jsonb as v", [f]).catch(err => err.message),
        ]).toEqual(["() => 1", "Cannot bind an object whose JSON is undefined to query parameter $1"]);
      });

      test("null is JSON", async () => {
        expect(await sql.unsafe("select $1::text as v", [{ toJSON: () => null }])).toEqual([{ v: "null" }]);
      });
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
      [Infinity, "double precision", "Infinity"],
      [-Infinity, "double precision", "-Infinity"],
      [new Uint8Array([1]), "bytea", "\\x01"],
      [new Uint16Array([1, 2]), "bytea", "\\x01000200"],
      [new Float32Array([1.5]), "bytea", "\\x0000c03f"],
      [new DataView(new ArrayBuffer(1)), "bytea", "\\x00"],
    ])("%p is declared as %s", async (value, type, text) => {
      expect(await sql`select pg_typeof(${value})::text as type, ${value}::text as text`).toEqual([{ type, text }]);
    });

    // The server types `$1` as boolean. Only a boolean (or a string the server reads as one) may decide it.
    test.each<[string, unknown]>([
      ["[]", []],
      ["[1, 2]", [1, 2]],
      ["['a']", ["a"]],
      ["{ id: 1 }", { id: 1 }],
      ["a Date", new Date(0)],
      ["Int32Array [1, 2]", new Int32Array([1, 2])],
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

    test.each<[string, unknown]>([
      ["[true]", [true]],
      ["[1]", [1]],
      ["['t']", ["t"]],
      ["Int32Array [1]", new Int32Array([1])],
    ])("where ${%s} is what the server makes of String(value)", async (_, condition) => {
      expect(await sql`select 1 as hit where ${condition}`).toEqual([{ hit: 1 }]);
    });

    test.each<[keyof typeof columns, unknown[], string]>([
      ["text", ["a", "b"], "a,b"],
      ["text", [1, 2], "1,2"],
      ["text", [], ""],
      ["int4", [1], "1"],
      ["int8", [1], "1"],
      ["float8", [1], "1"],
      ["date", ["2024-01-02"], "2024-01-02"],
      ["mood", ["a"], "a"],
    ])("a %s column stores String(%p)", async (column, value, stored) => {
      expect(await sql`insert into bind ${sql({ [column]: value })} returning ${sql(column)}::text as stored`).toEqual([
        { stored },
      ]);
    });

    test("an array where the server infers no array type is String(value)", async () => {
      expect(
        await sql`
          select ${["a", "b"]} as bare, 'x:' || ${["a", "b"]} as joined, ${[]} as empty,
            string_to_array(${[1, 2, 3]}, ',')::int[]::text as split`,
      ).toEqual([{ bare: "a,b", joined: "x:a,b", empty: "", split: "{1,2,3}" }]);
    });

    test("sql.array() names the type of an array of a user-defined type", async () => {
      expect(
        await sql`insert into bind ${sql({ mood_array: sql.array(["a", "b"], "pg_temp.mood") })} returning mood_array::text as stored`,
      ).toEqual([{ stored: "{a,b}" }]);
    });

    // Whether Bun asks for the types with `prepare: false` depends on the other values.
    test.each<[string, unknown]>([
      ["null", null],
      ["an array", [1, 2]],
    ])("the value next to a string does not change what the string is: %s", async (_, neighbour) => {
      expect(
        await sql`insert into bind (int4_array, jsonb) values (${neighbour}, ${'{"a":1}'}) returning jsonb_typeof(jsonb) as stored`,
      ).toEqual([{ stored: prepare ? "string" : "object" }]);
    });

    test.skipIf(!prepare)("a statement that is prepared a second time sends the same JSON", async () => {
      const run = () => sql`select ${"a"}::jsonb::text as string, ${{ a: 1 }}::jsonb::text as object`;
      await run();
      await sql.unsafe("deallocate all");
      expect(await run()).toEqual([{ string: '"a"', object: '{"a": 1}' }]);
    });

    test("what a query returns can be bound again", async () => {
      const [row] = await sql`
        select 'infinity'::float4 as float4, '{1,2}'::int4[] as ints, '{1.5,NULL}'::float4[] as floats`;
      expect(
        await sql`
          select ${row.float4}::float4::text as float4, ${row.ints}::int4[]::text as ints, ${row.floats}::float4[]::text as floats`,
      ).toEqual([{ float4: "Infinity", ints: "{1,2}", floats: "{1.5,NULL}" }]);
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
