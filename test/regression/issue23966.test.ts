// https://github.com/oven-sh/bun/issues/23966
// Buffer.isEncoding() behaves differently in Bun compared to Node.js
import { expect, test } from "bun:test";
import { Buffer } from "node:buffer";

test.concurrent("Buffer.isEncoding('') should return false", () => {
  expect(Buffer.isEncoding("")).toBe(false);
});

const validEncodings = [
  "utf8",
  "utf-8",
  "hex",
  "base64",
  "ascii",
  "latin1",
  "binary",
  "ucs2",
  "ucs-2",
  "utf16le",
  "utf-16le",
];
const invalidEncodings = ["invalid", "utf32", "something"];
const nonStringValues = [
  { value: 123, name: "number" },
  { value: null, name: "null" },
  { value: undefined, name: "undefined" },
  { value: {}, name: "object" },
  { value: [], name: "array" },
];

test.concurrent.each(validEncodings)("Buffer.isEncoding('%s') should return true", encoding => {
  expect(Buffer.isEncoding(encoding)).toBe(true);
});

test.concurrent.each(invalidEncodings)("Buffer.isEncoding('%s') should return false", encoding => {
  expect(Buffer.isEncoding(encoding)).toBe(false);
});

test.concurrent.each(nonStringValues)("Buffer.isEncoding($name) should return false for non-string", ({ value }) => {
  expect(Buffer.isEncoding(value as any)).toBe(false);
});
