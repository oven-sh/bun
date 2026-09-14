// Run by heap.test.ts: profile() is called again and again while the same code allocates,
// the way a continuous profiler scrapes an endpoint.
import { allocateLater } from "./heap-fixture-scrape-b.ts";
import { allocateInLongNamedModule } from "./heap-fixture-scrape-module-with-a-long-file-name-so-that-its-url-is-the-longest.ts";
import { decode } from "./pprof-decode";

const kept: ArrayBuffer[] = [];
Bun.pprof.heap.start();

// A sample is a stack with its labels: two samples of one profile never have the same.
function duplicates(profile: ReturnType<typeof decode>): number {
  const key = (s: (typeof profile.samples)[number]) =>
    JSON.stringify([
      s.labels,
      s.stack.map(f => (f.address !== undefined ? String(f.address) : [f.function, f.file, f.line, f.column])),
    ]);
  return profile.samples.length - new Set(profile.samples.map(key)).size;
}

const found: number[] = [];
const repeated: number[] = [];
for (let scrape = 0; scrape < 5; scrape++) {
  for (let i = 0; i < 8; i++) allocateInLongNamedModule(kept);
  const profile = decode(Bun.pprof.heap.profile());
  found.push(profile.samples.filter(s => s.stack.some(f => f.function === "allocateInLongNamedModule")).length);
  repeated.push(duplicates(profile));
}
// First sampled after positions were resolved once already.
for (let i = 0; i < 8; i++) allocateLater(kept);
const profile = decode(Bun.pprof.heap.stop());
const later = profile.samples.filter(s => s.stack.some(f => f.function === "allocateLater"));
console.log(
  JSON.stringify({
    kept: kept.length,
    found: found.every(n => n > 0),
    // However often the profile was read.
    repeatedSamplesPerScrape: [...repeated, duplicates(profile)],
    laterFrame: later[0]?.stack.find(f => f.function === "allocateLater"),
    laterLabels: later.map(s => s.labels),
  }),
);
