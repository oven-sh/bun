process.exitCode = 1;
// Runs under node as well as bun (see AsyncLocalStorage-tracking.test.ts), so
// this stays a plain CommonJS script.
const { AsyncLocalStorage } = require("async_hooks");

const asyncLocalStorage = new AsyncLocalStorage();

// A .finally() callback that returns a rejected thenable settles the outer
// promise from .finally()'s second phase, a separate microtask from the one that
// ran the callback. Kept apart from the other async shapes because it needs a
// JSC change (oven-sh/WebKit#268) that the rest of them do not.
let delivered = 0;
process.on("unhandledRejection", reason => {
  if (++delivered > 1 || reason.message !== "finally-returns-rejected") {
    console.error(`FAIL: unexpected or duplicate unhandledRejection: ${reason && reason.message}`);
    process.exit(1);
  }
  const store = asyncLocalStorage.getStore()?.test ?? null;
  if (store !== "finally-returns-rejected") {
    console.error(`FAIL: observed store ${JSON.stringify(store)}, expected "finally-returns-rejected"`);
    process.exit(1);
  }
});

asyncLocalStorage.run({ test: "finally-returns-rejected" }, () => {
  Promise.resolve().finally(() => Promise.reject(new Error("finally-returns-rejected")));
});

const deadline = performance.now() + 30_000;
(function probe() {
  if (performance.now() > deadline) {
    console.error("FAIL: the rejection was never delivered");
    process.exit(1);
  }
  if (delivered === 0) {
    setImmediate(probe);
    return;
  }
  process.exitCode = 0;
})();
