process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const timers = require("timers/promises");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "timers.promises" }, async () => {
  try {
    // Test setTimeout promise
    await timers.setTimeout(10);
    if (asyncLocalStorage.getStore()?.test !== "timers.promises") {
      console.error("FAIL: timers.promises.setTimeout lost context");
      process.exit(1);
    }

    // Test setImmediate promise
    await timers.setImmediate();
    if (asyncLocalStorage.getStore()?.test !== "timers.promises") {
      console.error("FAIL: timers.promises.setImmediate lost context");
      process.exit(1);
    }

    process.exit(0);
  } catch (err) {
    console.error("ERROR:", err);
    process.exit(1);
  }
});
