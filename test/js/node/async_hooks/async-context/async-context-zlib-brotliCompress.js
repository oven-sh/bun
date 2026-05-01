process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const zlib = require("zlib");

const asyncLocalStorage = new AsyncLocalStorage();

asyncLocalStorage.run({ test: "zlib.brotliCompress" }, () => {
  zlib.brotliCompress("test data", (err, compressed) => {
    if (asyncLocalStorage.getStore()?.test !== "zlib.brotliCompress") {
      console.error("FAIL: zlib.brotliCompress callback lost context");
      process.exit(1);
    }
    process.exit(0);
  });
});
