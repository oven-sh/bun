// The Bind message declares a format code (0 = text, 1 = binary) for every
// parameter and then carries the encoded values. Bun only has binary encoders
// for bool, int4, float8, timestamp(tz) and bytea. Every other parameter type
// the server reports (numeric, real, time, int4[], real[], ...) is sent as
// `String(value)` and must be declared as text so the server parses it.
//
// Runs against a real Postgres server with the default `prepare: true`, where
// Bun binds with the parameter types from the server's ParameterDescription.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

// Stand-in for a decimal.js / big.js style value: not a string, but its text
// form is what should reach the server.
class Textual {
  constructor(public text: string) {}
  toString() {
    return this.text;
  }
}

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  const connect = () =>
    new SQL({
      url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
    });

  test("object bound to a numeric, real or time column is sent as its text form", async () => {
    await container.ready;
    await using sql = connect();
    await sql`create temp table t (n numeric, r real, t time)`;

    const rows = await sql`
      insert into t (n, r, t)
      values (${new Textual("19.99")}, ${new Textual("1234")}, ${new Textual("12:34:56")})
      returning n::text as n, r::text as r, t::text as t`;
    expect(rows[0]).toEqual({ n: "19.99", r: "1234", t: "12:34:56" });
  });

  test("object bound to a $1::numeric / $1::real cast is sent as its text form", async () => {
    await container.ready;
    await using sql = connect();
    const rows = await sql`select ${new Textual("0.1")}::numeric::text as n, ${new Textual("2.5")}::real::text as r`;
    expect(rows[0]).toEqual({ n: "0.1", r: "2.5" });
  });

  test("sql.array() in the sql(object) helper works for int4[] and real[] columns", async () => {
    await container.ready;
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
    await container.ready;
    await using sql = connect();
    const rows = await sql.unsafe("select $1::int4[]::text as ia, $2::real[]::text as ra", [
      sql.array([7, 8], "INT4"),
      sql.array([1.5], "REAL"),
    ]);
    expect(rows[0]).toEqual({ ia: "{7,8}", ra: "{1.5}" });
  });

  test("parameters with a binary encoder still round-trip", async () => {
    await container.ready;
    await using sql = connect();
    await sql`create temp table t (b bool, i int4, f float8, ts timestamptz, bin bytea, r real, n numeric)`;

    const date = new Date("2024-01-02T03:04:05.678Z");
    const rows = await sql`
      insert into t (b, i, f, ts, bin, r, n)
      values (${true}, ${-123456}, ${1.25}, ${date}, ${Buffer.from([0, 1, 254, 255])}, ${"2.5"}, ${"12345678901234567890.5"})
      returning b, i, f, ts, bin, r::text as r, n::text as n`;
    expect(rows[0]).toEqual({
      b: true,
      i: -123456,
      f: 1.25,
      ts: date,
      bin: Buffer.from([0, 1, 254, 255]),
      r: "2.5",
      n: "12345678901234567890.5",
    });
  });
});
