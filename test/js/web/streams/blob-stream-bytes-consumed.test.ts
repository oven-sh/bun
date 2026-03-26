import { test, expect } from "bun:test";

test("bytes() on consumed blob ReadableStream returns valid result", async () => {
  // Create a blob-backed stream and fully consume it via reader
  const blob = new Blob(["test data"]);
  const stream = blob.stream();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  reader.releaseLock();

  // Stream is closed, source store is consumed.
  // Calling bytes() should return a valid empty Uint8Array, not crash.
  // Without the fix, the native toBufferedValue returns .zero without
  // setting an exception, causing an assertion failure in debug builds.
  const result = await stream.bytes();
  expect(result).toBeInstanceOf(Uint8Array);
  expect(result.length).toBe(0);
});
