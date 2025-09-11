process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "timers.ref.unref" }, () => {
  const timeout = setTimeout(() => {
    if (asyncLocalStorage.getStore()?.test !== "timers.ref.unref") {
      console.error("FAIL: setTimeout with ref/unref lost context");
      process.exit(1);
    }
    process.exit(0);
  }, 10);

  // Test ref/unref operations
  timeout.unref();
  timeout.ref();
});
