// A JS number bound as a tagged-template parameter must round-trip exactly into
// a NUMERIC column. Bun previously declared the parameter as float8 (OID 701)
// in Parse and sent the 8 binary IEEE-754 bytes; PostgreSQL then cast
// float8 -> numeric using DBL_DIG (15 significant digits), so any value wider
// than that was silently rounded. postgres.js / node-pg send numbers as text
// with OID 0 and are exact for the same values.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

// Each value is an exact JS double whose decimal form is >= 16 significant
// digits (or otherwise sensitive to the float8 -> numeric cast), so a lossy
// float8 round-trip would change it.
const cases: Array<[number, string]> = [
  // 2^52: an exact JS integer, but outside JSC's int52 range so it was sent as
  // float8 and rounded to 4503599627370500.
  [4503599627370496, "4503599627370496"],
  // 2^53.
  [9007199254740992, "9007199254740992"],
  // 0.1 + 0.2: the canonical 17-digit double; float8 -> numeric gave 0.3.
  [0.1 + 0.2, "0.30000000000000004"],
  // 16 significant digits spanning the decimal point.
  [12345.678901234567, "12345.678901234567"],
  // A large safe integer below 2^51 (goes via int8, must stay exact).
  [2251799813685247, "2251799813685247"],
];

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  test("JS number bound into NUMERIC round-trips exactly", async () => {
    await container.ready;
    await using sql = new SQL({
      url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
    });
    await sql`create temp table nprec (n numeric, f float8, t text)`;

    for (const [v, want] of cases) {
      await sql`insert into nprec values (${v}, ${v}, ${v})`;
    }
    const rows = await sql`select n::text as n, f, t from nprec`;

    expect(
      rows.map((r: { n: string; f: number; t: string }) => ({
        n: r.n,
        f: r.f,
        t: r.t,
      })),
    ).toEqual(
      cases.map(([v, want]) => ({
        // NUMERIC stores the exact decimal the client sent.
        n: want,
        // float8 stores the same double bit-for-bit.
        f: v,
        // TEXT stores the JS decimal string, not PG's float8 rendering
        // (which would be "4.503599627370496e+15" / "1e-07").
        t: want,
      })),
    );
  });

  test("JS number bound into NUMERIC round-trips exactly (prepare: false)", async () => {
    await container.ready;
    await using sql = new SQL({
      url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
      prepare: false,
    });
    await sql`create temp table nprec_u (n numeric)`;
    const [v, want] = cases[0];
    await sql`insert into nprec_u values (${v})`;
    const [{ n }] = await sql`select n::text as n from nprec_u`;
    expect(n).toBe(want);
  });

  test("untyped number parameter is sent as its JS decimal string", async () => {
    // With OID 0 and no target-column context, PG resolves $1 to text, so the
    // result is the string form. Cast to float8 to get a number back.
    await container.ready;
    await using sql = new SQL({
      url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
    });
    const [{ x, y }] = await sql`select ${1.123456789} as x, ${1.123456789}::float8 as y`;
    expect(x).toBe("1.123456789");
    expect(y).toBe(1.123456789);
  });
});
