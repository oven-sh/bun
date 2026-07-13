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

// RSS, not currentCommit: mimalloc's committed counter ratchets under hole purging
// (a discarded hole stays "committed"), so it is not a live-memory metric here. A
// leaked sink keeps its block -- and therefore its page -- resident, so RSS is.
// Floor over several settle rounds: the idle sweep is rate-limited (100ms), so the
// rounds span past it, and the min drops the transient peaks.
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

// Per-round deltas, then the median: a leak is linear (every round pays it), while
// what is left of the warmup tail only inflates the first of them and a round in which
// the allocator hands pages back can dip negative. The median is robust to both ends;
// a min would be satisfied by a single dipping round even while the sink leaks.
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
