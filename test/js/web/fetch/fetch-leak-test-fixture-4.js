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
  console.log(getHeapStats());
  for (let i = 0; i < iterations; i++) {
    {
      const promises = [];
      for (let j = 0; j < batch; j++) {
        promises.push(fetch(server));
      }
      await Promise.all(promises);
    }
    {
      await new Promise(r => setTimeout(r, delay));
    }
    {
      Bun.gc(true);
      const stats = getHeapStats();
      expect(stats.Response || 0).toBeLessThan(batch);
      expect(stats.Promise || 0).toBeLessThanOrEqual(2);
    }
  }
  process.exit(0);
} catch (e) {
  console.error(e);
  process.exit(1);
}
