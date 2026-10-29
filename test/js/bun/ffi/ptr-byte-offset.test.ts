import { ptr } from "bun:ffi";
import { expect, test } from "bun:test";

test("ptr() takes a byteOffset of undefined or null for none", () => {
  const view = new Uint8Array(8);
  const address = ptr(view);
  for (const none of [undefined, null] as any[]) {
    expect(ptr(view, none)).toBe(address);
    expect(Bun.FFI.ptr(view, none)).toBe(address);
  }
  expect(ptr(view, 3)).toBe(address + 3);
  expect(Bun.FFI.ptr(view, 3)).toBe(address + 3);
});
