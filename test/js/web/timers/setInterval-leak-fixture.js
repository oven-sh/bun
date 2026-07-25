const delta = 1;
const initialRuns = 1_000;
let runs = initialRuns;
// ASAN's quarantine retains freed allocations (default 256 MB) so RSS deltas
// run higher under ASAN; widen the threshold to avoid false positives. Detect
// ASAN from the runtime (the debug build is ASAN-instrumented but named
// `bun-debug`, so the name check alone is wrong for local runs).
let isASAN = false;
try {
  isASAN = require("bun:internal-for-testing").isASANEnabled();
} catch {}
isASAN ||= process.execPath.includes("-asan");

function usage() {
  return process.memoryUsage.rss();
}

function gc() {
  if (typeof Bun !== "undefined") {
    Bun.gc(true);
  } else if (typeof globalThis.gc !== "undefined") {
    globalThis.gc();
  }
}

var resolve, promise;

// Attaches large allocated data to the current timer. Decrements the number of remaining iterations.
// When invoked the last time, resolves promise with the memory usage at the end of this batch.
function iterate() {
  this.bigLeakyObject = {
    huge: {
      wow: {
        big: {
          data: Buffer.alloc(32 * 1024, runs & 0xff),
        },
      },
    },
  };

  if (runs-- === 1) {
    const rss = usage();
    resolve(rss);
  }
}

// Resets the global run counter. Creates `iterations` new timers with iterate as the callback.
// Waits for them all to finish, then clears all the timers, triggers garbage collection, and
// returns the final memory usage measured by a timer.
async function batch(iterations) {
  let result;
  runs = initialRuns;
  ({ promise, resolve } = Promise.withResolvers());
  {
    const timers = [];
    for (let i = 0; i < iterations; i++) timers.push(setInterval(iterate, delta));
    result = await promise;
    timers.forEach(clearInterval);
  }
  gc();
  return result;
}

{
  // Warmup
  for (let i = 0; i < 3; i++) {
    await batch(200);
  }
  // Measure memory usage after the warmup
  const initial = usage();
  // Run batch 20 more times, each time creating 200 timers, waiting for them to finish, and
  // clearing them.
  for (let i = 0; i < 20; i++) {
    await batch(200);
  }
  // Measure memory usage again, to check that cleared timers and the objects allocated inside each
  // callback have not bloated it
  const result = usage();
  {
    const delta = ((result - initial) / 1024 / 1024) | 0;
    console.log("RSS", (result / 1024 / 1024) | 0, "MB");
    console.log("Delta", delta, "MB");

    if (globalThis.Bun) {
      const heapStats = require("bun:jsc").heapStats();
      console.log("Timeout object count:", heapStats.objectTypeCounts.Timeout || 0);
      if (heapStats.protectedObjectTypeCounts.Timeout) {
        throw new Error("Expected 0 protected Timeout but received " + heapStats.protectedObjectTypeCounts.Timeout);
      }
    }

    // With a 32 KiB payload pinned on each timer, a leaked batch of timers costs ~6 MB; 20 batches
    // would add well over 100 MB, so both thresholds are comfortably below the leak signal.
    if (delta > (isASAN ? 50 : 20)) {
      throw new Error("Memory leak detected");
    }
  }
}
