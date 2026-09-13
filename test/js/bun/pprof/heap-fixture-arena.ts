// Run by heap.test.ts: the transpiler parses into an arena that is freed whole
// (mi_heap_destroy) when the call returns, which the allocator's free hook does not see.
import { decode } from "./pprof-decode";

let source = "";
for (let i = 0; i < 12000; i++)
  source += `export function f${i}(x: number): number { const o = { a: x + ${i}, b: "s${i}", c: [x, ${i}].map(v => v * 2) }; return o.a + o.c.length + o.b.length; }\n`;

const transpiler = new Bun.Transpiler({ loader: "ts" });
Bun.pprof.heap.start({ sampleInterval: 128 * 1024 });
const rounds: { allocSpace: number; inuseSpace: number }[] = [];
let output = 0;
for (let round = 0; round < 4; round++) {
  output += transpiler.transformSync(source).length;
  Bun.gc(true);
  const { totals } = decode(Bun.pprof.heap.profile());
  rounds.push({ allocSpace: totals.alloc_space, inuseSpace: totals.inuse_space });
}
Bun.pprof.heap.stop();
console.log(JSON.stringify({ rounds, transpiled: output > source.length }));
