// Creating and closing a JSCallback must not leak the heap-allocated Function
// struct or the generated C source buffer passed to TinyCC.
const { JSCallback } = require("bun:ffi");

function cycle() {
  const cb = new JSCallback(() => {}, { returns: "void", args: [] });
  cb.close();
}

// RSS during warm-up is noisy (allocator ramp-up, JIT tier-up, ASAN shadow
// pages) and the point at which it plateaus varies a lot between machines and
// build configs. Instead of guessing a fixed warm-up length, sample RSS across
// several equal windows and judge the *minimum* growth: with the fix at least
// one window reaches steady state (~0), while a real leak grows by roughly the
// same amount in every window.
const windowSize = 400;
const windows = 5;
const deltasMB = [];

Bun.gc(true);
let prev = process.memoryUsage.rss();
for (let w = 0; w < windows; w++) {
  for (let i = 0; i < windowSize; i++) cycle();
  Bun.gc(true);
  const now = process.memoryUsage.rss();
  deltasMB.push((now - prev) / 1024 / 1024);
  prev = now;
}

const minGrowthMB = Math.min(...deltasMB);
console.log(JSON.stringify({ growthMB: minGrowthMB, deltasMB }));

// Before the fix each window leaked ~5MB (~12KB of generated C source plus the
// Function struct per callback). After, steady-state windows hold near 0.
if (minGrowthMB > 2) {
  console.error(
    "JSCallback leaked at least " + minGrowthMB.toFixed(2) + "MB in every " + windowSize + "-cycle window",
  );
  process.exit(1);
}
