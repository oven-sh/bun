const delta = 1;
const initialRuns = 1_000;
let runs = initialRuns;

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
      const timeoutCount = heapStats.objectTypeCounts.Timeout || 0;
      console.log("Timeout object count:", timeoutCount);
      if (heapStats.protectedObjectTypeCounts.Timeout) {
        throw new Error("Expected 0 protected Timeout but received " + heapStats.protectedObjectTypeCounts.Timeout);
      }
      // One batch (200 timers) is live until the next GC; anything much larger means cleared
      // timers from earlier batches are being retained.
      if (timeoutCount > 500) {
        throw new Error("Expected <= 500 live Timeout objects but received " + timeoutCount);
      }
    }

    // With a 32 KiB payload pinned on each timer, 20 leaked batches would add well over 100 MB,
    // so this backstop is well below the leak signal and well above allocator/heap growth noise.
    if (delta > 50) {
      throw new Error("Memory leak detected");
    }
  }
}
