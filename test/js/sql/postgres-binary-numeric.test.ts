// Postgres' binary NUMERIC wire format is {ndigits, weight, sign, dscale,
// digits[]} where each digit is a base-10000 group. get_str_from_var in
// numeric.c prints the fractional part with two independent counters: a
// base-10000 digit index `d` (++ per group) and a decimal-position counter `i`
// (+= DEC_DIGITS per group). A decoder that collapses both into one index
// walks the leading-zero region 4x too fast and, for weight <= -3, drops
// leading "0000" groups — returning e.g. "0.000010000" for 1e-9.
//
// Runs against a real Postgres server. The default tagged-template path uses
// the extended protocol and requests binary result format for NUMERIC (OID
// 1700, see is_binary_format_supported in src/sql/postgres/types/Tag.rs), so
// Bun's binary NUMERIC decoder is exercised.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

// Each literal is round-tripped through `'<literal>'::numeric`. The server
// parses the text, encodes it as binary NUMERIC on the wire, and Bun's decoder
// must reproduce the exact same string.
const cases: string[] = [
  // --- weight <= -3: previously corrupted --------------------------------
  "0.000000001",
  "0.000000000001",
  "0.00000000123",
  "0.0000000000001",
  "-0.000000001",
  "0.00000000000000012345",
  // --- boundary & previously-correct paths: must remain unchanged --------
  "0.00000001",
  "0.0001",
  "123.456",
  "1000000",
  "0",
  "0.123456789012345",
  "12345678.000000009",
  // --- zero: the server sends ndigits = 0 and keeps the scale in dscale ----
  "0.0000",
  "0.00000000000000000000",
  // --- special values: the server sends the sign word alone -----------------
  "NaN",
  "Infinity",
  "-Infinity",
];

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  test.each(cases)("binary NUMERIC decodes %s", async literal => {
    await container.ready;
    await using sql = new SQL({
      url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
    });
    const [row] = await sql`SELECT ${literal}::numeric AS n`;
    expect(row.n).toBe(literal);
  });

  test("binary NUMERIC decodes a value of 131072 digits", async () => {
    await container.ready;
    await using sql = new SQL({
      url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
    });
    // 32768 digit words. ndigits is an unsigned 16-bit count on the wire, so
    // this value reads as a negative count when it is decoded as signed.
    const nines = Buffer.alloc(131072, "9").toString();
    const runs: { length: number; nines: boolean }[] = [];
    // The first run of a statement gets text, the later runs get binary.
    for (let run = 0; run < 3; run++) {
      const [row] = await sql`SELECT repeat('9', 131072)::numeric AS n`;
      runs.push({ length: row.n.length, nines: row.n === nines });
    }
    expect(runs).toEqual([
      { length: 131072, nines: true },
      { length: 131072, nines: true },
      { length: 131072, nines: true },
    ]);
  });

  test("binary NUMERIC decodes rows fetched from a BINARY cursor", async () => {
    await container.ready;
    await using sql = new SQL({
      url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
    });
    // A simple-protocol FETCH from a BINARY cursor is the one route on which
    // the server picks binary results without a Bind from the client.
    const literals = ["0", "0.0000", "-0.05", "123.456", "1000000", "NaN", "Infinity", "-Infinity"];
    const fetched = await sql.begin(async tx => {
      await tx.unsafe(
        `DECLARE numerics BINARY CURSOR FOR
           SELECT n FROM unnest(ARRAY['${literals.join("','")}']::numeric[]) WITH ORDINALITY AS t(n, i) ORDER BY i`,
      );
      return await tx.unsafe("FETCH ALL FROM numerics");
    });
    expect(fetched.map((row: { n: string }) => row.n)).toEqual(literals);
  });
});
