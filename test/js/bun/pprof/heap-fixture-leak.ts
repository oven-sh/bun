// Run by heap.test.ts: a session gives back everything when it is stopped.
// Each session samples about 230 distinct stacks (three of four blocks): a fifth of a MiB of tables.
const sink: ArrayBuffer[] = [];
function a(depth: number): number {
  // not a tail call: each depth is a stack of its own
  if (depth > 0) return a(depth - 1) + 1;
  return sink.push(new ArrayBuffer(160 * 1024));
}
function b(depth: number): number {
  // not a tail call: each depth is a stack of its own
  if (depth > 0) return b(depth - 1) + 1;
  return sink.push(new ArrayBuffer(200 * 1024));
}
function c(depth: number): number {
  // not a tail call: each depth is a stack of its own
  if (depth > 0) return c(depth - 1) + 1;
  return sink.push(new ArrayBuffer(240 * 1024));
}

function session(): number {
  Bun.pprof.heap.start({ sampleInterval: 128 * 1024 });
  for (let depth = 1; depth <= 100; depth++) {
    a(depth);
    b(depth);
    c(depth);
  }
  sink.length = 0;
  return Bun.pprof.heap.stop().byteLength;
}

for (let i = 0; i < 10; i++) session();
Bun.gc(true);
const before = process.memoryUsage.rss();
let bytes = 0;
for (let i = 0; i < 200; i++) bytes += session();
Bun.gc(true);
const after = process.memoryUsage.rss();
console.log(JSON.stringify({ growthMiB: (after - before) / 1024 / 1024, profileBytes: bytes }));
