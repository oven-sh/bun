import fs from "fs";
import { join } from "path";
import { isASAN, tmpdirSync } from "harness";
import { heapStats } from "bun:jsc";

const tmpdir = tmpdirSync();

for (let i = 0; i < 100_000; i++) {
  try {
    const signal = AbortSignal.abort();
    await fs.promises.readFile("blah", { signal });
  } catch (e) {}
  try {
    const signal = AbortSignal.abort();
    await fs.promises.writeFile("blah", "blah", { signal });
  } catch (e) {}

  // aborting later does not leak in writeFile
  const controller = new AbortController();
  const signal = controller.signal;
  const prom = fs.promises.writeFile(join(tmpdir, "blah"), "blah", { signal });
  process.nextTick(() => controller.abort());
  try {
    await prom;
  } catch (e) {}
}

Bun.gc(true);

const numAbortSignalObjects = heapStats().objectTypeCounts.AbortSignal;
if (numAbortSignalObjects > 10) {
  throw new Error(`AbortSignal objects > 10, received ${numAbortSignalObjects}`);
}

// ASAN's quarantine retains freed allocations (default 256 MB) and shadow
// memory raises the absolute RSS floor; widen the cap to avoid false positives.
const limitMB = isASAN ? 700 : 200;
const rss = (process.memoryUsage().rss / 1024 / 1024) | 0;
if (rss > limitMB) {
  throw new Error(`Memory leak detected: ${rss} MB, expected < ${limitMB} MB`);
}
