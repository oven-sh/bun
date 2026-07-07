// Exercises sink teardown for a direct ReadableStream whose pull() writes
// synchronously and returns a non-promise without ending the sink. The server
// keeps the response open until controller.end(); each request allocates a
// heap HTTPServerWritable/JSSink plus the promise plumbing used to wait for
// the close, and all of it must be released when end() completes the
// response; otherwise each request leaks the struct plus its buffer.
import { memoryUsage } from "bun:jsc";

let controller: any;
let pulled: { promise: Promise<void>; resolve: () => void };

const server = Bun.serve({
  port: 0,
  fetch() {
    const stream = new ReadableStream({
      type: "direct",
      pull(c: any) {
        // Less than highWaterMark so it buffers instead of sending. pull()
        // returns undefined (not a promise), so the request waits for end().
        c.write("x");
        controller = c;
        pulled.resolve();
      },
    } as any);
    return new Response(stream);
  },
});

const url = server.url.href;

async function once() {
  pulled = Promise.withResolvers();
  const resPromise = fetch(url);
  await pulled.promise;
  controller.end();
  const res = await resPromise;
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
