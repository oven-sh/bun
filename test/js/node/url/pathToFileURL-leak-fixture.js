// Regression fixture for https://github.com/oven-sh/bun/pull/16784:
// pathToFileURL leaked the native WTF::String for the resolved path on
// every call (refcount was incremented but never released), which grew
// RSS by ~3.4 KB per call.
//
// Instead of running hundreds of thousands of iterations and checking an
// absolute RSS ceiling (which has to be branched for debug vs ASAN and is
// slow on ASAN lanes), run a short warmup to let allocator pools settle,
// sample RSS, run a measurement batch with a GC after each round so
// collectible URL wrappers don't accumulate, then assert the growth is
// bounded. The parent test spawns this with ASAN's free-quarantine
// disabled so freed native allocations are returned immediately; with that
// the no-leak delta is ~0 MB on release and <2 MB under debug+ASAN, while
// the original leak would add ~14 MB over the measurement batch.
import { pathToFileURL } from "url";

const longPath = Buffer.alloc(1021, "Z").toString();
const rss =
  process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function"
    ? Bun.unsafe.memoryFootprint
    : process.memoryUsage.rss;

function batch(n) {
  for (let i = 0; i < n; i++) pathToFileURL(longPath);
  Bun.gc(true);
}

for (let i = 0; i < 4; i++) batch(512);
const baseline = rss();

for (let i = 0; i < 8; i++) batch(512);
const after = rss();

const deltaMB = (after - baseline) / 1024 / 1024;
console.log("RSS delta", deltaMB.toFixed(1), "MB (baseline", (baseline / 1024 / 1024) | 0, "MB)");

if (deltaMB > 8) {
  throw new Error("pathToFileURL leaked " + deltaMB.toFixed(1) + " MB over 4096 calls");
}
