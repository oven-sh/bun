import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

// A JS Date bound to a parameter that Bun sends in Postgres' text format must
// go out as ISO-8601 (`toISOString()`), not as `Date.prototype.toString()`
// output ("Mon May 06 2024 07:08:09 GMT+0000 (Coordinated Universal Time)").
// With the default `prepare: true` the server reports the parameter type before
// Bind is written: `timestamp`/`timestamptz` are then bound in binary and were
// already correct, but `date` (and `text`, domains, ...) are bound as text and
// the server rejected the toString() form with 22007.

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  const options = (extra: Partial<Bun.SQL.PostgresOrMySQLOptions> = {}): Bun.SQL.PostgresOrMySQLOptions => ({
    db: "bun_sql_test",
    username: "bun_sql_test",
    host: container.host,
    port: container.port,
    max: 1,
    ...extra,
  });

  const date = new Date("2024-05-06T07:08:09.123Z");

  test("Date bound to a date parameter", async () => {
    await container.ready;
    await using sql = new SQL(options());
    // First run prepares the statement (Parse/Describe, then Bind with the
    // described types); the second run binds against the cached statement.
    for (let i = 0; i < 2; i++) {
      const [row] = await sql`SELECT ${date}::date AS d, (${date}::date)::text AS t`;
      expect(row).toEqual({ d: new Date("2024-05-06T00:00:00.000Z"), t: "2024-05-06" });
    }
  });

  test("Date inserted into a date column through every parameter path", async () => {
    await container.ready;
    await using sql = new SQL(options());
    await sql`CREATE TEMP TABLE date_param (id int, d date)`;
    await sql`INSERT INTO date_param (id, d) VALUES (1, ${date})`;
    await sql`INSERT INTO date_param ${sql({ id: 2, d: date })}`;
    await sql.unsafe(`INSERT INTO date_param (id, d) VALUES (3, $1)`, [date]);
    expect(await sql`SELECT id, d::text AS d FROM date_param ORDER BY id`).toEqual([
      { id: 1, d: "2024-05-06" },
      { id: 2, d: "2024-05-06" },
      { id: 3, d: "2024-05-06" },
    ]);
  });

  test("the calendar date is taken in UTC, whatever the session time zone", async () => {
    await container.ready;
    await using sql = new SQL(options());
    await sql`SET TIME ZONE 'Pacific/Kiritimati'`; // UTC+14
    const late = new Date("2024-05-06T23:30:00.000Z");
    const [row] = await sql`SELECT (${late}::date)::text AS d`;
    expect(row.d).toBe("2024-05-06");
    // and a decoded date column value round-trips to the same day
    const [{ decoded }] = await sql`SELECT '2024-02-29'::date AS decoded`;
    const [{ again }] = await sql`SELECT (${decoded}::date)::text AS again`;
    expect(again).toBe("2024-02-29");
  });

  test("Date bound to a text parameter is its ISO string", async () => {
    await container.ready;
    await using sql = new SQL(options());
    const [row] = await sql`SELECT ${date}::text AS t`;
    expect(row.t).toBe("2024-05-06T07:08:09.123Z");
  });

  test("an invalid Date is left for the server to reject", async () => {
    await container.ready;
    await using sql = new SQL(options());
    const err = await sql`SELECT ${new Date(NaN)}::date AS d`.catch(e => e);
    expect(err).toBeInstanceOf(SQL.PostgresError);
    expect(err.errno).toBe("22007");
    expect(err.message).toBe('invalid input syntax for type date: "Invalid Date"');
  });

  test("timestamptz and timestamp parameters are unaffected", async () => {
    await container.ready;
    await using sql = new SQL(options());
    const [row] =
      await sql`SELECT ${date}::timestamptz AS tz, ${date}::timestamp AS ts, ${"2024-05-06 07:08:09.123+00"}::timestamptz AS s`;
    expect(row).toEqual({ tz: date, ts: date, s: date });
  });

  test("prepare: false binds a Date the same way", async () => {
    await container.ready;
    await using sql = new SQL(options({ prepare: false }));
    const [row] = await sql`SELECT (${date}::date)::text AS d, ${date}::timestamptz AS tz, ${date}::text AS t`;
    expect(row).toEqual({ d: "2024-05-06", tz: date, t: "2024-05-06T07:08:09.123Z" });
  });
});
