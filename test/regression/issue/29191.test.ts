// https://github.com/oven-sh/bun/issues/29191

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FFI_D_TS = join(import.meta.dirname, "..", "..", "..", "packages", "bun-types", "ffi.d.ts");

function parseEnum(source: string): Map<string, number> {
  const values = new Map<string, number>();
  const enumMatch = source.match(/enum FFIType \{([\s\S]*?)\n {2}\}/);
  if (!enumMatch) throw new Error("could not find FFIType enum in ffi.d.ts");
  const body = enumMatch[1];
  for (const line of body.split("\n")) {
    const m = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(\d+)\s*,?\s*$/);
    if (m) values.set(m[1], Number(m[2]));
  }
  return values;
}

function extractInterface(source: string, name: string): string {
  const re = new RegExp(`interface ${name} \\{([\\s\\S]*?)\\n {2}\\}`);
  const m = source.match(re);
  if (!m) throw new Error(`could not find interface ${name} in ffi.d.ts`);
  return m[1];
}

function collectComputedKeys(body: string): string[] {
  const keys: string[] = [];
  const re = /\[FFIType\.([a-zA-Z_][a-zA-Z0-9_]*)\]\s*:/g;
  for (const m of body.matchAll(re)) keys.push(m[1]);
  return keys;
}

const source = readFileSync(FFI_D_TS, "utf8");
const enumValues = parseEnum(source);

test("FFIType enum includes known alias pairs (sanity)", () => {
  // Guard against a silently broken parse — `undefined === undefined` via
  // toBe would make every alias pair vacuously pass below.
  expect(enumValues.size).toBeGreaterThan(0);

  // If any of these drift, the duplicate-key test below is no longer
  // meaningful. Both sides must resolve to the same concrete number.
  const pairs: Array<[string, string]> = [
    ["int8_t", "i8"],
    ["uint8_t", "u8"],
    ["int16_t", "i16"],
    ["uint16_t", "u16"],
    ["int32_t", "i32"],
    ["int32_t", "int"],
    ["uint32_t", "u32"],
    ["int64_t", "i64"],
    ["uint64_t", "u64"],
    ["double", "f64"],
    ["float", "f32"],
    ["ptr", "pointer"],
  ];
  for (const [canonical, alias] of pairs) {
    const canonicalValue = enumValues.get(canonical);
    const aliasValue = enumValues.get(alias);
    expect(canonicalValue).toEqual(expect.any(Number));
    expect(aliasValue).toEqual(expect.any(Number));
    expect(canonicalValue).toBe(aliasValue);
  }
});

for (const iface of ["FFITypeToArgsType", "FFITypeToReturnsType"] as const) {
  test(`${iface} has no duplicate computed keys (tsgo compatibility)`, () => {
    const body = extractInterface(source, iface);
    const keys = collectComputedKeys(body);
    expect(keys.length).toBeGreaterThan(0);

    const seen = new Map<number, string>();
    const duplicates: Array<{ first: string; second: string; value: number }> = [];
    for (const member of keys) {
      const value = enumValues.get(member);
      if (value === undefined) {
        throw new Error(`${iface}: [FFIType.${member}] references unknown enum member`);
      }
      const prior = seen.get(value);
      if (prior !== undefined) {
        duplicates.push({ first: prior, second: member, value });
      } else {
        seen.set(value, member);
      }
    }

    expect(duplicates).toEqual([]);
  });
}
