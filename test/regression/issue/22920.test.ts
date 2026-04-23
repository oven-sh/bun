import { CString, ptr } from "bun:ffi";
import { expect, test } from "bun:test";

test("CString byteLength and byteOffset are defined when constructed with only a pointer", () => {
  const buffer = Buffer.from("Hello world!\0");
  const bufferPtr = ptr(buffer);
  const cString = new CString(bufferPtr);

  expect(cString.byteOffset).toBe(0);
  expect(cString.byteLength).toBe(12);
  expect(cString.toString()).toBe("Hello world!");
});

test("CString byteOffset defaults to 0 when only ptr and byteLength are provided", () => {
  const buffer = Buffer.from("Hello world!\0");
  const bufferPtr = ptr(buffer);
  const cString = new CString(bufferPtr, 0, 12);

  expect(cString.byteOffset).toBe(0);
  expect(cString.byteLength).toBe(12);
  expect(cString.toString()).toBe("Hello world!");
});

test("CString with byteOffset", () => {
  const buffer = Buffer.from("Hello world!\0");
  const bufferPtr = ptr(buffer);
  const cString = new CString(bufferPtr, 6);

  expect(cString.byteOffset).toBe(6);
  expect(cString.byteLength).toBe(6);
  expect(cString.toString()).toBe("world!");
});

test("CString with byteOffset and byteLength", () => {
  const buffer = Buffer.from("Hello world!\0");
  const bufferPtr = ptr(buffer);
  const cString = new CString(bufferPtr, 6, 5);

  expect(cString.byteOffset).toBe(6);
  expect(cString.byteLength).toBe(5);
  expect(cString.toString()).toBe("world");
});

test("CString with null pointer has byteLength 0 and byteOffset 0", () => {
  const cString = new CString(0);

  expect(cString.byteOffset).toBe(0);
  expect(cString.byteLength).toBe(0);
  expect(cString.toString()).toBe("");
});

test("CString byteLength is correct for multi-byte UTF-8 strings", () => {
  // "café" in UTF-8 is 5 bytes (c=1, a=1, f=1, é=2)
  const buffer = Buffer.from("café\0");
  const bufferPtr = ptr(buffer);
  const cString = new CString(bufferPtr);

  expect(cString.byteOffset).toBe(0);
  expect(cString.byteLength).toBe(5);
  expect(cString.toString()).toBe("café");
});
