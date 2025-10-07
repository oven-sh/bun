import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";

test("stream should not leak when response is cyclic reference to itself", async () => {
  function leak() {
    const stream = new ReadableStream({
      pull(controller) {},
    });
    const response = new Response(stream);
    // @ts-ignore
    stream.response = stream;
  }
  for (let i = 0; i < 10000; i++) {
    leak();
  }

  await Bun.sleep(0);
  Bun.gc(true);
  expect(heapStats().objectTypeCounts.ReadableStream || 0).toBeLessThanOrEqual(4);
});
