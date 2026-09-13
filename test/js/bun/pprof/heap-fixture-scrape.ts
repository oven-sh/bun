// Run by heap.test.ts: profile() is called again and again while the same code allocates,
// the way a continuous profiler scrapes an endpoint.
import { allocateLater } from "./heap-fixture-scrape-b.ts";
import { allocateInLongNamedModule } from "./heap-fixture-scrape-module-with-a-long-file-name-so-that-its-url-is-the-longest.ts";
import { decode } from "./pprof-decode";

const kept: ArrayBuffer[] = [];
Bun.pprof.heap.start();

const counts: number[] = [];
for (let scrape = 0; scrape < 5; scrape++) {
  allocateInLongNamedModule(kept);
  const profile = decode(Bun.pprof.heap.profile());
  counts.push(profile.samples.filter(s => s.stack.some(f => f.function === "allocateInLongNamedModule")).length);
}
// First sampled after positions were resolved once already.
allocateLater(kept);
const profile = decode(Bun.pprof.heap.stop());
const later = profile.samples.filter(s => s.stack.some(f => f.function === "allocateLater"));
console.log(
  JSON.stringify({
    kept: kept.length,
    // One stack, one sample, however often the profile was read.
    samplesPerScrape: counts,
    laterFrame: later[0]?.stack.find(f => f.function === "allocateLater"),
    laterLabels: later.map(s => s.labels),
  }),
);
