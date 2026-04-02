import { expect, test } from "bun:test";

test("ReadableStream .bytes() after body consumed via Response.bytes() does not crash", async () => {
  const resp = new Response("Hello World");
  const body = resp.body!;
  // Consume body through Response (drains ByteBlobLoader store via toBlobIfPossible)
  await resp.bytes();
  // Calling .bytes() on the now-drained ReadableStream should reject, not crash
  await expect(body.bytes()).rejects.toThrow("Body already used");
});
