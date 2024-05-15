import { heapStats } from "bun:jsc";
import { expect } from "bun:test";
function getHeapStats() {
  return heapStats().objectTypeCounts;
}

const server = process.argv[2];
const batch = 50;
const delay = 100;
const iterations = 10;

try {
  let peak_promises_alive = 0;
  for (let i = 0; i < iterations; i++) {
    {
      const promises = [];
      for (let j = 0; j < batch; j++) {
        const promise = fetch(server);
        promise.then(res => res.text());
        promises.push(promise);
      }
      await Promise.all(promises);
    }
    await Bun.sleep(delay);
    {
      Bun.gc(true);
      const stats = getHeapStats();
      if (peak_promises_alive < stats.Promise || 0) {
        peak_promises_alive = stats.Promise;
      }
    }
  }
  // we expect the peak number of promises to be more than the expected number of promises
  process.exit(peak_promises_alive > 2 ? 0 : 1);
} catch (e) {
  console.error(e);
  process.exit(1);
}
