import { expect, test } from "bun:test";

test("ReadableStream.text() on consumed Response body rejects instead of crashing", async () => {
  const resp = new Response("Hello");
  const body = resp.body!;
  // Consume the body via Response.bytes()
  await resp.bytes();
  // Calling text() on the now-consumed stream should return a rejected promise, not crash
  await expect(body.text()).rejects.toThrow("Body already used");
});
