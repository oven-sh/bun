import { expect, test } from "bun:test";

// Verify streaming through fetch().body.pipeThrough(TransformStream)
// delivers all data correctly with the backpressure-aware readStreamIntoSink.
// Without the fix, readStreamIntoSink consumed upstream data in a tight loop
// without checking sink.write() return values, causing OOM with slow consumers.
// The actual backpressure behavior requires a slow remote consumer to trigger
// TCP-level backpressure, which cannot be reliably tested on localhost.
// https://github.com/oven-sh/bun/issues/28035
test("TransformStream proxy delivers all data", async () => {
  const TOTAL_CHUNKS = 500;

  await using upstream = Bun.serve({
    port: 0,
    idleTimeout: 255,
    fetch() {
      let i = 0;
      return new Response(
        new ReadableStream({
          pull(controller) {
            if (i >= TOTAL_CHUNKS) {
              controller.close();
              return;
            }
            const chunk = Buffer.alloc(25000, 65);
            chunk.writeUInt32BE(i, 0);
            controller.enqueue(chunk);
            i++;
          },
        }),
      );
    },
  });

  await using proxy = Bun.serve({
    port: 0,
    idleTimeout: 255,
    async fetch() {
      const res = await fetch(`http://localhost:${upstream.port}/`);
      const transform = new TransformStream({
        transform(chunk, ctrl) {
          ctrl.enqueue(chunk);
        },
      });
      return new Response(res.body!.pipeThrough(transform));
    },
  });

  // Make multiple concurrent requests to stress the pipeline
  const responses = await Promise.all([
    fetch(`http://localhost:${proxy.port}/`),
    fetch(`http://localhost:${proxy.port}/`),
    fetch(`http://localhost:${proxy.port}/`),
  ]);

  for (const response of responses) {
    const body = await response.bytes();
    expect(body.length).toBe(TOTAL_CHUNKS * 25000);

    // Verify chunk ordering
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    expect(view.getUint32(0)).toBe(0);
    expect(view.getUint32((TOTAL_CHUNKS - 1) * 25000)).toBe(TOTAL_CHUNKS - 1);
  }
});
