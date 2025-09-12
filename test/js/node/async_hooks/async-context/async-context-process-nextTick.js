process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "process.nextTick" }, () => {
  process.nextTick(() => {
    if (asyncLocalStorage.getStore()?.test !== "process.nextTick") {
      console.error("FAIL: process.nextTick callback lost context");
      process.exit(1);
    }

    // Test nested nextTick
    process.nextTick(() => {
      if (asyncLocalStorage.getStore()?.test !== "process.nextTick") {
        console.error("FAIL: nested process.nextTick callback lost context");
        process.exit(1);
      }
      process.exit(0);
    });
  });
});
