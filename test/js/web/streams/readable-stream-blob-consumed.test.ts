import { expect, test } from "bun:test";

test("ReadableStream.blob() after body consumed does not crash", async () => {
  const r = new Response("Hello World");
  const body = r.body!;
  // Consume the body through the Response API, detaching the blob store
  await r.arrayBuffer();
  // Calling blob() on the stream whose store is now null should return a
  // rejected promise (not crash or throw synchronously)
  const promise = body.blob();
  expect(promise).toBeInstanceOf(Promise);
  try {
    await promise;
    expect.unreachable();
  } catch (e: any) {
    expect(e.code).toBe("ERR_BODY_ALREADY_USED");
  }
});
