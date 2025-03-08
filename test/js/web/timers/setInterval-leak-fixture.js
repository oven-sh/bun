const delta = 1;
const initialRuns = 10_000;
let runs = initialRuns;

function usage() {
  return process.memoryUsage.rss();
}

Promise.withResolvers ??= () => {
  let promise, resolve, reject;
  promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

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
          data: runs.toString().repeat(50),
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
  for (let i = 0; i < 50; i++) {
    await batch(1_000);
  }
  // Measure memory usage after the warmup
  const initial = usage();
  // Run batch 300 more times, each time creating 1,000 timers, waiting for them to finish, and
  // clearing them.
  for (let i = 0; i < 300; i++) {
    await batch(1_000);
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

    if (delta > 20) {
      throw new Error("Memory leak detected");
    }
  }
}
