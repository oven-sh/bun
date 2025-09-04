import { expect, test } from "bun:test";

test("Buffer.concat throws RangeError for too large buffers", () => {
  const bufferToUse = Buffer.allocUnsafe(1024 * 1024 * 64);
  const buffers = new Array(1024);
  for (let i = 0; i < buffers.length; i++) {
    buffers[i] = bufferToUse;
  }

  expect(() => Buffer.concat(buffers)).toThrow(/JavaScriptCore typed arrays are currently limited to/);
});

test("Buffer.concat works with normal sized buffers", () => {
  const buf1 = Buffer.from("hello");
  const buf2 = Buffer.from(" ");
  const buf3 = Buffer.from("world");
  const result = Buffer.concat([buf1, buf2, buf3]);
  expect(result.toString()).toBe("hello world");
});

test("Buffer.concat with totalLength parameter", () => {
  const buf1 = Buffer.from("hello");
  const buf2 = Buffer.from(" ");
  const buf3 = Buffer.from("world");

  // Test with exact length
  const result1 = Buffer.concat([buf1, buf2, buf3], 11);
  expect(result1.toString()).toBe("hello world");

  // Test with larger length (should pad with zeros)
  const result2 = Buffer.concat([buf1, buf2, buf3], 15);
  expect(result2.length).toBe(15);
  expect(result2.toString("utf8", 0, 11)).toBe("hello world");

  // Test with smaller length (should truncate)
  const result3 = Buffer.concat([buf1, buf2, buf3], 5);
  expect(result3.toString()).toBe("hello");
});

test("Buffer.concat with empty array", () => {
  const result = Buffer.concat([]);
  expect(result.length).toBe(0);
});

test("Buffer.concat with single buffer", () => {
  const buf = Buffer.from("test");
  const result = Buffer.concat([buf]);
  expect(result.toString()).toBe("test");
  expect(result).not.toBe(buf); // Should be a copy
});

test("Bun.concatArrayBuffers throws OutOfMemoryError", () => {
  const bufferToUse = Buffer.allocUnsafe(1024 * 1024 * 64);
  const buffers = new Array(1024);
  for (let i = 0; i < buffers.length; i++) {
    buffers[i] = bufferToUse;
  }

  expect(() => Bun.concatArrayBuffers(buffers)).toThrow(/Failed to allocate/i);
});
