// Run by heap.test.ts: blocks that one session sampled are freed while the next one runs.
import { decode, totalsWhere } from "./pprof-decode";

const MiB = 1024 * 1024;
// A short interval: the tail after the last sample, which no sample has, is an interval long.
const options = { sampleInterval: 128 * 1024 };
let first: ArrayBuffer[] | null = [];
const second: ArrayBuffer[] = [];

function firstSession() {
  for (let i = 0; i < 32; i++) first!.push(new ArrayBuffer(MiB));
}
function secondSession() {
  for (let i = 0; i < 32; i++) second.push(new ArrayBuffer(MiB));
}

// A collection that an ArrayBuffer sets off allocates and frees under the same JavaScript frames.
const blocksOf = (profile: ReturnType<typeof decode>) => ({
  ...profile,
  samples: profile.samples.filter(s => s.values.alloc_space >= s.values.alloc_objects * MiB),
});

Bun.pprof.heap.start(options);
firstSession();
const firstProfile = decode(Bun.pprof.heap.stop());

Bun.pprof.heap.start(options);
secondSession();
const arrayBuffersBefore = process.memoryUsage().arrayBuffers;
first = null;
Bun.gc(true);
const freed = arrayBuffersBefore - process.memoryUsage().arrayBuffers;
const secondProfile = decode(Bun.pprof.heap.stop());

console.log(
  JSON.stringify({
    freedMiB: Math.round(freed / MiB),
    kept: second.length,
    first: totalsWhere(firstProfile, f => f.function === "firstSession"),
    firstInSecondProfile: totalsWhere(secondProfile, f => f.function === "firstSession"),
    second: totalsWhere(blocksOf(secondProfile), f => f.function === "secondSession"),
  }),
);
