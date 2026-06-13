import { SQL } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { describeWithContainer, isDockerEnabled } from "harness";

// Postgres' binary NUMERIC wire format is {ndigits, weight, sign, dscale,
// digits[]} where each digit is a base-10000 group. get_str_from_var in
// numeric.c prints the fractional part with two independent counters: a
// base-10000 digit index `d` (++ per group) and a decimal-position counter `i`
// (+= DEC_DIGITS per group). A decoder that collapses both into one index
// walks the leading-zero region 4x too fast and, for weight <= -3, drops
// leading "0000" groups — returning e.g. "0.000010000" for 1e-9.
//
// A plain tagged-template query (`sql`select …::numeric``) uses the extended
// protocol, so Bun requests the result column in binary (format=1) and decodes
// it with the binary NUMERIC decoder — the path that had the bug. `.simple()`
// forces the simple 'Q' protocol, which always returns text and was always
// correct; checking it alongside pins the binary result to Postgres' own
// canonical text. Both run against the real postgres_plain docker service.

// Values a real Postgres server round-trips through `::numeric` unchanged. The
// first group (weight <= -3, i.e. < 1e-8 with no integer part) is what the
// binary decoder previously corrupted; the rest cover the boundary and the
// paths that were always correct and must stay that way.
const literals = [
  // --- weight <= -3: previously corrupted -------------------------------
  "0.000000001",
  "0.000000000001",
  "0.00000000123",
  "0.0000000000001",
  "-0.000000001",
  "0.00000000000000012345",
  // --- boundary & previously-correct paths: must remain unchanged -------
  "0.00000001",
  "0.0001",
  "123.456",
  "1000000",
  "0",
  "0.123456789012345",
  "12345678.000000009",
];

if (isDockerEnabled()) {
  describeWithContainer("postgres binary NUMERIC sub-1e-8 decoding", { image: "postgres_plain" }, container => {
    let sql: SQL;

    beforeAll(async () => {
      await container.ready;
      sql = new SQL({
        url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
        max: 1,
      });
    });

    afterAll(async () => {
      await sql.close();
    });

    test.each(literals)("decodes %s losslessly (binary vs text)", async literal => {
      // Extended protocol → binary NUMERIC decoder (the path that was broken).
      const [binary] = await sql`select ${literal}::numeric as n`;
      // Simple protocol → text. `.simple()` can't take bind params, so the
      // literal is inlined; it's a trusted numeric constant. This is Postgres'
      // own canonical rendering, which the binary result must match exactly.
      const [text] = await sql`select ${sql.unsafe(literal)}::numeric as n`.simple();

      expect(text.n).toBe(literal);
      expect(binary.n).toBe(literal);
    });
  });
}
