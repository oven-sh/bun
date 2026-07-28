import fs from "fs";
import { join } from "path";
import { isASAN, isDebug, tmpdirSync } from "harness";
import { heapStats } from "bun:jsc";

const tmpdir = tmpdirSync();
const target = join(tmpdir, "blah");

// The leak detector is the live AbortSignal wrapper count below. A wrapper is
// only pinned by hasPendingActivity() when the signal is not aborted AND has an
// abort listener (see JSAbortSignalCustom.cpp), so the detector paths use a
// never-aborted signal with a no-op listener: if readFile/writeFile forget to
// drop their pending-activity ref, every one of those wrappers survives GC.
// A few hundred rounds is enough for the count to clear the threshold of 10 by
// two orders of magnitude; there is no need for the 100,000 rounds the RSS
// check used to require.
const ITERATIONS = isDebug || isASAN ? 200 : 2_000;

let nonAbortErrors = 0;
const mustAbort = (e: unknown) => {
  if ((e as NodeJS.ErrnoException)?.name !== "AbortError") nonAbortErrors++;
};
const noop = () => {};

for (let i = 0; i < ITERATIONS; i++) {
  // pre-aborted signal: readFile/writeFile reject immediately and must release
  // the signal reference on the early-return path.
  await fs.promises.readFile(target, { signal: AbortSignal.abort() }).then(() => nonAbortErrors++, mustAbort);
  await fs.promises.writeFile(target, "blah", { signal: AbortSignal.abort() }).then(() => nonAbortErrors++, mustAbort);

  // abort after the write has been scheduled: the async completion path must
  // also release the signal reference.
  {
    const controller = new AbortController();
    const prom = fs.promises.writeFile(target, "blah", { signal: controller.signal });
    process.nextTick(() => controller.abort());
    await prom.catch(mustAbort);
  }

  // never-aborted signal with an abort listener: this is the leak detector.
  // If the pending-activity ref taken by readFile/writeFile is not released,
  // the wrapper stays reachable and shows up in heapStats below.
  {
    const controller = new AbortController();
    controller.signal.addEventListener("abort", noop);
    await fs.promises.writeFile(target, "blah", { signal: controller.signal });
    await fs.promises.readFile(target, { signal: controller.signal });
  }
}

Bun.gc(true);

const numAbortSignalObjects = heapStats().objectTypeCounts.AbortSignal ?? 0;
const rss = (process.memoryUsage().rss / 1024 / 1024) | 0;
console.log(JSON.stringify({ numAbortSignalObjects, rss, nonAbortErrors }));

if (nonAbortErrors > 0) {
  throw new Error(`Expected every pre-aborted/aborted rejection to be an AbortError, saw ${nonAbortErrors} other outcomes`);
}

if (numAbortSignalObjects > 10) {
  throw new Error(`AbortSignal objects > 10, received ${numAbortSignalObjects}`);
}
