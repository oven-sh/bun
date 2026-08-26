import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";

// In CI these files run under `bun test --parallel --isolate`, where one
// worker process runs several test files against the same JSC VM. heapStats()
// is VM-wide, so assert on the delta rather than an absolute count to avoid
// counting ReadableStreams left over from the previous file in this worker.
const streamCount = () => heapStats().objectTypeCounts.ReadableStream || 0;

test("stream should not leak when response is cyclic reference to itself", async () => {
  const baseline = streamCount();
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
  expect(streamCount() - baseline).toBeLessThanOrEqual(100);
});

test("stream should not leak when creating a stream contained in another response", async () => {
  const baseline = streamCount();
  function leak() {
    const stream = new ReadableStream({
      pull(controller) {},
    });
    const response = new Response(stream);
    const response2 = new Response(response.body);
    // @ts-ignore
    stream.response = stream;
    stream.response2 = response2;
  }
  for (let i = 0; i < 10000; i++) {
    leak();
  }

  await Bun.sleep(0);
  Bun.gc(true);
  expect(streamCount() - baseline).toBeLessThanOrEqual(100);
});
