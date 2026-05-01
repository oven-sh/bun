process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const crypto = require("crypto");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "crypto.randomFill" }, () => {
  const buffer = Buffer.alloc(16);
  crypto.randomFill(buffer, (err, buf) => {
    if (asyncLocalStorage.getStore()?.test !== "crypto.randomFill") {
      console.error("FAIL: crypto.randomFill callback lost context");
      process.exit(1);
    }
    process.exit(0);
  });
});
