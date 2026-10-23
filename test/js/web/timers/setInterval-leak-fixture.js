// Arms intervals in batches, clears each batch, and reports what the cleared timers left behind.
//
// usage: bun setInterval-leak-fixture.js [warmupBatches] [measuredBatches] [runsPerTimer]
//
// The defaults are the full workload. setInterval.test.js gives a smaller one to the slow builds.
import { heapStats } from "bun:jsc";

const [warmupBatches = 50, measuredBatches = 300, runsPerTimer = 10] = process.argv.slice(2).map(Number);
const timersPerBatch = 1_000;
const delta = 1;

const usage = process.memoryUsage.rss;

let timers = 0;
let callbacks = 0;
// The number of callbacks that the current batch still has to run.
let runs = 0;
var resolve, promise;

// Attaches large allocated data to the current timer. Decrements the number of remaining iterations.
// When invoked the last time, resolves promise.
function iterate() {
  callbacks++;
  this.bigLeakyObject = {
    huge: {
      wow: {
        big: {
          data: runs.toString().repeat(50),
        },
      },
    },
  };

  if (runs-- === 1) resolve();
}

// Resets the global run counter. Creates `timersPerBatch` new timers with iterate as the callback.
// Waits for them all to finish, then clears all the timers and triggers garbage collection.
async function batch() {
  runs = timersPerBatch * runsPerTimer;
  ({ promise, resolve } = Promise.withResolvers());
  {
    const batchTimers = [];
    for (let i = 0; i < timersPerBatch; i++) batchTimers.push(setInterval(iterate, delta));
    timers += batchTimers.length;
    await promise;
    batchTimers.forEach(clearInterval);
  }
  Bun.gc(true);
}

for (let i = 0; i < warmupBatches; i++) await batch();
// Measure memory usage after the warmup
const initial = usage();
for (let i = 0; i < measuredBatches; i++) await batch();
// Measure memory usage again, to check that cleared timers and the objects allocated inside each
// callback have not bloated it
const rssDeltaMB = ((usage() - initial) / 1024 / 1024) | 0;

// The `batchTimers` array of the last batch() call stays reachable until the event loop turns. Yield
// to the event loop once, so that no cleared timer is reachable when the count is taken.
await new Promise(resolve => setImmediate(resolve));
Bun.gc(true);

const { objectTypeCounts, protectedObjectTypeCounts } = heapStats();
console.log(
  JSON.stringify({
    timers,
    callbacks,
    rssDeltaMB,
    liveTimeouts: objectTypeCounts.Timeout ?? 0,
    protectedTimeouts: protectedObjectTypeCounts.Timeout ?? 0,
  }),
);
