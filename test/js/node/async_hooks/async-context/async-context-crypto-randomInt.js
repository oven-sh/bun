process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const crypto = require("crypto");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "crypto.randomInt" }, () => {
  crypto.randomInt(100, (err, n) => {
    if (asyncLocalStorage.getStore()?.test !== "crypto.randomInt") {
      console.error("FAIL: crypto.randomInt callback lost context");
      process.exit(1);
    }
    if (n >= 100) {
      throw new Error("crypto.randomInt callback returned a number >= 100");
    }

    process.exit(0);
  });
});
