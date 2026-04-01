import { expect, test } from "bun:test";

test("bytes() on consumed Response body does not crash", async () => {
  const resp = new Response("test data");
  const body = resp.body!;
  // Response.bytes() uses the fast blob path which detaches the store
  // without locking the ReadableStream.
  await resp.bytes();
  // body.bytes() now hits the native fast path with a null store.
  // Without the fix, toBufferedValue returned .zero without setting
  // a JS exception, crashing with a segfault or assertion failure.
  const result = await body.bytes();
  expect(result).toBeInstanceOf(Uint8Array);
  expect(result.length).toBe(0);
});
