const nativeTests = require("./build/Debug/napitests.node");

function usage() {
  return process.memoryUsage.rss();
}

function batchWeakRefs(n) {
  if (typeof n != "number") throw new TypeError();
  for (let i = 0; i < n; i++) {
    nativeTests.make_weak_ref(Math.random().toString());
  }
  Bun.gc(true);
}

function test(fn, warmupRuns, testRuns, maxDeltaMB) {
  // warmup
  for (let i = 0; i < warmupRuns; i++) {
    fn();
  }
  const initial = usage() / 1024 / 1024;

  // test
  for (let i = 0; i < testRuns; i++) {
    fn();
  }
  const after = usage() / 1024 / 1024;

  const deltaMB = after - initial;
  console.log(`RSS ${initial} -> ${after} MiB`);
  if (deltaMB > maxDeltaMB) {
    throw new Error("leaked!");
  }
}

test(() => batchWeakRefs(1000), 10, 100, 5);
