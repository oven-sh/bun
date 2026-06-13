import { expect, test } from "bun:test";

test("ReadableStream.blob() after body consumed does not crash", async () => {
  const r = new Response("Hello World");
  const body = r.body!;
  // Consume the body through the Response API; the native conversion leaves
  // the captured stream consumed and detached
  await r.arrayBuffer();
  // Calling blob() on the consumed stream should return a rejected promise
  // (not crash or throw synchronously)
  const promise = body.blob();
  expect(promise).toBeInstanceOf(Promise);
  try {
    await promise;
    expect.unreachable();
  } catch (e: any) {
    // the detached stream reports as locked, like any consumed stream
    expect(e.code).toBe("ERR_INVALID_STATE");
    expect(e.message).toContain("ReadableStream is locked");
  }
});
