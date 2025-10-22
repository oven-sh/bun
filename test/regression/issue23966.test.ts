// https://github.com/oven-sh/bun/issues/23966
// Buffer.isEncoding() behaves differently in Bun compared to Node.js
import { expect, test } from "bun:test";
import { Buffer } from "node:buffer";

test("Buffer.isEncoding('') should return false", () => {
  expect(Buffer.isEncoding("")).toBe(false);
});

test("Buffer.isEncoding() should match Node.js behavior", () => {
  // Valid encodings should return true
  expect(Buffer.isEncoding("utf8")).toBe(true);
  expect(Buffer.isEncoding("utf-8")).toBe(true);
  expect(Buffer.isEncoding("hex")).toBe(true);
  expect(Buffer.isEncoding("base64")).toBe(true);
  expect(Buffer.isEncoding("ascii")).toBe(true);
  expect(Buffer.isEncoding("latin1")).toBe(true);
  expect(Buffer.isEncoding("binary")).toBe(true);
  expect(Buffer.isEncoding("ucs2")).toBe(true);
  expect(Buffer.isEncoding("ucs-2")).toBe(true);
  expect(Buffer.isEncoding("utf16le")).toBe(true);
  expect(Buffer.isEncoding("utf-16le")).toBe(true);

  // Invalid encodings should return false
  expect(Buffer.isEncoding("invalid")).toBe(false);
  expect(Buffer.isEncoding("utf32")).toBe(false);
  expect(Buffer.isEncoding("something")).toBe(false);

  // Non-string values should return false
  expect(Buffer.isEncoding(123 as any)).toBe(false);
  expect(Buffer.isEncoding(null as any)).toBe(false);
  expect(Buffer.isEncoding(undefined as any)).toBe(false);
  expect(Buffer.isEncoding({} as any)).toBe(false);
  expect(Buffer.isEncoding([] as any)).toBe(false);
});
