import { expect, test } from "bun:test";

// Regression test: ByteBlobLoader.toBufferedValue used to return .zero without
// setting a JS exception when its store was null (body already consumed), causing
// an assertion failure in debug builds and a crash in release builds.
test("calling .bytes() on a consumed Response body does not crash", async () => {
  const response = new Response("Hello World");
  const body = response.body!;
  // Consume via Body mixin to detach the ByteBlobLoader store
  await response.text();
  // body.bytes() should not crash regardless of whether it resolves or rejects
  const result = await body.bytes().catch(() => "rejected");
  expect(result === "rejected" || result instanceof Uint8Array).toBe(true);
});
