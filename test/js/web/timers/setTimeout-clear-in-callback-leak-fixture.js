// Regression: calling clearTimeout(t), t.refresh(), or setting t._repeat inside t's own
// setTimeout callback leaked the native TimeoutObject. In fire(), state is set to .FIRED
// before the callback runs; any transition away from .FIRED during the callback
// (cancel() -> .CANCELLED, or reschedule() -> .ACTIVE via refresh/convertToInterval) left
// the heap ref unreleased because the post-callback cleanup only checked for .FIRED.
//
// The leak is detected via bun:jsc heapStats(): leaked TimeoutObjects keep their JS
// Timeout wrappers protected (gcProtect without a matching unprotect), so after a full
// GC the protected Timeout count would be ~BATCH * iterations instead of 0. RSS deltas
// are intentionally not asserted — debug/ASAN allocator overhead makes them unreliable.

const mode = process.argv[2];
if (mode !== "clear" && mode !== "refresh" && mode !== "repeat") {
  throw new Error("usage: <clear|refresh|repeat>");
}

const BATCH = 2_000;
const ITERATIONS = 20;

function gc() {
  Bun.gc(true);
}

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
  gc();
}

// warmup
for (let i = 0; i < 3; i++) await runBatch();

for (let i = 0; i < ITERATIONS; i++) await runBatch();
gc();
gc();

const heapStats = require("bun:jsc").heapStats();
const protectedTimeouts = heapStats.protectedObjectTypeCounts.Timeout ?? 0;
const liveTimeouts = heapStats.objectTypeCounts.Timeout ?? 0;
console.log("mode:", mode);
console.log("protected Timeout count:", protectedTimeouts);
console.log("live Timeout count:", liveTimeouts);

// Before the fix, every timer in every batch stayed protected: ~BATCH * (ITERATIONS + warmup).
if (protectedTimeouts !== 0) {
  throw new Error("Expected 0 protected Timeout but received " + protectedTimeouts);
}
// Live (unprotected) objects can linger from conservative stack scanning, but a leak
// would retain tens of thousands; allow well under one batch worth of stragglers.
if (liveTimeouts >= BATCH) {
  throw new Error("Expected fewer than " + BATCH + " live Timeout objects but received " + liveTimeouts);
}
