import { expect, test } from "bun:test";

test("Response.clone() with SharedArrayBuffer-backed stream does not crash", async () => {
  const sab = new SharedArrayBuffer(16);
  const view = new Uint8Array(sab);
  view[0] = 0xab;

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(view);
      controller.close();
    },
  });

  const resp = new Response(stream);
  const cloned = resp.clone();

  const [orig, clone] = await Promise.all([resp.arrayBuffer(), cloned.arrayBuffer()]);

  expect(orig.byteLength).toBe(16);
  expect(clone.byteLength).toBe(16);
  expect(new Uint8Array(orig)[0]).toBe(0xab);
  expect(new Uint8Array(clone)[0]).toBe(0xab);
});
