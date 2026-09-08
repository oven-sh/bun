// How Bun.SQL encodes a Bind parameter once the server has told it the
// parameter's type (ParameterDescription). Bun leaves the OID unspecified for
// Date / array / object values, so the server infers the column type, and Bind
// then has to send bytes that match the format code it announces for that slot.
//
// Two things are checked against a real server, by reading the stored value
// back as text:
//  - A type with no binary encoder (float4, numeric, time, int4[], float4[]) is
//    announced and sent as text, so the server parses or rejects it as it would
//    a literal. Previously these were announced as binary while the bytes were
//    `String(value)`, which the server read as a garbled binary datum.
//  - A type that has a binary encoder (bool, int4, float8, timestamp,
//    timestamptz) uses it only for the JS class it represents exactly. Any other
//    class is sent as text too, instead of being coerced (truthiness, wrapped
//    int32, NaN, 2000-01-01). bytea is the exception: its text input accepts
//    any string, so a non-BufferSource value rejects instead
//    (postgres-bytea-bind.test.ts).
//  - A Date sent as text is ISO 8601 (`toISOString()`), so a `date` or `text`
//    slot, and every slot under `prepare: false`, receives a literal the server
//    parses. Previously it was `Date.prototype.toString()` output, which
//    PostgreSQL rejects (#29010).
//
// The mock-server tests pin the exact Bind bytes (format codes and values) and
// need no database, so they run on every lane.

import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { describeWithContainer } from "harness";
import {
  type PgBind,
  pgBindComplete,
  pgCommandComplete,
  pgDataRow,
  pgDecodeBind,
  pgMockServer,
  pgNoData,
  pgParameterDescription,
  pgParseComplete,
  pgReadyForQuery,
  pgRowDescription,
} from "./wire-frames";

// Stand-in for a decimal.js / big.js style value: not a string, but its text
// form is what should reach the server.
class Textual {
  constructor(public text: string) {}
  toString() {
    return this.text;
  }
}

/**
 * Mock backend for one prepared query. Describe is answered with the given
 * parameter OIDs and result columns, Execute with one `row`. Resolves with
 * every Bind the client sent and the rows it decoded.
 */
async function runAgainstMock(opts: {
  paramOids: number[];
  columns?: { name: string; typeOid: number }[];
  row?: (Buffer | null)[];
  query: (sql: SQL) => Promise<any>;
}): Promise<{ binds: PgBind[]; rows: any }> {
  const binds: PgBind[] = [];
  const columns = opts.columns ?? [];
  const { server, port } = await pgMockServer((type, body, socket) => {
    switch (type) {
      case "P":
        return pgParseComplete();
      case "D":
        return [pgParameterDescription(opts.paramOids), columns.length ? pgRowDescription(columns) : pgNoData()];
      case "B":
        binds.push(pgDecodeBind(body));
        return pgBindComplete();
      case "E":
        return opts.row ? [pgDataRow(opts.row), pgCommandComplete("SELECT 1")] : pgCommandComplete("SELECT 0");
      case "S":
        return pgReadyForQuery();
      case "X":
        socket.end();
        break;
    }
  });
  try {
    await using sql = new SQL({ url: `postgres://u@127.0.0.1:${port}/db`, max: 1 });
    const rows = await opts.query(sql);
    return { binds, rows };
  } finally {
    server.close();
  }
}

