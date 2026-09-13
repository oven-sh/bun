// Run by heap.test.ts. The type annotations make the transpiled code differ from this file,
// so the reported lines only match if they went through the sourcemap.
import { decode, totalsWhere } from "./pprof-decode";

interface Kept {
  buffers: ArrayBuffer[];
}
const kept: Kept = { buffers: [] };
const MiB: number = 1024 * 1024;

function keepBuffers(count: number): void {
  for (let i = 0; i < count; i++) kept.buffers.push(new ArrayBuffer(MiB)); // line 12
}

function dropBuffers(count: number): number {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += new Uint8Array(MiB).fill(1)[i];
  return sum;
}

Bun.pprof.heap.start();
keepBuffers(64);
dropBuffers(64);
Bun.gc(true);
const whileRunning = decode(Bun.pprof.heap.profile());
const stillRunning = Bun.pprof.heap.isRunning;
const profile = decode(Bun.pprof.heap.stop());

const isKeep = (f: { function?: string }) => f.function === "keepBuffers";
const isDrop = (f: { function?: string }) => f.function === "dropBuffers";
const sample = profile.samples.find(s => s.stack.some(isKeep))!;
const keepIndex = sample.stack.findIndex(isKeep);

console.log(
  JSON.stringify({
    sampleTypes: profile.sampleTypes,
    periodType: profile.periodType,
    period: profile.period,
    defaultSampleType: profile.defaultSampleType,
    emptyString: profile.stringTable[0],
    hasTime: profile.timeNanos > 0n && profile.durationNanos > 0n,
    stillRunning,
    keptBuffers: kept.buffers.length,
    keep: totalsWhere(profile, isKeep),
    drop: totalsWhere(profile, isDrop),
    keepWhileRunning: totalsWhere(whileRunning, isKeep),
    keepFrame: sample.stack[keepIndex],
    callerOfKeep: sample.stack.slice(keepIndex + 1).find(f => f.function !== undefined),
    hasNativeFramesBelow: sample.stack.slice(0, keepIndex).some(f => f.address !== undefined),
    hasNativeFramesAbove: sample.stack.slice(keepIndex).some(f => f.address !== undefined),
    nativeFramesHaveMappings: sample.stack.every(f => f.address === undefined || f.mapping?.file !== ""),
    labels: sample.labels,
  }),
);
