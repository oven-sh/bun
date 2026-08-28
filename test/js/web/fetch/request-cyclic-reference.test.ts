import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { isASAN } from "harness";

// In CI these files run under `bun test --parallel --isolate`, where one
// worker process runs several test files against the same JSC VM. heapStats()
// is VM-wide, so assert on the delta rather than an absolute count to avoid
// counting ReadableStreams left over from the previous file in this worker.
const streamCount = () => heapStats().objectTypeCounts.ReadableStream || 0;
// Each leak() allocates two Requests and an async-pull ReadableStream; 10000
// of those overrun the default 5s timeout under ASAN. A real cycle leak still
// leaves ~iterations streams behind against the 100 threshold either way.
const iterations = isASAN ? 2000 : 10000;

test("stream should not leak when request is cyclic reference to itself", async () => {
  const baseline = streamCount();
  function leak() {
    const stream = new ReadableStream({
      pull(controller) {},
    });
    const response = new Request("http://localhost:1337", { method: "POST", body: stream });
    // @ts-ignore
    stream.response = stream;
  }
  for (let i = 0; i < iterations; i++) {
    leak();
  }

  await Bun.sleep(0);
  Bun.gc(true);
  expect(streamCount() - baseline).toBeLessThanOrEqual(100);
});

test("stream should not leak when creating a stream contained in another request", async () => {
  const baseline = streamCount();
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
  for (let i = 0; i < iterations; i++) {
    leak();
  }

  await Bun.sleep(0);
  Bun.gc(true);
  expect(streamCount() - baseline).toBeLessThanOrEqual(100);
});
