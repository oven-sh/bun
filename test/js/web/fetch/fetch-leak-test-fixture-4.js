import { heapStats } from "bun:jsc";
import { expect } from "bun:test";
function getHeapStats() {
  return heapStats().objectTypeCounts;
}

const server = process.argv[2];
const batch = 50;
const iterations = 10;

try {
  for (let i = 0; i < iterations; i++) {
    {
      const promises = [];
      for (let j = 0; j < batch; j++) {
        promises.push(fetch(server));
      }
      await Promise.all(promises);
    }

    {
      Bun.gc(true);
      const stats = getHeapStats();
      expect(stats.Response || 0).toBeLessThanOrEqual(batch + 5);
      expect(stats.Promise || 0).toBeLessThanOrEqual(batch + 5);
    }
  }
  process.exit(0);
} catch (e) {
  console.error(e);
  process.exit(1);
}
