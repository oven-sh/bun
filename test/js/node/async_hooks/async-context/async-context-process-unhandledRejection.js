process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");

const asyncLocalStorage = new AsyncLocalStorage();

// 'unhandledRejection' runs under the async context that was active when the
// promise rejected, not the event loop's.
const expected = ["sync reject", "reaction throw"];
const seen = [];

process.on("unhandledRejection", reason => {
  const store = asyncLocalStorage.getStore()?.test;
  if (store !== reason.message) {
    console.error(`FAIL: unhandledRejection for "${reason.message}" ran with store ${JSON.stringify(store)}`);
    process.exit(1);
  }
  seen.push(reason.message);
  if (seen.length === expected.length) {
    process.exit(0);
  }
});

asyncLocalStorage.run({ test: "sync reject" }, () => {
  Promise.reject(new Error("sync reject"));
});

asyncLocalStorage.run({ test: "reaction throw" }, () => {
  Promise.resolve().then(() => {
    throw new Error("reaction throw");
  });
});
