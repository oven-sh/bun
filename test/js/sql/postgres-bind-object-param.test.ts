// The Bind format of a query parameter. Bun sends a parameter in binary only
// when it has a binary encoder for the server's type and the JS value fits that
// encoder: a number for int4 and float8, a boolean for bool, a Date for
// timestamp and timestamptz, a BufferSource for bytea. Anything else (a plain
// object, an array, a Date bound to int4, a Temporal.Instant bound to
// timestamptz, any value bound to numeric, real, time or an array type) is
// sent as String(value) in text format and the server parses or rejects it,
// the same as with `prepare: false`.
//
// Before, the format came from the server's type alone. An object bound to
// int4 was stored as 0, to float8 as NaN, to bool as true, to timestamptz as
// 2000-01-01 00:00:00, with no error. numeric, real, time, int4[] and float4[]
// were declared binary but written as text, so the server read garbage
// (`{ toString: () => "1234" }` into real stored 2.59e-9) or failed with 08P01.

import { SQL } from "bun";
import { afterAll, expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  const clients: Record<string, SQL> = {};
  const connect = async (prepare: boolean) => {
    await container.ready;
    return (clients[String(prepare)] ??= new SQL({
      url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
      prepare,
    }));
  };
  afterAll(() => Promise.all(Object.values(clients).map(sql => sql.close())));

  const text = (s: string) => ({ toString: () => s });

  // [type, label, value, SQLSTATE of the server's text parser]
  const rejected: [string, string, unknown, string][] = [
    ["int4", "a plain object", { a: 1 }, "22P02"],
    ["int4", "an array", [1, 2], "22P02"],
    ["int4", "a Date", new Date(0), "22P02"],
    ["int4", "an Int32Array", new Int32Array([1, 2]), "22P02"],
    ["int4", "an object whose toString() is not an integer", text("19.5"), "22P02"],
    ["float8", "a plain object", { a: 1 }, "22P02"],
    ["float8", "an array", [1, 2], "22P02"],
    ["float8", "a Date", new Date(0), "22P02"],
    ["bool", "a plain object", { a: 1 }, "22P02"],
    ["bool", "an array", [1, 2], "22P02"],
    ["bool", "a Date", new Date(0), "22P02"],
    ["timestamptz", "a plain object", { a: 1 }, "22007"],
    ["timestamptz", "an array", [1, 2], "22007"],
    ["timestamp", "a plain object", { a: 1 }, "22007"],
    ["numeric", "a plain object", { a: 1 }, "22P02"],
    ["numeric", "a Date", new Date(0), "22P02"],
    ["real", "an array", [1, 2], "22P02"],
    ["time", "a plain object", { a: 1 }, "22007"],
    ["int4[]", "a plain object", { a: 1 }, "22P02"],
  ];

  for (const prepare of [true, false]) {
    test.each(rejected)(`%s parameter rejects %s (prepare: ${prepare})`, async (type, _, value, sqlstate) => {
      const sql = await connect(prepare);
      const err: any = await sql.unsafe(`select $1::${type} as x`, [value]).then(
        rows => rows[0],
        e => e,
      );
      expect(err).toBeInstanceOf(SQL.PostgresError);
      expect({ code: err.code, errno: err.errno }).toEqual({ code: "ERR_POSTGRES_SERVER_ERROR", errno: sqlstate });
    });

    test(`the server parses the text form of an object with a toString() (prepare: ${prepare})`, async () => {
      const sql = await connect(prepare);
      const [row] = await sql`select
        ${text("42")}::int4 as i,
        ${text("19.5")}::float8 as f,
        ${text("f")}::bool as b,
        ${text("2024-01-02 03:04:05+00")}::timestamptz as t,
        ${text("19.99")}::numeric as n,
        ${text("1234")}::real as r,
        ${text("12:34:56")}::time as tm,
        ${text("{1,2}")}::int4[] as ia,
        ${text("{1.5,2}")}::real[] as ra`;
      // A binary int4[] / real[] result decodes to a typed array, a text one
      // (first run with prepare: false) to a plain array.
      expect({ ...row, ia: Array.from(row.ia), ra: Array.from(row.ra) }).toEqual({
        i: 42,
        f: 19.5,
        b: false,
        t: new Date("2024-01-02T03:04:05Z"),
        n: "19.99",
        r: 1234,
        tm: "12:34:56",
        ia: [1, 2],
        ra: [1.5, 2],
      });
    });
  }

  test("an insert of such a value stores nothing", async () => {
    const sql = await connect(true);
    await sql`create temp table bind_object_param (i int4, f float8, b bool, t timestamptz, r real)`;
    const value = { a: 1 };
    const errno = (query: Promise<unknown>) => query.catch((e: any) => e.errno);
    const errnos = [
      await errno(sql`insert into bind_object_param (i) values (${value})`),
      await errno(sql`insert into bind_object_param (f) values (${value})`),
      await errno(sql`insert into bind_object_param (b) values (${value})`),
      await errno(sql`insert into bind_object_param (t) values (${value})`),
      await errno(sql`insert into bind_object_param (r) values (${text("1234")}) returning r`),
    ];
    expect(errnos).toEqual(["22P02", "22P02", "22P02", "22007", [{ r: 1234 }]]);
    const [{ count }] = await sql`select count(*)::int4 as count from bind_object_param`;
    expect(count).toBe(1);
  });

  test("a Temporal.Instant bound to timestamptz round-trips", async () => {
    const sql = await connect(true);
    const instant = Temporal.Instant.from("2024-01-02T03:04:05.678Z");
    const [row] = await sql`select ${instant}::timestamptz as t`;
    expect(row.t).toEqual(new Date("2024-01-02T03:04:05.678Z"));
  });

  test("sql.array() through the sql(object) helper reaches an array column", async () => {
    const sql = await connect(true);
    await sql`create temp table bind_array_param (ia int4[], ra real[])`;
    const [row] = await sql`
      insert into bind_array_param ${sql({ ia: sql.array([1, 2], "INT4"), ra: sql.array([1.5, 2.5], "REAL") })}
      returning ia::text, ra::text`;
    expect(row).toEqual({ ia: "{1,2}", ra: "{1.5,2.5}" });
  });

  test("numbers, booleans, Dates, BufferSources, strings and null bind as before", async () => {
    const sql = await connect(true);
    const [row] = await sql`select
      ${7}::int4 as i,
      ${-2147483648}::int4 as imin,
      ${1.5}::float8 as f,
      ${true}::bool as b,
      ${new Date("2024-01-02T03:04:05.678Z")}::timestamptz as t,
      encode(${new Uint8Array([1, 2, 3])}::bytea, 'hex') as h,
      ${"8"}::int4 as si,
      ${"2.25"}::float8 as sf,
      ${"t"}::bool as sb,
      ${null}::int4 as n`;
    expect(row).toEqual({
      i: 7,
      imin: -2147483648,
      f: 1.5,
      b: true,
      t: new Date("2024-01-02T03:04:05.678Z"),
      h: "010203",
      si: 8,
      sf: 2.25,
      sb: true,
      n: null,
    });
  });
});
