// Bun declares OID 0 for a parameter whose Postgres type it cannot infer from
// the JS value (a Date, an array, any other object), and the server then types
// it after the target column. When that type was one Bun binds in binary
// format, write_bind pushed the JS value through ToInt32 / ToNumber / raw
// string bytes and stored the result: a Date in an int4 column became its
// epoch-ms modulo 2^32, `{}` became 0, `[1, 2]` in a float8 column became NaN,
// and an object whose toString() is 4 bytes long landed in a real column as
// those bytes reinterpreted as a float. A value with no binary encoding for the
// server's type must go as text instead, so the server parses or rejects its
// string form. That is what an int2 / int8 / text column already did.
import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  async function connect() {
    await container.ready;
    const sql = new SQL({
      url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
    });
    await sql`create temp table t (i int4, i8 int8, f float8, n numeric, r real, tm time)`;
    return sql;
  }

  // Inserts `value` into `column` and returns what the server stored, as text,
  // or the SQLSTATE of the error the server rejected it with.
  async function stored(sql: SQL, column: string, value: unknown): Promise<string> {
    try {
      const [row] = await sql`insert into t (${sql(column)}) values (${value}) returning ${sql(column)}::text as v`;
      return row.v;
    } catch (e) {
      if (e instanceof SQL.PostgresError) return `error ${e.errno}`;
      throw e;
    }
  }

  const notNumbers: [string, unknown][] = [
    ["a Date", new Date("2024-05-06T07:08:09.123Z")],
    ["an invalid Date", new Date(NaN)],
    ["an object with valueOf()", { valueOf: () => 2 ** 31 + 5 }],
    ["a plain object", { a: 1 }],
    ["an array", [1, 2]],
    ["an empty array", []],
    ["a function", () => 1],
    ["an Int32Array", new Int32Array([7, 8])],
  ];

  test.each(notNumbers)(
    "%s bound to an int4 / float8 column is parsed by the server, not coerced",
    async (_, value) => {
      await using sql = await connect();
      // 22P02 invalid_text_representation: the server got String(value) and
      // rejected it. The int8 column (always text format) is the reference, and
      // all three run on the one pooled connection, which the rejections leave
      // usable.
      expect(await stored(sql, "i8", value)).toBe("error 22P02");
      expect(await stored(sql, "i", value)).toBe("error 22P02");
      expect(await stored(sql, "f", value)).toBe("error 22P02");
      expect(await stored(sql, "i", 7)).toBe("7");
    },
  );

  test("numbers still bind to int4 and float8 columns in binary format", async () => {
    await using sql = await connect();
    expect(await stored(sql, "i", 0)).toBe("0");
    expect(await stored(sql, "i", -0)).toBe("0");
    expect(await stored(sql, "i", 2147483647)).toBe("2147483647");
    expect(await stored(sql, "i", -2147483648)).toBe("-2147483648");
    // Out of int4 range: Bun declares int8 and the server's cast rejects it.
    expect(await stored(sql, "i", 2 ** 31 + 5)).toBe("error 22003");
    expect(await stored(sql, "f", 1.5)).toBe("1.5");
    expect(await stored(sql, "f", -0)).toBe("-0");
    expect(await stored(sql, "f", 2 ** 31 + 5)).toBe("2147483653");
    expect(await stored(sql, "f", NaN)).toBe("NaN");
    expect(await stored(sql, "f", Infinity)).toBe("Infinity");
    expect(await stored(sql, "f", -Infinity)).toBe("-Infinity");
    expect(await stored(sql, "i", null)).toBeNull();
    expect(await stored(sql, "f", undefined)).toBeNull();
  });

  // numeric, real (float4) and time request binary results, but Bun has no
  // binary parameter encoder for them. The Bind used to flag such a parameter
  // as binary and then write String(value) as the payload.
  test("an object bound to a numeric / real / time column is sent as its string form", async () => {
    await using sql = await connect();
    class Decimal {
      constructor(private digits: string) {}
      toString() {
        return this.digits;
      }
    }
    expect(await stored(sql, "n", new Decimal("1.25"))).toBe("1.25");
    expect(await stored(sql, "r", new Decimal("1.25"))).toBe("1.25");
    expect(await stored(sql, "n", new Decimal("12345678901234567890.000000001"))).toBe(
      "12345678901234567890.000000001",
    );
    expect(await stored(sql, "tm", { toString: () => "12:34:56" })).toBe("12:34:56");
    expect(await stored(sql, "n", { a: 1 })).toBe("error 22P02");
  });
});
