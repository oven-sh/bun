import { expect, test } from "bun:test";

// (module (import "m" "f" (func $f)) (func (export "g") (result i32) (try (result i32) (do (call $f) (i32.const 0)) (catch_all (i32.const 1)))))
// prettier-ignore
const catchAll = new Uint8Array([
  0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 1, 8, 2, 0x60, 0, 0, 0x60, 0, 1, 0x7f, 2, 7, 1, 1, 0x6d, 1, 0x66, 0, 0, 3, 2, 1, 1, 7, 5, 1, 1, 0x67, 0, 1,
  10, 14, 1, 12, 0, 6, 0x7f, 0x10, 0, 0x41, 0, 0x19, 0x41, 1, 0x0b, 0x0b,
]);
// The same with (import "m" "t" (tag $t (param externref))) and (catch $t (drop) (i32.const 2)).
// prettier-ignore
const catchTag = new Uint8Array([
  0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 1, 12, 3, 0x60, 0, 0, 0x60, 0, 1, 0x7f, 0x60, 1, 0x6f, 0, 2, 14, 2, 1, 0x6d, 1, 0x66, 0, 0, 1, 0x6d, 1, 0x74, 4, 0, 2,
  3, 2, 1, 1, 7, 5, 1, 1, 0x67, 0, 1, 10, 16, 1, 14, 0, 6, 0x7f, 0x10, 0, 0x41, 0, 0x07, 0, 0x1a, 0x41, 2, 0x0b, 0x0b,
]);

function deep(n: number): number {
  if (n) return deep(n - 1) + 1;
  throw new RangeError("deep");
}

test("WebAssembly catches what JavaScript throws", () => {
  let mode = 0;
  const f = () => {
    if (mode === 1) throw new Error("x");
    if (mode === 2) throw 42;
    if (mode === 3) deep(5);
  };
  const all = new WebAssembly.Instance(new WebAssembly.Module(catchAll), { m: { f } }).exports.g as () => number;
  // @ts-expect-error
  const t = WebAssembly.JSTag;
  const tag = new WebAssembly.Instance(new WebAssembly.Module(catchTag), { m: { f, t } }).exports.g as () => number;
  for (let i = 0; i < 2000; i++) {
    const results: number[] = [];
    for (mode = 0; mode < 4; mode++) results.push(all(), tag());
    expect(results).toEqual([0, 0, 1, 2, 1, 2, 1, 2]);
  }
});
