// Exercises sink teardown for a direct ReadableStream whose pull() writes
// synchronously and returns a non-promise without ending the sink. The server
// keeps the response open until controller.end(); each request allocates a
// heap HTTPServerWritable/JSSink plus the promise plumbing used to wait for
// the close, and all of it must be released when end() completes the
// response; otherwise each request leaks the struct plus its buffer.
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

// RSS, not currentCommit (which ratchets under hole purging, a discarded hole
// stays "committed"); a leaked sink keeps its page resident, so RSS sees it.
// Floor over rounds spanning the 100ms sweep rate limit drops transient peaks.
async function settledRss() {
  let min = Infinity;
  for (let i = 0; i < 5; i++) {
    Bun.gc(true);
    await Bun.sleep(50);
    min = Math.min(min, process.memoryUsage.rss());
  }
  return min;
}

const iterations = 10000;

async function round() {
  for (let i = 0; i < iterations; i++) {
    await once();
    if (i % 1000 === 0) Bun.gc(true);
  }
  return settledRss();
}

// Warm up with the SAME workload as the measured rounds: JIT tiering, caches and
// pools are still growing over the first rounds (~20 MB, then ~7 MB, then ~1 MB on a
// macOS debug build), and that decaying tail would otherwise swamp the leak.
await round();
await round();

// Median of per-round deltas: a leak is linear (every round pays it), the warmup
// tail inflates only the first, and a page-return round can dip negative. Median
// is robust to both ends; a min would pass on one dip even while the sink leaks.
let prev = await round();
const deltas: number[] = [];
for (let r = 0; r < 3; r++) {
  const rss = await round();
  deltas.push(rss - prev);
  prev = rss;
}

server.stop(true);

const delta = [...deltas].sort((a, b) => a - b)[Math.floor(deltas.length / 2)];
process.stdout.write(JSON.stringify({ delta, deltas, iterations }));
