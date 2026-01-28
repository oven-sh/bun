process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const crypto = require("crypto");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "crypto.pbkdf2" }, () => {
  crypto.pbkdf2("password", "salt", 100, 32, "sha256", (err, derivedKey) => {
    if (asyncLocalStorage.getStore()?.test !== "crypto.pbkdf2") {
      console.error("FAIL: crypto.pbkdf2 callback lost context");
      process.exit(1);
    }
    process.exit(0);
  });
});
