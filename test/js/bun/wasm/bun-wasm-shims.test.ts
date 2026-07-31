import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// packages/bun-wasm/index.ts can't be imported directly here: it pulls in
// ./schema.js (generated at publish time) and peechy. Instead, lift the
// compiler-rt shim bodies straight from the source and exercise them. They are
// one-line pure functions, so evaluating the captured body is equivalent to
// calling the real shim that gets handed to WebAssembly.instantiate.
const indexPath = join(import.meta.dir, "..", "..", "..", "..", "packages", "bun-wasm", "index.ts");
const source = readFileSync(indexPath, "utf8");

function shim(name: string): (a: number, b: number) => number {
  const re = new RegExp(String.raw`\b${name}\s*\([^)]*\)\s*\{([^}]*)\}`);
  const match = source.match(re);
  if (!match) throw new Error(`could not locate ${name} in ${indexPath}`);
  return new Function("a", "b", match[1]) as (a: number, b: number) => number;
}

describe("bun-wasm compiler-rt shims", () => {
  test("__ashlti3 shifts left", () => {
    const ashl = shim("__ashlti3");
    expect(ashl(1, 4)).toBe(1 << 4);
    expect(ashl(3, 2)).toBe(3 << 2);
    expect(ashl(7, 1)).toBe(7 << 1);
    expect(ashl(5, 0)).toBe(5);
    // regression: the shim used >> instead of <<
    expect(ashl(8, 2)).toBe(32);
    expect(ashl(8, 2)).not.toBe(8 >> 2);
  });

  test("__ashlti3 works as a WebAssembly import", async () => {
    // (module
    //   (import "env" "__ashlti3" (func $ashl (param i32 i32) (result i32)))
    //   (func (export "shl") (param i32 i32) (result i32)
    //     local.get 0 local.get 1 call $ashl))
    // prettier-ignore
    const bytes = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
      0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f,
      0x02, 0x11, 0x01, 0x03, 0x65, 0x6e, 0x76, 0x09, 0x5f, 0x5f, 0x61, 0x73, 0x68, 0x6c, 0x74, 0x69, 0x33, 0x00, 0x00,
      0x03, 0x02, 0x01, 0x00,
      0x07, 0x07, 0x01, 0x03, 0x73, 0x68, 0x6c, 0x00, 0x01,
      0x0a, 0x0a, 0x01, 0x08, 0x00, 0x20, 0x00, 0x20, 0x01, 0x10, 0x00, 0x0b,
    ]);
    const { instance } = await WebAssembly.instantiate(bytes, {
      env: { __ashlti3: shim("__ashlti3") },
    });
    const shl = instance.exports.shl as (a: number, b: number) => number;
    expect(shl(1, 4)).toBe(16);
    expect(shl(3, 2)).toBe(12);
    expect(shl(8, 2)).toBe(32);
  });

  test("__umodti3 and __udivti3 still behave", () => {
    const umod = shim("__umodti3");
    const udiv = shim("__udivti3");
    expect(umod(10, 3)).toBe(10 % 3);
    expect(udiv(10, 2)).toBe(10 / 2);
  });
});
