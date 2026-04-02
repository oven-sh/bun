import { expect, test } from "bun:test";

test("ReadableStream.blob() after body consumed does not crash", async () => {
  const r = new Response("Hello World");
  const body = r.body!;
  // Consume the body through the Response API, detaching the blob store
  await r.arrayBuffer();
  // Calling blob() on the stream whose store is now null should throw, not crash
  try {
    await body.blob();
    expect.unreachable();
  } catch (e: any) {
    expect(e.code).toBe("ERR_BODY_ALREADY_USED");
  }
});
