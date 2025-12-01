process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "queueMicrotask" }, () => {
  queueMicrotask(() => {
    if (asyncLocalStorage.getStore()?.test !== "queueMicrotask") {
      console.error("FAIL: queueMicrotask callback lost context");
      process.exit(1);
    }
    process.exit(0);
  });
});
