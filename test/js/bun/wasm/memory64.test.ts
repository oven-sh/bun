import { expect, test } from "bun:test";

// Memory64 module (issue #35706). Equivalent .wat:
//
//   (module
//     (memory (export "mem") i64 1)
//     (func (export "storeLoad") (param $addr i64) (param $val i32) (result i32)
//       local.get $addr
//       local.get $val
//       i32.store
//       local.get $addr
//       i32.load)
//     (func (export "size") (result i64)
//       memory.size))
const memory64Wasm = Uint8Array.fromBase64(
  "AGFzbQEAAAABCwJgAn5/AX9gAAF+AwMCAAEFAwEEAQcaAwNtZW0CAAlzdG9yZUxvYWQAAARzaXplAAEKFQIOACAAIAE2AgAgACgCAAsEAD8ACw==",
);

test("memory64 module validates", () => {
  expect(WebAssembly.validate(memory64Wasm)).toBe(true);
});

test("memory64 module instantiates and uses i64 addresses", async () => {
  const { instance } = await WebAssembly.instantiate(memory64Wasm, {});
  const mem = instance.exports.mem as WebAssembly.Memory;
  const storeLoad = instance.exports.storeLoad as (addr: bigint, val: number) => number;
  const size = instance.exports.size as () => bigint;

  expect(mem.buffer.byteLength).toBe(65536);
  expect(size()).toBe(1n);
  expect(storeLoad(0n, 42)).toBe(42);
  expect(storeLoad(65532n, 1234)).toBe(1234);

  // Out-of-bounds i64 address traps instead of wrapping.
  expect(() => storeLoad(65536n, 1)).toThrow(WebAssembly.RuntimeError);
  expect(() => storeLoad(2n ** 33n, 1)).toThrow(WebAssembly.RuntimeError);

  // Growing an i64-addressed memory takes BigInt page counts.
  expect(mem.grow(1n)).toBe(1n);
  expect(mem.buffer.byteLength).toBe(131072);
  expect(size()).toBe(2n);
  expect(storeLoad(131068n, 7)).toBe(7);
});