describe("Bind format codes (mock server)", () => {
  test("parameters typed numeric, float4, time, int4[] and float4[] are declared and sent as text", async () => {
    const { binds } = await runAgainstMock({
      // numeric, float4, time, int4_array, float4_array
      paramOids: [1700, 700, 1083, 1007, 1021],
      query: sql =>
        sql.unsafe("select $1, $2, $3, $4, $5", [
          new Textual("19.99"),
          new Textual("1234"),
          new Textual("12:34:56"),
          sql.array([1, 2], "INT4"),
          sql.array([1.5], "REAL"),
        ]),
    });
    expect(binds).toHaveLength(1);
    expect({
      paramFormats: binds[0].paramFormats,
      params: binds[0].params.map(p => p?.toString("latin1")),
    }).toEqual({
      paramFormats: [0, 0, 0, 0, 0],
      params: ["19.99", "1234", "12:34:56", `{"1","2"}`, "{1.5}"],
    });
  });

  test("parameters with a binary encoder are declared binary, a string or mismatched class stays text", async () => {
    const date = new Date("2000-01-01T00:00:01.000Z"); // 1_000_000 us after the Postgres epoch
    const { binds } = await runAgainstMock({
      // bool, int4, float8, timestamptz, bytea, int4 (from a string), int4 (2^31), bool (from a Date), date
      paramOids: [16, 23, 701, 1184, 17, 23, 23, 16, 1082],
      query: sql =>
        sql.unsafe("select $1, $2, $3, $4, $5, $6, $7, $8, $9", [
          true,
          7,
          1.5,
          date,
          Buffer.from([1, 2]),
          "8",
          2 ** 31,
          date,
          date,
        ]),
    });
    expect(binds).toHaveLength(1);
    expect({ paramFormats: binds[0].paramFormats, params: binds[0].params }).toEqual({
      paramFormats: [1, 1, 1, 1, 1, 0, 0, 0, 0],
      params: [
        Buffer.from([1]),
        Buffer.from([0, 0, 0, 7]),
        Buffer.from("3ff8000000000000", "hex"),
        Buffer.from("00000000000f4240", "hex"),
        Buffer.from([1, 2]),
        Buffer.from("8"),
        Buffer.from("2147483648"),
        Buffer.from("2000-01-01T00:00:01.000Z"),
        Buffer.from("2000-01-01T00:00:01.000Z"),
      ],
    });
  });

  test("a result column whose OID is above 65535 is requested and decoded as text", async () => {
    // 65552 = 65536 + 16: a user-defined type whose low 16 bits alias `bool`.
    const { binds, rows } = await runAgainstMock({
      paramOids: [23],
      columns: [
        { name: "custom", typeOid: 65552 },
        { name: "n", typeOid: 23 },
      ],
      row: [Buffer.from("(42,t)"), Buffer.from([0, 0, 0, 9])],
      query: sql => sql`select custom, n from t where n = ${9}`,
    });
    expect(binds).toHaveLength(1);
    expect({ resultFormats: binds[0].resultFormats, row: rows[0] }).toEqual({
      resultFormats: [0, 1],
      row: { custom: "(42,t)", n: 9 },
    });
  });
});

const date = new Date("2026-09-07T10:11:12.345Z");
const invalidDate = new Date(NaN);
// Stand-ins for userland value types that stringify to a literal the server
// understands (decimal.js, a Temporal polyfill, a time-of-day class, ...).
const decimal = { toString: () => "1.50" };
const timeOfDay = { toString: () => "07:08:09" };
const instant = { toString: () => "2026-09-07T10:11:12.345Z" };
const pgArray = { toString: () => "{1.5,2}" };

type Case = [label: string, column: string, value: unknown, expected: string | null];

// `expected` is the stored value cast to text, or the SQLSTATE the server
// rejects the parameter with: 22P02 invalid_text_representation, 22007
// invalid_datetime_format, 22003 numeric_value_out_of_range.
const noBinaryEncoder: Case[] = [
  ["[1234] -> float4", "float4", [1234], "1234"],
  ["decimal object -> float4", "float4", decimal, "1.5"],
  ["Date -> float4", "float4", date, "22P02"],
  ["decimal object -> numeric", "numeric", decimal, "1.50"],
  ["[1, 2] -> numeric", "numeric", [1, 2], "22P02"],
  ["Date -> numeric", "numeric", date, "22P02"],
  ["time-of-day object -> time", "time", timeOfDay, "07:08:09"],
  ["Date -> time", "time", date, "22007"],
  ["[1, 2] -> int4[]", "int4[]", [1, 2], "22P02"],
  ["array-literal object -> int4[]", "int4[]", { toString: () => "{1,2}" }, "{1,2}"],
  ["Int32Array -> int4[]", "int4[]", new Int32Array([1, 2]), "22P02"],
  ["[1.5, 2] -> float4[]", "float4[]", [1.5, 2], "22P02"],
  ["array-literal object -> float4[]", "float4[]", pgArray, "{1.5,2}"],
];

