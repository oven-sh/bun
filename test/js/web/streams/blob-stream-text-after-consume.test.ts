import { expect, test } from "bun:test";

// Regression test: calling buffered consumption methods on a ReadableStream
// backed by a Blob after the blob store has already been consumed should
// return a resolved promise with empty data, not crash with an assertion
// failure ("Expected an exception to be thrown").

test("calling .text() on a Blob ReadableStream after consume returns empty string", async () => {
  const blob = new Blob(["hello"]);
  const stream = blob.stream();

  // First call detaches the blob store
  stream.blob();

  // Second call should resolve with empty data, not crash
  const result = await stream.text();
  expect(result).toBe("");
});

test("calling .bytes() on a Blob ReadableStream after consume returns empty Uint8Array", async () => {
  const blob = new Blob(["hello"]);
  const stream = blob.stream();

  stream.blob();

  const result = await stream.bytes();
  expect(result).toBeInstanceOf(Uint8Array);
  expect(result.length).toBe(0);
});
