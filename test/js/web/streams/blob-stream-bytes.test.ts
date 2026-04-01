import { expect, test } from "bun:test";

test("calling bytes() on body stream after Response.bytes() detaches the store should not crash", async () => {
  const response = new Response("hello");
  // Capture a reference to the body stream BEFORE consuming the response
  const body = response.body!;

  // Response.bytes() detaches the blob store from the underlying
  // BlobInternalReadableStreamSource without closing the JS ReadableStream
  await response.bytes();

  // Calling bytes() on the body stream should not crash with
  // "Expected an exception to be thrown" assertion failure
  const result = await body.bytes();
  expect(result).toBeInstanceOf(Uint8Array);
});
