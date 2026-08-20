// Regression: calling clearTimeout(t), t.refresh(), or setting t._repeat inside t's own
// setTimeout callback leaked the native TimeoutObject. In fire(), state is set to .FIRED
// before the callback runs; any transition away from .FIRED during the callback
// (cancel() -> .CANCELLED, or reschedule() -> .ACTIVE via refresh/convertToInterval) left
// the heap ref unreleased because the post-callback cleanup only checked for .FIRED.
//
// Usage: <clear|refresh|repeat> [batches]
//
// Runs `batches` batches of BATCH timers after warming up, then prints one JSON line:
//   timers             timers created in the measured batches
//   rssDeltaMB         RSS growth over the measured batches: 0-2 MB over 100 batches when nothing
//                      leaks; with the leak above, ~20 MB on a release build (~100 bytes per
//                      TimeoutObject) and ~100 MB on a debug build without ASAN
//   liveTimeouts       Timeout wrappers still on the JS heap after a full GC
//   protectedTimeouts  Timeout wrappers still pinned by the native side
// setTimeout.test.js asserts the report.

const mode = process.argv[2];
if (mode !== "clear" && mode !== "refresh" && mode !== "repeat") {
  throw new Error("usage: <clear|refresh|repeat> [batches]");
}
const batches = process.argv.length > 3 ? Number(process.argv[3]) : 100;
if (!Number.isInteger(batches) || batches < 1) {
  throw new Error("batches must be a positive integer, got " + process.argv[3]);
}

const rss =
  process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function"
    ? Bun.unsafe.memoryFootprint
    : process.memoryUsage.rss;

const BATCH = 2_000;

async function runBatch() {
  let remaining = BATCH;
  const { promise, resolve } = Promise.withResolvers();
  for (let i = 0; i < BATCH; i++) {
    if (mode === "clear") {
      const t = setTimeout(() => {
        clearTimeout(t);
        if (--remaining === 0) resolve();
      }, 0);
    } else if (mode === "refresh") {
      let fired = false;
      const t = setTimeout(() => {
        if (!fired) {
          fired = true;
          t.refresh();
        } else {
          if (--remaining === 0) resolve();
        }
      }, 0);
    } else {
      // "repeat": convert the timeout to an interval via t._repeat inside the callback
      let fired = false;
      const t = setTimeout(() => {
        if (!fired) {
          fired = true;
          t._repeat = 1;
        } else {
          clearInterval(t);
          if (--remaining === 0) resolve();
        }
      }, 0);
    }
  }
  await promise;
  Bun.gc(true);
}

for (let i = 0; i < Math.min(batches, 15); i++) await runBatch();
Bun.gc(true);
const initial = rss();

// These batches run from promise continuations, which matters on ASAN builds: test/leaksan.supp
// suppresses leaks allocated synchronously from module top-level code (the first warmup batch),
// so the measured batches are the ones LeakSanitizer reports leaked TimeoutObjects from.
for (let i = 0; i < batches; i++) await runBatch();
Bun.gc(true);
const final = rss();

const { objectTypeCounts, protectedObjectTypeCounts } = require("bun:jsc").heapStats();
console.log(
  JSON.stringify({
    mode,
    timers: batches * BATCH,
    rssDeltaMB: Math.round(((final - initial) / 1024 / 1024) * 10) / 10,
    liveTimeouts: objectTypeCounts.Timeout ?? 0,
    protectedTimeouts: protectedObjectTypeCounts.Timeout ?? 0,
  }),
);
