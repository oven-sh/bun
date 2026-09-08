import { expect, test } from "bun:test";

test("ReadableStream.blob() after body consumed does not crash", async () => {
  const r = new Response("Hello World");
  const body = r.body!;
  // Consume the body through the Response API, detaching the blob store. The
  // stream is that body's stream, so it is left disturbed and locked, as if the
  // read had gone through a reader that is never released.
  await r.arrayBuffer();
  expect(body.locked).toBe(true);
  // Calling blob() on the stream whose store is now null should return a
  // rejected promise (not crash or throw synchronously)
  const promise = body.blob();
  expect(promise).toBeInstanceOf(Promise);
  try {
    await promise;
    expect.unreachable();
  } catch (e: any) {
    expect(e).toBeInstanceOf(TypeError);
    expect(e.code).toBe("ERR_INVALID_STATE");
    expect(e.message).toContain("locked");
  }
});
