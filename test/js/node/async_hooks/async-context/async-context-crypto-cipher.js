process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const crypto = require("crypto");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "crypto.cipher" }, () => {
  const algorithm = "aes-256-cbc";
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv(algorithm, key, iv);

  cipher.on("readable", () => {
    if (asyncLocalStorage.getStore()?.test !== "crypto.cipher") {
      console.error("FAIL: crypto cipher readable event lost context");
      process.exit(1);
    }
    cipher.read();
  });

  cipher.on("end", () => {
    if (asyncLocalStorage.getStore()?.test !== "crypto.cipher") {
      console.error("FAIL: crypto cipher end event lost context");
      process.exit(1);
    }
    process.exit(0);
  });

  cipher.write("test data");
  cipher.end();
});
