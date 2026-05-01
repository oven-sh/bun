// Regression: calling clearTimeout(t) or t.refresh() inside t's own setTimeout callback
// leaked the native TimeoutObject. In fire(), state is set to .FIRED before the callback
// runs, so cancel() skipped its deref (it only derefs when state was .ACTIVE), and the
// post-callback cleanup only released the heap ref when state was still .FIRED — the
// .CANCELLED and .ACTIVE transitions inside the callback fell through without a deref.

const mode = process.argv[2];
if (mode !== "clear" && mode !== "refresh") {
  throw new Error("usage: <clear|refresh>");
}

const BATCH = 2_000;

function gc() {
  if (typeof Bun !== "undefined") Bun.gc(true);
  else if (typeof globalThis.gc !== "undefined") globalThis.gc();
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
    } else {
      let fired = false;
      const t = setTimeout(() => {
        if (!fired) {
          fired = true;
          t.refresh();
        } else {
          if (--remaining === 0) resolve();
        }
      }, 0);
    }
  }
  await promise;
  gc();
}

// warmup
for (let i = 0; i < 15; i++) await runBatch();
gc();
const initial = process.memoryUsage.rss();

for (let i = 0; i < 100; i++) await runBatch();
gc();
const final = process.memoryUsage.rss();
const deltaMB = (final - initial) / 1024 / 1024;
console.log("mode:", mode);
console.log("initial RSS:", (initial / 1024 / 1024) | 0, "MB");
console.log("final RSS:", (final / 1024 / 1024) | 0, "MB");
console.log("delta:", deltaMB.toFixed(1), "MB");

if (globalThis.Bun) {
  const heapStats = require("bun:jsc").heapStats();
  if (heapStats.protectedObjectTypeCounts.Timeout) {
    throw new Error("Expected 0 protected Timeout but received " + heapStats.protectedObjectTypeCounts.Timeout);
  }
}

// Before the fix, 100 * 2_000 leaked TimeoutObjects (~100 bytes each) ≈ 20 MB.
// After the fix the delta is ~0 MB (noise).
if (deltaMB > 10) {
  throw new Error("Memory leak detected: RSS grew by " + deltaMB.toFixed(1) + " MB");
}
