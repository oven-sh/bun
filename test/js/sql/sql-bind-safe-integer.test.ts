// A JS number that holds a safe integer binds as an integer parameter, over the
// whole range Number.isSafeInteger() accepts. The binders classified numbers
// with JSC's Int52 test, which ends at ±2^51, so a safe integer from 2^51 to
// 2^53-1 went out as float8 / DOUBLE: the server saw `9.007199254740991e+15`,
// and `bigint_col = $1` compared as float8 in PostgreSQL.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer, isDockerEnabled } from "harness";

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  const connect = () =>
    new SQL({ url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`, max: 1 });

  test.each([
    [2 ** 31 - 1, "integer", "2147483647"],
    [2 ** 31, "bigint", "2147483648"],
    [2 ** 51 - 1, "bigint", "2251799813685247"],
    [2 ** 51, "bigint", "2251799813685248"],
    [2 ** 53 - 1, "bigint", "9007199254740991"],
    [-(2 ** 31), "integer", "-2147483648"],
    [-(2 ** 31) - 1, "bigint", "-2147483649"],
    [-(2 ** 51), "bigint", "-2251799813685248"],
    [-(2 ** 51) - 1, "bigint", "-2251799813685249"],
    [-(2 ** 53 - 1), "bigint", "-9007199254740991"],
    // Not a safe integer, or not an integer: stays a double.
    [2 ** 53, "double precision", "9.007199254740992e+15"],
    [-(2 ** 53), "double precision", "-9.007199254740992e+15"],
    [1.5, "double precision", "1.5"],
    [-0, "double precision", "-0"],
  ])("%p binds as %s", async (value, type, text) => {
    await container.ready;
    await using sql = connect();
    expect(await sql`select pg_typeof(${value})::text as type, (${value})::text as text`).toEqual([{ type, text }]);
  });

  test("sql.unsafe() binds a safe integer above 2^51 as int8", async () => {
    await container.ready;
    await using sql = connect();
    expect(await sql.unsafe("select pg_typeof($1)::text as type", [2 ** 53 - 1])).toEqual([{ type: "bigint" }]);
  });

  test("sql(object) stores a safe integer above 2^51 in a text column as digits", async () => {
    await container.ready;
    await using sql = connect();
    await sql`create temp table safe_integer_bind (v text)`;
    await sql`insert into safe_integer_bind ${sql({ v: 2 ** 53 - 1 })}`;
    expect(await sql`select v from safe_integer_bind`).toEqual([{ v: "9007199254740991" }]);
  });
});

if (isDockerEnabled()) {
  describeWithContainer("mysql", { image: "mysql_plain" }, container => {
    const connect = () => new SQL({ url: `mysql://root@${container.host}:${container.port}/bun_sql_test`, max: 1 });

    test.each([
      [2 ** 32 - 1, "4294967295"],
      [2 ** 32, "4294967296"],
      [2 ** 51 - 1, "2251799813685247"],
      [2 ** 51, "2251799813685248"],
      [2 ** 53 - 1, "9007199254740991"],
      [-(2 ** 31), "-2147483648"],
      [-(2 ** 31) - 1, "-2147483649"],
      [-(2 ** 51), "-2251799813685248"],
      [-(2 ** 51) - 1, "-2251799813685249"],
      [-(2 ** 53 - 1), "-9007199254740991"],
      // Not a safe integer, or not an integer: stays a DOUBLE.
      [2 ** 53, "9.007199254740992e15"],
      [-(2 ** 53), "-9.007199254740992e15"],
      [1.5, "1.5"],
      [-0, "-0"],
    ])("%p reaches the server as %s", async (value, text) => {
      await container.ready;
      await using sql = connect();
      expect(await sql`select cast(${value} as char) as text`).toEqual([{ text }]);
    });

    test("sql.unsafe() binds a safe integer above 2^51 as BIGINT", async () => {
      await container.ready;
      await using sql = connect();
      expect(await sql.unsafe("select cast(? as char) as text", [2 ** 53 - 1])).toEqual([{ text: "9007199254740991" }]);
    });

    test("sql(object) stores a safe integer above 2^51 in a VARCHAR column as digits", async () => {
      await container.ready;
      await using sql = connect();
      await sql`create temporary table safe_integer_bind (v varchar(32))`;
      await sql`insert into safe_integer_bind ${sql({ v: 2 ** 53 - 1 })}`;
      expect(await sql`select v from safe_integer_bind`).toEqual([{ v: "9007199254740991" }]);
    });
  });
}
