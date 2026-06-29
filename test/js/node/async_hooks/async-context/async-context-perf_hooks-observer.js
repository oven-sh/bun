process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const { PerformanceObserver, performance } = require("perf_hooks");

const asyncLocalStorage = new AsyncLocalStorage();
let failed = false;

// PerformanceObserver callbacks run in the async context of the entry that
// scheduled the delivery batch (the first one queued), not the context the
// observer was registered in.
const observer = new PerformanceObserver(list => {
  const store = asyncLocalStorage.getStore();
  const names = list
    .getEntries()
    .map(e => e.name)
    .sort();
  if (store?.test !== "producer") {
    console.error("FAIL: PerformanceObserver callback lost the producing context, got", store);
    failed = true;
  }
  if (names.join(",") !== "m1,m2") {
    console.error("FAIL: expected one batch with m1,m2, got", names);
    failed = true;
  }
  observer.disconnect();
  process.exit(failed ? 1 : 0);
});

asyncLocalStorage.run({ test: "registration" }, () => {
  observer.observe({ entryTypes: ["measure"] });
});

asyncLocalStorage.run({ test: "producer" }, () => {
  performance.mark("a");
  performance.measure("m1", "a");
});

// Queued into the same delivery batch, so the first producer's context wins.
asyncLocalStorage.run({ test: "other" }, () => {
  performance.mark("b");
  performance.measure("m2", "b");
});
