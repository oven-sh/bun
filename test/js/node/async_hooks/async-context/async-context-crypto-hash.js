process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const crypto = require("crypto");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "crypto.hash" }, () => {
  const hash = crypto.createHash("sha256");
  hash.update("test data");

  // Test with callback style if available
  setImmediate(() => {
    if (asyncLocalStorage.getStore()?.test !== "crypto.hash") {
      console.error("FAIL: crypto hash operation lost context");
      process.exit(1);
    }
    const digest = hash.digest("hex");
    process.exit(0);
  });
});
