import { test, expect } from "bun:test";

test("ReadableStream.blob() after body consumed does not crash", async () => {
  const r = new Response("Hello World");
  const body = r.body!;
  // Consume the body through the Response API, detaching the blob store
  await r.arrayBuffer();
  // Calling blob() on the stream whose store is now null should throw, not crash
  expect(async () => await body.blob()).toThrow();
});
