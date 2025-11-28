process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const crypto = require("crypto");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "crypto.generateKey" }, () => {
  crypto.generateKey("hmac", { length: 64 }, (err, key) => {
    if (asyncLocalStorage.getStore()?.test !== "crypto.generateKey") {
      console.error("FAIL: crypto.generateKey callback lost context");
      process.exit(1);
    }
    process.exit(0);
  });
});
