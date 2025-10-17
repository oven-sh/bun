import { expect, test } from "bun:test";

test("Blob.stream() with undefined argument should not crash", () => {
  const blob = new Blob(["test"]);

  // Should not crash with undefined
  const stream1 = blob.stream(undefined);
  expect(stream1).toBeInstanceOf(ReadableStream);

  // Should not crash with null
  const stream2 = blob.stream(null);
  expect(stream2).toBeInstanceOf(ReadableStream);

  // Should work with a valid number
  const stream3 = blob.stream(1024);
  expect(stream3).toBeInstanceOf(ReadableStream);

  // Should work with no arguments
  const stream4 = blob.stream();
  expect(stream4).toBeInstanceOf(ReadableStream);
});
