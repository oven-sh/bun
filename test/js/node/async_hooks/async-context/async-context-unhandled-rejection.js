process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");

const asyncLocalStorage = new AsyncLocalStorage();

// Each unhandledRejection listener invocation must observe the
// AsyncLocalStorage context that the rejected promise belongs to.
const expected = {
  "sync-a": "a",
  "sync-b": "b",
  "no-context": null,
  "timer": "timer",
};
const observed = {};
let remaining = Object.keys(expected).length;

process.on("unhandledRejection", reason => {
  observed[reason.message] = asyncLocalStorage.getStore()?.test ?? null;

  if (--remaining !== 0) return;
  for (const key of Object.keys(expected)) {
    if (observed[key] !== expected[key]) {
      console.error(
        `FAIL: unhandledRejection for "${key}" observed store ${JSON.stringify(observed[key])}, expected ${JSON.stringify(expected[key])}`,
      );
      process.exit(1);
    }
  }
  process.exitCode = 0;
});

asyncLocalStorage.run({ test: "a" }, () => {
  Promise.reject(new Error("sync-a"));
});

asyncLocalStorage.run({ test: "b" }, () => {
  Promise.reject(new Error("sync-b"));
});

Promise.reject(new Error("no-context"));

asyncLocalStorage.run({ test: "timer" }, () => {
  new Promise((_, reject) => {
    setTimeout(() => reject(new Error("timer")), 10);
  });
});
