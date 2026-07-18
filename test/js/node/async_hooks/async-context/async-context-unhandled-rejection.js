process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");

const asyncLocalStorage = new AsyncLocalStorage();

// An unhandledRejection listener observes the AsyncLocalStorage context that
// was active when the promise was rejected. Every case below rejects in the
// same context the promise was created in, so Node agrees regardless of
// version; AsyncLocalStorage.test.ts pins the cases where they differ.
const expected = {
  "sync-a": "a",
  "sync-b": "b",
  "no-context": null,
  timer: "timer",
  // Rejected last, from inside a context, so that the drain leaves a context
  // installed unless it restores the previous one afterwards.
  final: "final",
};
const observed = {};
let remaining = Object.keys(expected).length;

process.on("unhandledRejection", reason => {
  observed[reason.message] = asyncLocalStorage.getStore()?.test ?? null;
  remaining--;
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

// Polls outside of any context, so each run observes what the rejection drain
// left in the slot: the drain must restore the previous context after every
// dispatch, not merely overwrite it before the next one.
const deadline = performance.now() + 30_000;
let finalQueued = false;
(function probe() {
  const leaked = asyncLocalStorage.getStore();
  if (leaked !== undefined) {
    console.error(`FAIL: rejection drain leaked an async context: ${JSON.stringify(leaked)}`);
    process.exit(1);
  }

  if (performance.now() > deadline) {
    console.error(`FAIL: timed out with ${remaining} rejection(s) never delivered`);
    process.exit(1);
  }
  if (remaining === 1 && !finalQueued) {
    finalQueued = true;
    asyncLocalStorage.run({ test: "final" }, () => {
      Promise.reject(new Error("final"));
    });
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
