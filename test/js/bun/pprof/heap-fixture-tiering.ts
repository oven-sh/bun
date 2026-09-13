// Run by heap.test.ts: samples land in code that is being compiled to the next tier, where
// a frame's recorded call site can be stale.
import { decode } from "./pprof-decode";

Bun.pprof.heap.start({ sampleInterval: 128 * 1024 });
let samples = 0;
const kept: ArrayBuffer[] = [];
for (let round = 0; round < 12; round++) {
  // A fresh decoder each round runs through the interpreter and both compilers again.
  const { decode: freshDecode } = await import(`./pprof-decode.ts?round=${round}`);
  for (let i = 0; i < 200; i++) kept.push(new ArrayBuffer(64 * 1024));
  for (let i = 0; i < 3; i++) samples += (freshDecode as typeof decode)(Bun.pprof.heap.profile()).samples.length;
  if (kept.length > 1000) kept.length = 0;
}
Bun.pprof.heap.stop();
console.log(JSON.stringify({ sampled: samples > 0 }));
