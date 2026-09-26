// A `number` parameter that is an integer must bind as an integer type for
// every safe integer, not only inside JSC's Int52 range [-2^51, 2^51).
// Outside that range the binders used to send float8 (postgres) or DOUBLE
// (mysql), which loses digits in a numeric column and skips a bigint index.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

// Integers from 2^51 up to Number.MAX_SAFE_INTEGER, and the same band below zero.
const band = [2 ** 51, 2 ** 52 + 1, Number.MAX_SAFE_INTEGER, -(2 ** 51) - 1, Number.MIN_SAFE_INTEGER];

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  const connect = () =>
    new SQL({
      url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
    });

  test.each(band)("%d binds as bigint", async v => {
    await container.ready;
    await using sql = connect();
    const [row] = await sql`select pg_typeof(${v})::text as type, ${v}::numeric::text as numeric, ${v} as x`;
    expect(row).toEqual({ type: "bigint", numeric: String(v), x: String(v) });
  });

  test("integers inside the Int52 range still bind as int4 or bigint", async () => {
    await container.ready;
    await using sql = connect();
    const [row] = await sql`select pg_typeof(${7})::text as small, pg_typeof(${2 ** 51 - 1})::text as big`;
    expect(row).toEqual({ small: "integer", big: "bigint" });
  });

  test("fractions, -0, and 2^53 still bind as float8", async () => {
    await container.ready;
    await using sql = connect();
    const [row] = await sql`select
      pg_typeof(${1.5})::text as fraction,
      pg_typeof(${-0})::text as negative_zero_type,
      ${-0}::text as negative_zero,
      pg_typeof(${2 ** 53})::text as unsafe`;
    expect(row).toEqual({
      fraction: "double precision",
      negative_zero_type: "double precision",
      negative_zero: "-0",
      unsafe: "double precision",
    });
  });
});

describeWithContainer("mysql", { image: "mysql_plain" }, container => {
  const connect = () =>
    new SQL({
      url: `mysql://root@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
    });

  test.each(band)("%d binds as BIGINT", async v => {
    await container.ready;
    await using sql = connect();
    // A BIGINT result outside the i32 range comes back as a string. A DOUBLE comes back as a number.
    const [row] = await sql`SELECT CAST(${v} AS CHAR) AS text, ${v} AS x`;
    expect(row).toEqual({ text: String(v), x: String(v) });
  });

  test("fractions, -0, and 2^53 still bind as DOUBLE", async () => {
    await container.ready;
    await using sql = connect();
    const [row] = await sql`SELECT ${1.5} AS fraction, ${-0} AS negative_zero, ${2 ** 53} AS unsafe`;
    expect(row).toEqual({ fraction: 1.5, negative_zero: -0, unsafe: 2 ** 53 });
    expect(Object.is(row.negative_zero, -0)).toBe(true);
  });
});
