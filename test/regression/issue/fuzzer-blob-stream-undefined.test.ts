import { expect, test } from "bun:test";

// Fuzzer found crash: Blob.stream() with undefined argument
// The issue was that toInt64() was called on undefined, causing an assertion failure
test("Blob.stream() should handle undefined chunkSize argument", async () => {
  class C1 extends Array {}
  const v2 = C1[9]; // undefined
  const blob = new Blob();

  // This should not crash
  const stream = blob.stream(v2);
  expect(stream).toBeDefined();
  expect(stream).toBeInstanceOf(ReadableStream);

  // Verify the stream works
  const reader = stream.getReader();
  const result = await reader.read();
  expect(result.done).toBe(true);
});

test("Blob.stream() should handle null chunkSize argument", async () => {
  const blob = new Blob();

  // null should also work (treated as default)
  const stream = blob.stream(null);
  expect(stream).toBeDefined();
  expect(stream).toBeInstanceOf(ReadableStream);

  const reader = stream.getReader();
  const result = await reader.read();
  expect(result.done).toBe(true);
});

test("Blob.stream() should handle valid chunkSize argument", async () => {
  const blob = new Blob(["hello world"]);

  // Valid number should work
  const stream = blob.stream(5);
  expect(stream).toBeDefined();
  expect(stream).toBeInstanceOf(ReadableStream);

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  expect(chunks.length).toBeGreaterThan(0);
});

test("Blob.stream() should reject non-number, non-null/undefined chunkSize", () => {
  const blob = new Blob();

  // Invalid types should throw
  expect(() => blob.stream("invalid" as any)).toThrow();
  expect(() => blob.stream({} as any)).toThrow();
  expect(() => blob.stream([] as any)).toThrow();
});
