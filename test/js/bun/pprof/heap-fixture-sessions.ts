// Run by heap.test.ts: blocks that one session sampled are freed while the next one runs.
import { decode, totalsWhere } from "./pprof-decode";

const MiB = 1024 * 1024;
let first: ArrayBuffer[] | null = [];
const second: ArrayBuffer[] = [];

function firstSession() {
  for (let i = 0; i < 32; i++) first!.push(new ArrayBuffer(MiB));
}
function secondSession() {
  for (let i = 0; i < 32; i++) second.push(new ArrayBuffer(MiB));
}

Bun.pprof.heap.start();
firstSession();
const firstProfile = decode(Bun.pprof.heap.stop());

Bun.pprof.heap.start();
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
    second: totalsWhere(secondProfile, f => f.function === "secondSession"),
  }),
);
