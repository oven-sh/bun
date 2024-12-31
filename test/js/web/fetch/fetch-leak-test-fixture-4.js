import { heapStats } from "bun:jsc";
import { expect } from "bun:test";
function getHeapStats() {
  return heapStats().objectTypeCounts;
}

const server = process.argv[2];
const batch = 50;
const iterations = 10;
const threshold = batch * 2 + batch / 2;

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
      await Bun.sleep(10);
      const stats = getHeapStats();
      expect(stats.Response || 0).toBeLessThanOrEqual(threshold);
      expect(stats.Promise || 0).toBeLessThanOrEqual(threshold);
    }
  }
  process.exit(0);
} catch (e) {
  console.error(e);
  process.exit(1);
}
