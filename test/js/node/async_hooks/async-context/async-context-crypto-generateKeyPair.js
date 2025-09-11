process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const crypto = require("crypto");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "crypto.generateKeyPair" }, () => {
  crypto.generateKeyPair(
    "rsa",
    {
      modulusLength: 512, // Small for faster test
    },
    (err, publicKey, privateKey) => {
      if (asyncLocalStorage.getStore()?.test !== "crypto.generateKeyPair") {
        console.error("FAIL: crypto.generateKeyPair callback lost context");
        process.exit(1);
      }
      process.exit(0);
    },
  );
});
