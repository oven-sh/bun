process.exitCode = 1;
// Runs under node as well as bun (see AsyncLocalStorage-tracking.test.ts), so
// this stays a plain CommonJS script.
const { AsyncLocalStorage } = require("async_hooks");

const asyncLocalStorage = new AsyncLocalStorage();

// In every case below the promise that ends up unhandled never runs a handler
// of its own: it adopts the settlement of another promise. That settlement is
// delivered by a separate microtask (PromiseResolveWithoutHandlerJob in JSC),
// which has to carry the context the adoption was set up in. Node agrees
// regardless of version, because the reported promise is also created in that
// context. Kept apart from the other shapes because this needs a JSC change
// (oven-sh/WebKit#268) that the rest of them do not.
const expected = {
  // p.then(f) registered inside the store; p rejected later, outside of any store.
  "then-pending": "then-pending",
  // Promise.reject(e).then(f): the source is already rejected when then() runs.
  "then-settled": "then-settled",
  // resolve(alreadyRejected) inside the store adopts a promise rejected outside of it.
  "adopt-executor": "adopt-executor",
  // Same adoption through an async function's return value.
  "adopt-async-return": "adopt-async-return",
};
const observed = {};
let remaining = Object.keys(expected).length;

process.on("unhandledRejection", reason => {
  const key = reason.message;
  if (!(key in expected) || key in observed) {
    console.error(`FAIL: unexpected or duplicate unhandledRejection for ${JSON.stringify(key)}`);
    process.exit(1);
  }
  observed[key] = asyncLocalStorage.getStore()?.test ?? null;
  remaining--;
});

// Rejected with no store active. The catch handler keeps these two from being
// reported themselves; only the promises that adopt them below are unhandled.
const rejectedOutside = {};
for (const key of ["adopt-executor", "adopt-async-return"]) {
  rejectedOutside[key] = Promise.reject(new Error(key));
  rejectedOutside[key].catch(() => {});
}

let rejectPending;
asyncLocalStorage.run({ test: "then-pending" }, () => {
  new Promise((_, reject) => {
    rejectPending = reject;
  }).then(() => {});
});
// No store is active here, so the context the listener observes can only come
// from the then() registration above.
rejectPending(new Error("then-pending"));

asyncLocalStorage.run({ test: "then-settled" }, () => {
  Promise.reject(new Error("then-settled")).then(() => {});
});

asyncLocalStorage.run({ test: "adopt-executor" }, () => {
  new Promise(resolve => resolve(rejectedOutside["adopt-executor"]));
});

asyncLocalStorage.run({ test: "adopt-async-return" }, () => {
  (async () => rejectedOutside["adopt-async-return"])();
});

const deadline = performance.now() + 30_000;
(function probe() {
  if (performance.now() > deadline) {
    console.error(`FAIL: timed out with ${remaining} rejection(s) never delivered`);
    process.exit(1);
  }
  if (remaining !== 0) {
    setImmediate(probe);
    return;
  }

  for (const key of Object.keys(expected)) {
    if (observed[key] !== expected[key]) {
      console.error(
        `FAIL: unhandledRejection for "${key}" observed store ${JSON.stringify(observed[key])}, expected ${JSON.stringify(expected[key])}`,
      );
      process.exit(1);
    }
  }
  process.exitCode = 0;
})();
