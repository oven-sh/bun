// A float4 value must decode to the same JS number regardless of protocol.
// The simple protocol returns the result as text; the extended protocol (used
// when the query carries a parameter) requests binary for float4 (OID 700, see
// is_binary_format_supported in src/sql/postgres/types/Tag.rs). The binary arm
// reads the real 4-byte IEEE f32 and widens it, so the text arm must narrow the
// parsed decimal to f32 first (Math.fround) instead of keeping full f64
// precision. Otherwise 0.1::float4 is 0.1 unparameterized but
// 0.10000000149011612 parameterized.

import { SQL } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer } from "harness";

const cases: string[] = [
  "0.1",
  "(1.0/3.0)",
  "1.5",
  "3.14159",
  "1e-40", // subnormal f32
  "1e20",
  "-0.1",
  "0",
];

describeWithContainer("postgres", { image: "postgres_plain" }, container => {
  test.each(cases)("float4 %s decodes identically on both protocols", async literal => {
    await container.ready;
    await using sql = new SQL({
      url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
    });

    // simple protocol -> TEXT result
    const text = (await sql.unsafe(`select ${literal}::float4 as v`))[0].v;
    // extended protocol -> BINARY result
    const binary = (await sql.unsafe(`select ${literal}::float4 as v where $1 = 1`, [1]))[0].v;

    expect(text).toBe(binary);
    // the value both paths agree on is the f32-rounded one
    expect(text).toBe(Math.fround(Number(eval(literal))));
  });

  test("float4[] decodes identically on both protocols", async () => {
    await container.ready;
    await using sql = new SQL({
      url: `postgres://bun_sql_test@${container.host}:${container.port}/bun_sql_test`,
      max: 1,
    });

    const text = (await sql.unsafe(`select '{0.1, 0.3333333, 1.5}'::float4[] as v`))[0].v;
    const binary = (await sql.unsafe(`select '{0.1, 0.3333333, 1.5}'::float4[] as v where $1 = 1`, [1]))[0].v;

    expect(Array.from(text)).toEqual(Array.from(binary));
    expect(Array.from(text)).toEqual([0.1, 0.3333333, 1.5].map(Math.fround));
  });
});
