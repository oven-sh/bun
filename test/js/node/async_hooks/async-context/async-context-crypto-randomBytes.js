process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const crypto = require("crypto");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "crypto.randomBytes" }, () => {
  crypto.randomBytes(16, (err, buf) => {
    if (asyncLocalStorage.getStore()?.test !== "crypto.randomBytes") {
      console.error("FAIL: crypto.randomBytes callback lost context");
      process.exit(1);
    }
    process.exit(0);
  });
});
