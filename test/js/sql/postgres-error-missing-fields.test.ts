// Postgres omits the column (and sometimes the line) field for many errors.
// Error instances carry JSC's own `line`/`column` source-position properties,
// which must not show through as PostgresError fields.
// https://github.com/oven-sh/bun/issues/45064

import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  const connect = () =>
    new SQL({
      url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
    });

  test("column is undefined when the server sends none, and the server's name when it does", async () => {
    await container.ready;
    await using sql = connect();
    await sql`create temp table people (id int primary key, email text not null)`;
    await sql`insert into people values (1, 'a@example.com')`;
    const unique: any = await sql`insert into people values (1, 'b@example.com')`.then(
      () => null,
      e => e,
    );
    const notNull: any = await sql`insert into people values (2, null)`.then(
      () => null,
      e => e,
    );

    expect(unique).toBeInstanceOf(SQL.PostgresError);
    expect({
      errno: unique.errno,
      constraint: unique.constraint,
      column: unique.column,
      hasColumn: "column" in unique,
    }).toEqual({ errno: "23505", constraint: "people_pkey", column: undefined, hasColumn: false });
    expect(typeof unique.line).toBe("string");

    expect(notNull).toBeInstanceOf(SQL.PostgresError);
    expect({ errno: notNull.errno, column: notNull.column }).toEqual({ errno: "23502", column: "email" });
  });
});
