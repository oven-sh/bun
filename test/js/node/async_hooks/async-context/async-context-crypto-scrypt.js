process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const crypto = require("crypto");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "crypto.scrypt" }, () => {
  crypto.scrypt("password", "salt", 32, (err, derivedKey) => {
    if (asyncLocalStorage.getStore()?.test !== "crypto.scrypt") {
      console.error("FAIL: crypto.scrypt callback lost context");
      process.exit(1);
    }
    process.exit(0);
  });
});
