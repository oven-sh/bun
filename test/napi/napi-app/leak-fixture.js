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
  gc();
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
  console.log(`Delta ${deltaMB} MB`);
  if (deltaMB > maxDeltaMB) {
    throw new Error("leaked!");
  }
}

// Create a bunch of weak references and delete them
// Checks that napi_delete_reference cleans up memory associated with the napi_ref itself
function batchWeakRefs(n) {
  if (typeof n != "number") throw new TypeError();
  for (let i = 0; i < n; i++) {
    // create tons of weak references to objects that get destroyed
    nativeTests.add_weak_refs({});
  }
  // free all the weak refs
  nativeTests.clear_weak_refs();
}

// Checks that strong references don't keep the value
function batchStrongRefs(n) {
  if (typeof n != "number") throw new TypeError();
  for (let i = 0; i < n; i++) {
    const array = new Uint8Array(10_000_000);
    array.fill(i);
    nativeTests.create_and_delete_strong_ref(array);
  }
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
  // now GC them
}

function batchExternals(n) {
  if (typeof n != "number") throw new TypeError();
  let externals = [];
  for (let i = 0; i < n; i++) {
    const s = Math.random().toString();
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
  await test(() => batchWeakRefs(100), 10, 50, 8);
  await test(() => batchStrongRefs(100), 10, 50, 8);
  await test(() => batchWrappedObjects(1000), 20, 50, 20);
  // TODO(@190n) get this test working
  // await test(() => batchExternals(1000), 10, 400, 15);
})();
