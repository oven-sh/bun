import { expect, test } from "bun:test";

test("ReadableStream.bytes() after Response body consumed does not crash", async () => {
  const r = new Response("test data");
  const body = r.body!;
  // Fast path in Response.bytes() detaches the blob store without locking the stream.
  await r.bytes();
  // Reaching the native blob source with a null store used to crash.
  // The specific rejection reason isn't important — the point is the process survives.
  let threw = false;
  try {
    await body.bytes();
  } catch {
    threw = true;
  }
  expect(threw).toBe(true);
});
