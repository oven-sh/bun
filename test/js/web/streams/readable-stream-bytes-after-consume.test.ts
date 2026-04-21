import { expect, test } from "bun:test";

test("ReadableStream.bytes() after Response body consumed does not crash", async () => {
  const r = new Response("test data");
  const body = r.body!;
  // Fast path in Response.bytes() detaches the blob store without locking the stream.
  await r.bytes();
  // Reaching the native blob source with a null store used to crash.
  try {
    await body.bytes();
    expect.unreachable();
  } catch (e: any) {
    expect(e.code).toBe("ERR_BODY_ALREADY_USED");
  }
});
