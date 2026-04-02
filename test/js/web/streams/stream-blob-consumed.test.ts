import { expect, test } from "bun:test";

// Regression: ByteBlobLoader.toBufferedValue returned .zero without setting
// a JS exception when the underlying store was already consumed, causing an
// assertion failure ("Expected an exception to be thrown") in debug builds.

test("ReadableStream.blob() on original response after clone works correctly", async () => {
  const response = new Response("Hello World");
  const cloned = response.clone();
  const body = response.body!;
  const blob = await body.blob();
  expect(blob.size).toBe(11);
  expect(await blob.text()).toBe("Hello World");
  expect(await cloned.text()).toBe("Hello World");
});

test("ReadableStream.blob() after cancel returns empty blob", async () => {
  const response = new Response("Hello World");
  const body = response.body!;
  const reader = body.getReader();
  await reader.cancel();
  reader.releaseLock();
  // After cancel, the ByteBlobLoader store is null.
  // blob() should return an empty blob, not crash.
  const blob = await body.blob();
  expect(blob.size).toBe(0);
  expect(await blob.text()).toBe("");
});

test("ReadableStream.blob() on Response body works correctly", async () => {
  const response = new Response("Hello");
  const body = response.body!;
  const blob = await body.blob();
  expect(blob.size).toBe(5);
  expect(await blob.text()).toBe("Hello");
});
