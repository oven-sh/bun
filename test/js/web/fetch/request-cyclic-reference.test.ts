import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";

test("stream should not leak when request is cyclic reference to itself", async () => {
  function leak() {
    const stream = new ReadableStream({
      pull(controller) {},
    });
    const response = new Request("http://localhost:1337", { method: "POST", body: stream });
    // @ts-ignore
    stream.response = stream;
  }
  for (let i = 0; i < 10000; i++) {
    leak();
  }

  await Bun.sleep(0);
  Bun.gc(true);
  expect(heapStats().objectTypeCounts.ReadableStream || 0).toBeLessThanOrEqual(100);
});

test("stream should not leak when creating a stream contained in another request", async () => {
  var req1: Request | null = null;
  var req2: Request | null = null;
  function leak() {
    const stream = new ReadableStream({
      async pull(controller) {
        await 42;
        controller.stream = req1;
        controller.stream2 = req2;
      },
    });
    req1 = new Request("http://localhost:1337", { method: "POST", body: stream });
    req2 = new Request("http://localhost:1337", { method: "POST", body: req1.body });
    // @ts-ignore
    stream.req2 = req2;
    stream.req = req1;
  }
  for (let i = 0; i < 10000; i++) {
    leak();
  }

  await Bun.sleep(0);
  Bun.gc(true);
  expect(heapStats().objectTypeCounts.ReadableStream || 0).toBeLessThanOrEqual(100);
});
