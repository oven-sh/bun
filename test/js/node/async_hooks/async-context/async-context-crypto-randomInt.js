const { AsyncLocalStorage } = require("async_hooks");
const crypto = require("crypto");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "crypto.randomInt" }, () => {
  crypto.randomInt(100, (err, n) => {
    if (asyncLocalStorage.getStore()?.test !== "crypto.randomInt") {
      console.error("FAIL: crypto.randomInt callback lost context");
      process.exit(1);
    }
    process.exit(0);
  });
});