const classMismatch: Case[] = [
  ["Date -> bool", "bool", date, "22P02"],
  ["{} -> bool", "bool", {}, "22P02"],
  ["[1, 2] -> bool", "bool", [1, 2], "22P02"],
  ["Date -> int4", "int4", date, "22P02"],
  ["[1, 2] -> int4", "int4", [1, 2], "22P02"],
  ["{} -> int4", "int4", {}, "22P02"],
  ["Date -> float8", "float8", date, "22P02"],
  ["[1, 2] -> float8", "float8", [1, 2], "22P02"],
  ["{} -> float8", "float8", {}, "22P02"],
  ["[1, 2] -> timestamptz", "timestamptz", [1, 2], "22007"],
  ["{} -> timestamptz", "timestamptz", {}, "22007"],
  ["Invalid Date -> timestamptz", "timestamptz", invalidDate, "22007"],
  ["Invalid Date -> timestamp", "timestamp", invalidDate, "22007"],
  ["ISO instant object -> timestamptz", "timestamptz", instant, "2026-09-07 10:11:12.345+00"],
  ["ISO instant object -> timestamp", "timestamp", instant, "2026-09-07 10:11:12.345"],
];

// A Date in a text-format slot is `toISOString()`. An Invalid Date has no ISO
// form, so it stays `String(date)` and a typed slot rejects it.
const dateAsText: Case[] = [
  ["Date -> date", "date", date, "2026-09-07"],
  ["Date -> text", "text", date, "2026-09-07T10:11:12.345Z"],
  ["Date -> timetz", "timetz", date, "22007"],
  ["Invalid Date -> date", "date", invalidDate, "22007"],
  ["Invalid Date -> text (unchanged)", "text", invalidDate, "Invalid Date"],
];

// These were already exact and must stay on the binary encoders.
const exactClass: Case[] = [
  ["true -> bool", "bool", true, "true"],
  ["false -> bool", "bool", false, "false"],
  ["7 -> int4", "int4", 7, "7"],
  ["-2147483648 -> int4", "int4", -2147483648, "-2147483648"],
  ["2147483647 -> int4", "int4", 2147483647, "2147483647"],
  ["1.5 -> float8", "float8", 1.5, "1.5"],
  ["-0 -> float8", "float8", -0, "-0"],
  ["1e300 -> float8", "float8", 1e300, "1e+300"],
  ["NaN -> float8", "float8", NaN, "NaN"],
  ["Infinity -> float8", "float8", Infinity, "Infinity"],
  ["Uint8Array -> bytea", "bytea", new Uint8Array([1, 2, 3]), "\\x010203"],
  ["empty Uint8Array -> bytea", "bytea", new Uint8Array(0), "\\x"],
  ["Buffer -> bytea", "bytea", Buffer.from("hi"), "\\x6869"],
  ["ArrayBuffer -> bytea", "bytea", new Uint8Array([4, 5]).buffer, "\\x0405"],
  ["Date -> timestamptz", "timestamptz", date, "2026-09-07 10:11:12.345+00"],
  ["Date -> timestamp", "timestamp", date, "2026-09-07 10:11:12.345"],
  ["epoch Date -> timestamptz", "timestamptz", new Date(0), "1970-01-01 00:00:00+00"],
  ["[1, 2] -> jsonb", "jsonb", [1, 2], "[1, 2]"],
  ["{a: 1} -> jsonb", "jsonb", { a: 1 }, '{"a": 1}'],
  ["Date -> json", "json", date, '"2026-09-07T10:11:12.345Z"'],
  ["123n -> int8", "int8", 123n, "123"],
  ['"7" -> int4', "int4", "7", "7"],
  ['"1.5" -> float4', "float4", "1.5", "1.5"],
  ['"07:08:09" -> time', "time", "07:08:09", "07:08:09"],
  ['"t" -> bool', "bool", "t", "true"],
  ["null -> int4", "int4", null, null],
  ["undefined -> timestamptz", "timestamptz", undefined, null],
];

