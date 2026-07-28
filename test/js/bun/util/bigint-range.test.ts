import { CFunction, CString, ptr, read, toArrayBuffer } from "bun:ffi";
import { expect, test } from "bun:test";

test("bun:ffi read.* and toArrayBuffer accept a BigInt pointer", () => {
  const buf = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const address = BigInt(ptr(buf));
  expect(read.u8(address, 0)).toBe(1);
  expect(read.u8(address, 3)).toBe(4);
  expect(new Uint8Array(toArrayBuffer(address, 0, 8))).toEqual(buf);
});

test("bun:ffi rejects negative BigInt pointers instead of wrapping to usize::MAX", () => {
  expect(() => read.u8(-1n as unknown as number, 0)).toThrow("Expected a pointer");
  expect(() => new CString(-1n)).toThrow(/out of range/);
  expect(() => CString(-1n)).toThrow(/out of range/);
  expect(() => CFunction({ ptr: -1n as unknown as number, args: [], returns: "void" })).toThrow(/out of range/);
});
