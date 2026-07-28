import fs from "fs";
import { join } from "path";
import { isASAN, tmpdirSync } from "harness";
import { heapStats } from "bun:jsc";

const tmpdir = tmpdirSync();
const target = join(tmpdir, "blah");

// 5,000 iterations is enough to expose the original leak (#16788): the
// AbortSignal object-count check below would see ~15,000 live signals instead
// of a handful. 100,000 iterations made this file cost ~17s on slower CI lanes.
const ITERATIONS = 5_000;

let nonAbortErrors = 0;
const check = (e: unknown) => {
  if ((e as NodeJS.ErrnoException)?.name !== "AbortError") nonAbortErrors++;
};

for (let i = 0; i < ITERATIONS; i++) {
  // pre-aborted signal: readFile/writeFile reject synchronously and must
  // release the signal reference on the early-return path.
  await fs.promises.readFile(target, { signal: AbortSignal.abort() }).then(() => nonAbortErrors++, check);
  await fs.promises.writeFile(target, "blah", { signal: AbortSignal.abort() }).then(() => nonAbortErrors++, check);

  // abort after the write has been scheduled: the async completion path must
  // also release the signal reference.
  const controller = new AbortController();
  const prom = fs.promises.writeFile(target, "blah", { signal: controller.signal });
  process.nextTick(() => controller.abort());
  await prom.catch(check);
}

Bun.gc(true);

const numAbortSignalObjects = heapStats().objectTypeCounts.AbortSignal ?? 0;
const rss = (process.memoryUsage().rss / 1024 / 1024) | 0;
console.log(JSON.stringify({ numAbortSignalObjects, rss, nonAbortErrors }));

if (nonAbortErrors > 0) {
  throw new Error(`Expected every rejection to be an AbortError, saw ${nonAbortErrors} other outcomes`);
}

if (numAbortSignalObjects > 10) {
  throw new Error(`AbortSignal objects > 10, received ${numAbortSignalObjects}`);
}

// ASAN's quarantine retains freed allocations (default 256 MB) and shadow
// memory raises the absolute RSS floor; widen the cap to avoid false positives.
const limitMB = isASAN ? 700 : 200;
if (rss > limitMB) {
  throw new Error(`Memory leak detected: ${rss} MB, expected < ${limitMB} MB`);
}