const columns: Record<string, string> = {
  "float4": "c_float4",
  "numeric": "c_numeric",
  "time": "c_time",
  "int4[]": "c_int4_array",
  "float4[]": "c_float4_array",
  "bool": "c_bool",
  "bytea": "c_bytea",
  "int4": "c_int4",
  "float8": "c_float8",
  "timestamptz": "c_timestamptz",
  "timestamp": "c_timestamp",
  "jsonb": "c_jsonb",
  "json": "c_json",
  "int8": "c_int8",
  "date": "c_date",
  "text": "c_text",
  "timetz": "c_timetz",
};

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  let sql: SQL;
  const url = () => `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`;

  beforeAll(async () => {
    await container.ready;
    sql = new SQL({ url: url(), max: 1 });
    await sql`set time zone 'UTC'`;
    await sql.unsafe(
      `create temp table bind_format (${Object.entries(columns)
        .map(([type, name]) => `${name} ${type}`)
        .join(", ")})`,
    );
  });

  afterAll(() => sql?.close());

  async function run(cases: Case[]) {
    const actual: Case[] = [];
    for (const [label, column, value] of cases) {
      const name = columns[column];
      const stored = await sql
        .unsafe(`insert into bind_format (${name}) values ($1) returning ${name}::text as v`, [value])
        .then(
          rows => rows[0].v,
          error => error?.errno ?? String(error),
        );
      actual.push([label, column, value, stored]);
    }
    return actual;
  }

  test("parameters of a type with no binary encoder are bound as text", async () => {
    expect(await run(noBinaryEncoder)).toEqual(noBinaryEncoder);
  });

  test("a binary encoder is used only for the JS class it encodes exactly", async () => {
    expect(await run(classMismatch)).toEqual(classMismatch);
  });

  test("values of the matching class keep their binary encoding", async () => {
    expect(await run(exactClass)).toEqual(exactClass);
  });

  test("a Date bound as text is ISO 8601 (#29010)", async () => {
    expect(await run(dateAsText)).toEqual(dateAsText);
  });

  test("prepare: false sends a Date as ISO 8601 before the server has typed the parameter (#29010)", async () => {
    // Bind is written together with Parse here, so every parameter is still
    // untyped (text) when it is encoded.
    await using unnamed = new SQL({ url: url(), max: 1, prepare: false });
    await unnamed`set time zone 'UTC'`;
    const [row] =
      await unnamed`select ${date}::timestamptz::text as a, ${date}::date::text as b, ${invalidDate}::text as c`;
    expect(row).toEqual({ a: "2026-09-07 10:11:12.345+00", b: "2026-09-07", c: "Invalid Date" });
  });

  // The tagged template and the sql(object) helper, each on its own connection
  // so the temp tables do not collide with `bind_format` above.
  const connect = () => new SQL({ url: url(), max: 1 });

  test("object bound to a numeric, real or time column is sent as its text form", async () => {
    await using sql = connect();
    await sql`create temp table t (n numeric, r real, t time)`;
    const rows = await sql`
      insert into t (n, r, t)
      values (${new Textual("19.99")}, ${new Textual("1234")}, ${new Textual("12:34:56")})
      returning n::text as n, r::text as r, t::text as t`;
    expect(rows[0]).toEqual({ n: "19.99", r: "1234", t: "12:34:56" });
  });

  test("object bound to a $1::numeric / $1::real cast is sent as its text form", async () => {
    await using sql = connect();
    const rows = await sql`select ${new Textual("0.1")}::numeric::text as n, ${new Textual("2.5")}::real::text as r`;
    expect(rows[0]).toEqual({ n: "0.1", r: "2.5" });
  });

  test("sql.array() in the sql(object) helper works for int4[] and real[] columns", async () => {
    await using sql = connect();
    await sql`create temp table t (id int4, ia int4[], ra real[])`;
    const inserted = await sql`
      insert into t ${sql({ id: 1, ia: sql.array([1, 2, 3], "INT4"), ra: sql.array([1.5, 2.5], "REAL") })}
      returning ia::text as ia, ra::text as ra`;
    expect(inserted[0]).toEqual({ ia: "{1,2,3}", ra: "{1.5,2.5}" });

    const updated = await sql`
      update t set ${sql({ ia: sql.array([4], "INT4"), ra: sql.array([0.25], "REAL") })}
      where id = 1
      returning ia::text as ia, ra::text as ra`;
    expect(updated[0]).toEqual({ ia: "{4}", ra: "{0.25}" });
  });

  test("sql.array() passed to sql.unsafe() works for int4[] and real[] parameters", async () => {
    await using sql = connect();
    const rows = await sql.unsafe("select $1::int4[]::text as ia, $2::real[]::text as ra", [
      sql.array([7, 8], "INT4"),
      sql.array([1.5], "REAL"),
    ]);
    expect(rows[0]).toEqual({ ia: "{7,8}", ra: "{1.5}" });
  });
});
