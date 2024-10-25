const nativeTests = require("./build/Debug/napitests.node");

function usage() {
  return process.memoryUsage.rss();
}

function gc() {
  if (typeof Bun == "object") {
    Bun.gc(true);
  } else {
    global.gc();
  }
}

async function test(fn, warmupRuns, testRuns, maxDeltaMB) {
  // warmup
  for (let i = 0; i < warmupRuns; i++) {
    console.log(`warmup ${i}/${warmupRuns}`);
    fn();
    await new Promise(resolve => setTimeout(resolve, 0));
    gc();
  }
  const initial = usage() / 1024 / 1024;

  // test
  for (let i = 0; i < testRuns; i++) {
    console.log(`test ${i}/${testRuns}`);
    fn();
    await new Promise(resolve => setTimeout(resolve, 0));
    gc();
  }
  const after = usage() / 1024 / 1024;

  const deltaMB = after - initial;
  console.log(`RSS ${initial} -> ${after} MiB`);
  if (deltaMB > maxDeltaMB) {
    throw new Error("leaked!");
  }
}

function batchWeakRefs(n) {
  if (typeof n != "number") throw new TypeError();
  for (let i = 0; i < n; i++) {
    nativeTests.make_weak_ref(Math.random().toString());
  }
  gc();
}

function batchWrappedObjects(n) {
  if (typeof n != "number") throw new TypeError();
  let wraps = [];
  for (let i = 0; i < n; i++) {
    const s = Math.random().toString();
    const wrapped = nativeTests.wrapped_object_factory(
      s,
      !process.isBun, // supports_node_api_post_finalize
    );
    wraps.push(wrapped);
    if (wrapped.get() != s) {
      throw new Error("wrong value");
    }
  }
  gc();
  for (const w of wraps) {
    w.get();
  }
}

function batchExternals(n) {
  if (typeof n != "number") throw new TypeError();
  let externals = [];
  for (let i = 0; i < n; i++) {
    const s = Math.random().toString().repeat(50);
    const external = nativeTests.external_factory(s);
    externals.push(external);
    if (nativeTests.external_get(external) != s) {
      throw new Error("wrong value");
    }
  }
  gc();
  for (const e of externals) {
    nativeTests.external_get(e);
  }
}

(async () => {
  await test(() => batchWeakRefs(1000), 10, 100, 8);
  gc();
  await test(() => batchWrappedObjects(1000), 50, 300, 15);
  gc();
  await test(() => batchExternals(1000), 10, 400, 15);
})();
