// Exercises the no-promise fallback path in doRenderStream().
//
// A direct ReadableStream whose pull() writes synchronously and returns a
// non-promise value falls through to the "is in progress, but did not return
// a Promise" branch. That branch must destroy the heap-allocated
// HTTPServerWritable/JSSink it created a few lines earlier; otherwise each
// request leaks the struct plus its buffer.
import { memoryUsage } from "bun:jsc";

const server = Bun.serve({
  port: 0,
  fetch() {
    const stream = new ReadableStream({
      type: "direct",
      pull(controller: any) {
        // Less than highWaterMark so it buffers instead of sending. pull()
        // returns undefined (not a promise), so assignToStream() also returns
        // undefined and doRenderStream drops into its no-promise fallback.
        controller.write("x");
      },
    } as any);
    return new Response(stream);
  },
});

const url = server.url.href;

async function once() {
  const res = await fetch(url);
  await res.arrayBuffer();
}

// Warm up: let JIT, caches, and pools settle before the baseline sample.
for (let i = 0; i < 500; i++) await once();
Bun.gc(true);
await Bun.sleep(10);
Bun.gc(true);
const before = memoryUsage().currentCommit;

const iterations = 10000;
for (let i = 0; i < iterations; i++) {
  await once();
  if (i % 1000 === 0) Bun.gc(true);
}
Bun.gc(true);
await Bun.sleep(10);
Bun.gc(true);
const after = memoryUsage().currentCommit;

server.stop(true);

process.stdout.write(JSON.stringify({ before, after, delta: after - before, iterations }));
