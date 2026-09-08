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

import { SQL } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { describeWithContainer } from "harness";

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
});
