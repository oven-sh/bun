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
  // If any of these drift, the test below is no longer meaningful.
  expect(enumValues.get("int8_t")).toBe(enumValues.get("i8"));
  expect(enumValues.get("uint8_t")).toBe(enumValues.get("u8"));
  expect(enumValues.get("int16_t")).toBe(enumValues.get("i16"));
  expect(enumValues.get("uint16_t")).toBe(enumValues.get("u16"));
  expect(enumValues.get("int32_t")).toBe(enumValues.get("i32"));
  expect(enumValues.get("int32_t")).toBe(enumValues.get("int"));
  expect(enumValues.get("uint32_t")).toBe(enumValues.get("u32"));
  expect(enumValues.get("int64_t")).toBe(enumValues.get("i64"));
  expect(enumValues.get("uint64_t")).toBe(enumValues.get("u64"));
  expect(enumValues.get("double")).toBe(enumValues.get("f64"));
  expect(enumValues.get("float")).toBe(enumValues.get("f32"));
  expect(enumValues.get("ptr")).toBe(enumValues.get("pointer"));
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
