process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");

const asyncLocalStorage = new AsyncLocalStorage();
let count = 0;

asyncLocalStorage.run({ test: "setInterval" }, () => {
  const interval = setInterval(() => {
    if (asyncLocalStorage.getStore()?.test !== "setInterval") {
      console.error("FAIL: setInterval callback lost context");
      clearInterval(interval);
      process.exit(1);
    }
    count++;
    if (count >= 2) {
      clearInterval(interval);
      process.exit(0);
    }
  }, 10);
});
