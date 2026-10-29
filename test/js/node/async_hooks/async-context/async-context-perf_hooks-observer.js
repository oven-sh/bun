process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const { PerformanceObserver: HooksPerformanceObserver, performance } = require("perf_hooks");
const assert = require("assert");

const asyncLocalStorage = new AsyncLocalStorage();

// An observer that is not observing yet. next() resolves with what its next callback saw.
function watch(Observer = PerformanceObserver) {
  const batches = [];
  let wake;
  const observer = new Observer(list => {
    batches.push({
      store: asyncLocalStorage.getStore(),
      names: list
        .getEntries()
        .map(entry => entry.name)
        .sort(),
    });
    wake?.();
  });
  return {
    observer,
    async next() {
      while (batches.length === 0) await new Promise(resolve => (wake = resolve));
      return batches.shift();
    },
  };
}

async function main() {
  // The callback runs in the store of the call that scheduled the batch. The stores the observer
  // was constructed in and started observing in are not used.
  {
    const { observer, next } = asyncLocalStorage.run("constructed", () => watch());
    asyncLocalStorage.run("observing", () => observer.observe({ entryTypes: ["mark"] }));
    asyncLocalStorage.run("producer", () => performance.mark("one"));
    assert.deepStrictEqual(await next(), { store: "producer", names: ["one"] });
    observer.disconnect();
  }

  // One batch is one callback, in the store of the first entry of the batch.
  {
    const { observer, next } = watch();
    observer.observe({ entryTypes: ["measure"] });
    asyncLocalStorage.run("first", () => performance.measure("measure-1"));
    asyncLocalStorage.run("second", () => performance.measure("measure-2"));
    assert.deepStrictEqual(await next(), { store: "first", names: ["measure-1", "measure-2"] });

    // The next batch does not inherit it.
    performance.measure("measure-3");
    assert.deepStrictEqual(await next(), { store: undefined, names: ["measure-3"] });
    observer.disconnect();
  }

  // A mark() inside a callback schedules the next batch from inside the current one.
  {
    const stores = [];
    const { promise, resolve } = Promise.withResolvers();
    const observer = new PerformanceObserver(() => {
      stores.push(asyncLocalStorage.getStore());
      if (stores.length === 1) performance.mark("from-callback");
      else resolve();
    });
    observer.observe({ entryTypes: ["mark"] });
    asyncLocalStorage.run("outer", () => performance.mark("from-outer"));
    await promise;
    assert.deepStrictEqual(stores, ["outer", "outer"]);
    observer.disconnect();
  }

  // node:perf_hooks' class, with `type`.
  {
    const { observer, next } = watch(HooksPerformanceObserver);
    observer.observe({ type: "mark" });
    asyncLocalStorage.run("perf_hooks", () => performance.mark("hooks"));
    assert.deepStrictEqual(await next(), { store: "perf_hooks", names: ["hooks"] });
    observer.disconnect();
  }

  // observe({ buffered: true }) schedules the batch itself.
  {
    const { observer, next } = watch();
    asyncLocalStorage.run("buffered", () => observer.observe({ type: "mark", buffered: true }));
    const { store, names } = await next();
    assert.strictEqual(store, "buffered");
    assert.ok(names.includes("one"), `expected the buffered marks, got ${names}`);
    observer.disconnect();
  }
}

main().then(
  () => process.exit(0),
  error => {
    console.error(error);
    process.exit(1);
  },
);
