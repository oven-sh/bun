const delta = 1;
const initialRuns = 5_000_000;
let runs = initialRuns;
var initial = 0;

Promise.withResolvers ??= () => {
  let promise, resolve, reject;
  promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const gc = typeof Bun !== "undefined" ? Bun.gc : typeof globalThis.gc !== "undefined" ? globalThis.gc : () => {};
var resolve, promise;
({ promise, resolve } = Promise.withResolvers());

function iterate() {
  if (runs === initialRuns) {
    initial = process.memoryUsage.rss();
    console.log(this);
  }

  this.bigLeakyObject = {
    huge: {
      wow: {
        big: {
          data: [],
        },
      },
    },
  };

  if (runs-- === 1) {
    const rss = process.memoryUsage.rss();
    resolve(rss);
  }
}

async function batch(iterations) {
  let result;
  runs = initialRuns;
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
  for (let i = 0; i < 50; i++) await batch(1_000);
  gc(true);
  const initial = await batch(1_000);
  for (let i = 0; i < 250; i++) {
    await batch(1_000);
  }
  gc(true);
  const result = process.memoryUsage.rss();
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
