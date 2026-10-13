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
  // --- the first integer word prints 1 to 4 digits, a later word prints 4 --
  "9",
  "10",
  "99",
  "100",
  "999",
  "1000",
  "9990001",
  "-10000001",
  "50000",
  "900000000.00",
  // --- 256 is the word 0x0100: one zero byte does not make a zero word ------
  "256",
  // --- the fraction ends inside a word --------------------------------------
  "1.00020",
  "-42.00",
  "-0.12345",
  "-0.0001",
  "-0.001",
  "-0.01",
  "-0.00001",
  // --- 64 characters, then 65: the decoder prints up to 64 on the stack -----
  "5." + Buffer.alloc(62, "0").toString(),
  "5." + Buffer.alloc(63, "0").toString(),
  "-5." + Buffer.alloc(61, "0").toString(),
  "-5." + Buffer.alloc(62, "0").toString(),
  "0." + Buffer.alloc(62, "0").toString(),
  "0." + Buffer.alloc(63, "0").toString(),
  // --- special values: the server sends the sign word alone -----------------
  "NaN",
  "Infinity",
  "-Infinity",
];

// Values at the limits of the type: 131072 digits before the decimal point,
// 16383 after it.
const longCases: [name: string, literal: string][] = [
  ["5 and 131068 zeros", "5" + Buffer.alloc(131068, "0").toString()],
  ["a zero with 16383 decimal places", "0." + Buffer.alloc(16383, "0").toString()],
  ["minus 131068 nines and .9999", "-" + Buffer.alloc(131068, "9").toString() + ".9999"],
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

  test.each(longCases)("binary NUMERIC decodes %s", async (_, literal) => {
    await container.ready;
    await using sql = new SQL({
      url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
    });
    const [row] = await sql`SELECT ${literal}::numeric AS n`;
    expect({ length: row.n.length, same: row.n === literal }).toEqual({ length: literal.length, same: true });
  });

  // A value of 131072 digits has 32768 digit words. The count is an unsigned
  // 16-bit field on the wire (numeric_recv), and 32768 is negative as int16.
  test("binary NUMERIC decodes a value of 131072 digits", async () => {
    await container.ready;
    await using sql = new SQL({
      url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
    });
    const nines = Buffer.alloc(131072, "9").toString();
    const runs: { length: number; same: boolean }[] = [];
    // The first run of a statement gets text, the later runs get binary.
    for (let run = 0; run < 3; run++) {
      const [integer] = await sql`SELECT repeat('9', 131072)::numeric AS n`;
      const [fraction] = await sql`SELECT (repeat('9', 131072) || '.12345678')::numeric AS n`;
      runs.push(
        { length: integer.n.length, same: integer.n === nines },
        { length: fraction.n.length, same: fraction.n === nines + ".12345678" },
      );
    }
    expect(runs).toEqual([
      { length: 131072, same: true },
      { length: 131081, same: true },
      { length: 131072, same: true },
      { length: 131081, same: true },
      { length: 131072, same: true },
      { length: 131081, same: true },
    ]);
  });
});
