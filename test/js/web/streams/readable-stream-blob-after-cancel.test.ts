import { expect, test } from "bun:test";

test("ReadableStream.blob() after stream consumed does not crash", async () => {
  // When a BlobInternalReadableStreamSource has its store detached
  // (e.g. by fully reading the stream), calling .blob() should return
  // an empty blob, not crash with "Expected an exception to be thrown".
  const blob = new Blob(["hello"]);
  const stream = blob.stream();
  const reader = stream.getReader();
  await reader.read();
  await reader.read();
  reader.releaseLock();
  const result = await stream.blob();
  expect(result).toBeInstanceOf(Blob);
  expect(result.size).toBe(0);
});
