import { expect, test } from "bun:test";

test("Response.clone() does not crash when body stream contains SharedArrayBuffer-backed typed array", async () => {
  const sab = new SharedArrayBuffer(8);
  const view = new Uint8Array(sab);

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(view);
      controller.close();
    },
  });

  const resp = new Response(stream);
  const clone = resp.clone();
  // Reading the cloned body triggers structuredCloneForStream on the chunk.
  // Before the fix, this would crash with:
  //   ASSERTION FAILED: !result || !result->isShared()
  // Now it should throw a DataCloneError instead of crashing.
  expect(async () => await clone.arrayBuffer()).toThrow("cloned");
});
