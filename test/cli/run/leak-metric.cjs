// Memory measurement shared by the leak fixtures in this directory.
//
// RSS is a poor signal for a leak: it grows with how much memory a workload
// churned, not with how much it retained. Release builds keep freed pages
// mapped for a while, so RSS moves by tens of MB between two runs of the same
// loop. ASAN builds hold freed blocks in a quarantine (256 MB by default) to
// catch use after free, so there RSS mostly measures the quarantine.
//
// The allocator knows what is live. On release builds everything, JSC
// included, allocates through mimalloc, and a walk of its heaps sums the bytes
// in use. On ASAN builds the sanitizer allocator reports the bytes allocated
// and not yet freed, quarantine excluded. It sees JSC memory only when bmalloc
// uses system malloc. bmalloc does that by itself when dlsym() finds
// __asan_init, but src/linker.lds keeps that symbol local, so the test spawns
// the fixtures with Malloc=1. Both numbers are exact to a few MB. A build where
// neither sees JSC memory falls back to RSS.
let internals;
try {
  internals = require("bun:internal-for-testing");
} catch {}
const { heapStats } = require("bun:jsc");

const MB = 1024 * 1024;
const isASAN = internals?.isASANEnabled?.() ?? process.execPath.includes("bun-asan");
const isDebug = Bun.version.includes("debug");

function sanitizerAllocatedBytes() {
  return internals.asanAllocatedBytes();
}

function mimallocLiveBytes() {
  let bytes = 0;
  for (const heap of heapStats({ dump: true }).mimallocDump.heaps) {
    for (const page of heap.pages) bytes += page.block_size * page.used;
  }
  return bytes;
}

const rss =
  process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function"
    ? Bun.unsafe.memoryFootprint
    : process.memoryUsage.rss;

// An allocator metric counts only if it sees a JSC string, the kind of
// allocation a retained source is. The second GC frees the Buffer.
function seesJSCMemory(measure) {
  try {
    Bun.gc(true);
    const before = measure();
    const probe = Buffer.alloc(8 * MB, "a").toString("latin1");
    Bun.gc(true);
    return measure() - before >= probe.length / 2;
  } catch {
    return false;
  }
}

const metric =
  isASAN && typeof internals?.asanAllocatedBytes?.() === "number" && seesJSCMemory(sanitizerAllocatedBytes)
    ? { name: "sanitizer allocator", measure: sanitizerAllocatedBytes, exact: true }
    : seesJSCMemory(mimallocLiveBytes)
      ? { name: "mimalloc heaps", measure: mimallocLiveBytes, exact: true }
      : { name: "rss", measure: rss, exact: false };

// Below this much growth nothing is a leak. The allocator metrics move by a
// few MB between runs (one load of compilation state the concurrent JIT
// thread still holds, blocks the incremental sweeper has not returned), RSS
// by tens of MB.
const NOISE_FLOOR_BYTES = (metric.exact ? 16 : 64) * MB;

module.exports = {
  metric: metric.name,
  measure: metric.measure,

  // Iterations for this build. `asan` is for a workload too slow to run in
  // full under ASAN. Debug builds are 10x slower than the builds CI runs, and
  // only need to run the code.
  iterations: ({ release, asan = release }) => (isDebug ? Math.max(5, Math.round(asan / 50)) : isASAN ? asan : release),

  // Prints the result and exits 1 on a leak. `limitBytesPerIteration` is the
  // retained memory per iteration that counts as a leak.
  report(leakedBytes, { count, limitBytesPerIteration }) {
    let limit = Math.max(count * limitBytesPerIteration, NOISE_FLOOR_BYTES);
    if (isASAN && !metric.exact) {
      limit *= 4;
    }
    console.log(
      `leaked ${(leakedBytes / MB).toFixed(1)} MB, limit ${(limit / MB) | 0} MB, ${count} iterations, ${metric.name}`,
    );
    if (leakedBytes > limit) {
      console.log("\n--fail--\n");
      process.exit(1);
    }
    console.log("\n--pass--\n");
  },
};
