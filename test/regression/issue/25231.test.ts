// https://github.com/oven-sh/bun/issues/25231
// Bun.FFI.CString should be callable as a constructor (new CString(ptr))

import { expect, test } from "bun:test";

test("Bun.FFI.CString is callable with new", () => {
  const { CString, ptr } = Bun.FFI;

  // Create a buffer with a null-terminated string
  const buf = Buffer.from("hello\0");
  const ptrValue = ptr(buf);

  // CString should be callable with new
  const result = new CString(ptrValue, 0, 5);

  // The result should be the string "hello"
  expect(String(result)).toBe("hello");
});

test("Bun.FFI.CString can be called without new", () => {
  const { CString, ptr } = Bun.FFI;

  // Create a buffer with a null-terminated string
  const buf = Buffer.from("hello\0");
  const ptrValue = ptr(buf);

  // CString should also be callable without new
  const result = CString(ptrValue, 0, 5);

  // The result should be the string "hello"
  expect(result).toBe("hello");
});
