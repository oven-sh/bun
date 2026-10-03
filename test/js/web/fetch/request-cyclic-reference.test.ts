import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { isASAN } from "harness";
import { once } from "node:events";
import net from "node:net";

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

// The client goes away while the request body is cloned and unread. The body
// fails, and it made the error for its stream in place, which left that error
// in the body by a Strong, a GC root. A handler that then reads the stream and
// keeps the request on the error it gets closed a cycle through that root.
test("a Bun.serve Request should not leak when the error of its failed body references it", async () => {
  let started = Promise.withResolvers<void>();
  let handled = Promise.withResolvers<void>();
  let attached = 0;
  await using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const aborted = new Promise(resolve => req.signal.addEventListener("abort", resolve));
      req.clone();
      started.resolve();
      await aborted;
      try {
        await req.body!.getReader().read();
      } catch (error: any) {
        error.request = req;
        attached++;
      }
      handled.resolve();
      return new Response("too late");
    },
  });

  async function leak() {
    started = Promise.withResolvers<void>();
    handled = Promise.withResolvers<void>();
    const socket = net.connect(server.port, "127.0.0.1");
    socket.on("error", () => {});
    await once(socket, "connect");
    socket.write("POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100\r\n\r\npartial");
    await started.promise;
    socket.destroy();
    await handled.promise;
  }

  const N = 60;
  const requestCount = () => heapStats().objectTypeCounts.Request || 0;
  for (let i = 0; i < 10; i++) await leak();
  Bun.gc(true);
  const baseline = requestCount();
  for (let i = 0; i < N; i++) await leak();

  // The server lets go of a request some turns after its connection closed.
  let leaked = Infinity;
  for (let turn = 0; turn < 50 && leaked >= N / 4; turn++) {
    await new Promise(resolve => setImmediate(resolve));
    Bun.gc(true);
    leaked = requestCount() - baseline;
  }
  // The premise: each read of the failed body rejected, and the handler kept the request on that error.
  expect(attached).toBe(N + 10);
  // Unfixed: all N.
  expect(leaked).toBeLessThan(N / 4);
});
